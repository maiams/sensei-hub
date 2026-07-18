import * as XLSX from 'xlsx'
import { Types } from 'mongoose'
import { EventModel } from '../repositories/EventModel.js'
import { DivisionModel, type DivisionDocument } from '../repositories/DivisionModel.js'
import { DivisionGroupModel } from '../repositories/DivisionGroupModel.js'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { EventEntryModel } from '../repositories/EventEntryModel.js'
import { ImportJobModel, type ImportJobDocument } from '../repositories/ImportJobModel.js'
import { AuditLogModel } from '../repositories/AuditLogModel.js'
import { AthleteService, isMinor, type AthleteCtx } from './AthleteService.js'
import { isValidCPF, type Belt, type Gender, type ImportRowError } from '@sensei-hub/shared'

// Fixed column order (A–N) — position matters, header text is a label only.
// No "categoria" column: which Division the athlete lands in is derived from
// age + weight + gender against the event's own divisions (see matchDivision
// below), same as how a real weigh-in table sorts athletes — the operator
// filling the spreadsheet shouldn't have to know the event's division names.
const TEMPLATE_HEADERS = [
  'nome_completo',
  'nome_preferido',
  'academia',
  'data_nascimento',
  'genero',
  'faixa',
  'peso_declarado_kg',
  'cpf',
  'email',
  'telefone',
  'responsavel_nome',
  'responsavel_telefone',
  'termos_aceitos',
  'observacoes',
]

const BELT_MAP: Record<string, Belt> = {
  branca: 'white',
  bordo: 'burgundy',
  cinza: 'gray',
  azul: 'blue',
  amarela: 'yellow',
  laranja: 'orange',
  verde: 'green',
  roxa: 'purple',
  marrom: 'brown',
  preta: 'black-1dan',
  'preta 1 dan': 'black-1dan',
  'preta 2 dan': 'black-2dan',
  'preta 3 dan': 'black-3dan',
  'preta 4 dan': 'black-4dan',
  'preta 5 dan': 'black-5dan',
  'coral 6 dan': 'coral-6dan',
  'coral 7 dan': 'coral-7dan',
  'coral 8 dan': 'coral-8dan',
  'vermelha 9 dan': 'red-9dan',
  'vermelha 10 dan': 'red-10dan',
}

interface ParsedRow {
  row: number
  fullName: string
  clubName: string
  birthDate: string // YYYY-MM-DD
  gender: Gender
  belt: Belt
  declaredWeightKg: number
  divisionId: string
  cpf: string | undefined
  email: string | undefined
  phone: string | undefined
  preferredName: string | undefined
  guardianName: string | undefined
  guardianPhone: string | undefined
  notes: string | undefined
  termsAccepted: boolean
  isMinor: boolean
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function normalizeBelt(value: string): string {
  return normalize(value)
    .replace(/[º°]/g, '')
    .replace(/[—–-]/g, ' ')
    .replace(/\s+/g, ' ')
}

function cell(row: unknown[], index: number): string {
  const value = row[index]
  return value === undefined || value === null ? '' : String(value).trim()
}

function parseCivilDateBR(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) return null
  const [, dd, mm, yyyy] = match as unknown as [string, string, string, string]
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return `${yyyy}-${mm}-${dd}`
}

function calculateAge(birthDate: string, referenceDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [ry, rm, rd] = referenceDate.split('-').map(Number) as [number, number, number]
  let age = ry - by
  if (rm < bm || (rm === bm && rd < bd)) age--
  return age
}

interface DivisionCandidate {
  id: string
  name: string
  minAge: number | null
  maxAge: number | null
  weightLimitKg: number | null
  // Known only when this division came from import-from-templates AND the
  // originating DivisionGroup still carries its FPJ-preset lineage — custom
  // or renamed groups have no structured gender, which is why divisions
  // themselves don't have a gender field (Fase 2 v2: categories are free-form).
  knownGender: 'male' | 'female' | null
}

// Picks the event division for an imported row from age + weight + gender
// alone — the spreadsheet has no "categoria" column, so the operator never
// needs to know how the organizer named the event's divisions. Gender is
// used only to disambiguate when it's actually knowable (see knownGender);
// divisions with no gender lineage stay eligible for either, same as a
// genuinely mixed/open bracket would.
function matchDivision(
  candidates: DivisionCandidate[],
  age: number,
  gender: Gender,
  weightKg: number,
): { divisionId?: string; error?: string } {
  const ageMatches = candidates.filter(
    (d) => (d.minAge === null || age >= d.minAge) && (d.maxAge === null || age <= d.maxAge),
  )
  const weightMatches = ageMatches.filter((d) => d.weightLimitKg === null || weightKg <= d.weightLimitKg)
  if (weightMatches.length === 0) {
    return { error: `Nenhuma categoria do evento comporta ${age} anos e ${weightKg}kg` }
  }

  const genderFiltered = weightMatches.filter((d) => d.knownGender === null || d.knownGender === gender)
  if (genderFiltered.length === 0) {
    return { error: `Nenhuma categoria compatível com o gênero informado para ${age} anos e ${weightKg}kg` }
  }

  const weightOf = (d: DivisionCandidate) => d.weightLimitKg ?? Infinity
  const sorted = [...genderFiltered].sort((a, b) => weightOf(a) - weightOf(b))
  const best = sorted[0] as DivisionCandidate
  const tied = sorted.filter((d) => weightOf(d) === weightOf(best))
  if (tied.length > 1) {
    return {
      error: `${weightKg}kg se encaixa em mais de uma categoria (${tied.map((d) => d.name).join(', ')}); ajuste manualmente`,
    }
  }

  return { divisionId: best.id }
}

export class ImportService {
  #athleteService = new AthleteService()

  getTemplate(): Buffer {
    const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Atletas')
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }

  async parseAndValidate(
    buffer: Buffer,
    eventId: string,
    academyId: string,
  ): Promise<{ valid: ParsedRow[]; errors: ImportRowError[] }> {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new ImportServiceError('Event not found', 404)
    }

    const divisions = await DivisionModel.find({ eventId })
    const groupIds = [
      ...new Set(divisions.map((d) => d.sourceGroupId?.toString()).filter((id): id is string => Boolean(id))),
    ]
    const groups = groupIds.length > 0 ? await DivisionGroupModel.find({ _id: { $in: groupIds } }) : []
    const knownGenderByGroupId = new Map(groups.map((g) => [g._id.toString(), g.sourcePreset?.groupLabel ?? null]))
    const divisionCandidates: DivisionCandidate[] = divisions.map((d: DivisionDocument) => ({
      id: d._id.toString(),
      name: d.name,
      minAge: d.minAge,
      maxAge: d.maxAge,
      weightLimitKg: d.weightLimitKg,
      knownGender: d.sourceGroupId ? (knownGenderByGroupId.get(d.sourceGroupId.toString()) ?? null) : null,
    }))

    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      throw new ImportServiceError('Spreadsheet has no sheets', 400)
    }
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet as XLSX.WorkSheet, { header: 1, defval: '' })

    const valid: ParsedRow[] = []
    const errors: ImportRowError[] = []

    // Row 1 is the header; data starts at row 2 (matches what the operator
    // sees in the spreadsheet).
    for (let i = 1; i < rows.length; i++) {
      const raw = rows[i] as unknown[]
      const rowNumber = i + 1
      if (raw.every((v) => v === undefined || v === null || String(v).trim() === '')) {
        continue // blank trailing row — not an error, not counted
      }

      const rowErrors: ImportRowError[] = []
      const push = (field: string, message: string) => rowErrors.push({ row: rowNumber, field, message })

      const fullName = cell(raw, 0)
      if (fullName.length < 2) push('nome_completo', 'Nome completo é obrigatório')

      const preferredName = cell(raw, 1) || undefined

      const clubName = cell(raw, 2)
      if (!clubName) push('academia', 'Academia é obrigatória')

      const birthDateRaw = cell(raw, 3)
      const birthDate = parseCivilDateBR(birthDateRaw)
      if (!birthDate) push('data_nascimento', 'Data de nascimento inválida (use DD/MM/AAAA)')

      const genderRaw = cell(raw, 4).toUpperCase()
      const gender: Gender | null = genderRaw === 'M' ? 'male' : genderRaw === 'F' ? 'female' : null
      if (!gender) push('genero', 'Gênero inválido (use M ou F)')

      const beltRaw = normalizeBelt(cell(raw, 5))
      const belt = BELT_MAP[beltRaw]
      if (!belt) push('faixa', `Faixa inválida: "${cell(raw, 5)}"`)

      const weightRaw = cell(raw, 6).replace(',', '.')
      const declaredWeightKg = Number(weightRaw)
      if (!Number.isFinite(declaredWeightKg) || declaredWeightKg <= 0 || declaredWeightKg > 300) {
        push('peso_declarado_kg', 'Peso declarado inválido')
      }

      const cpfRaw = cell(raw, 7)
      const cpf = cpfRaw ? cpfRaw.replace(/\D/g, '') : undefined
      if (cpf && !isValidCPF(cpf)) push('cpf', 'CPF inválido')

      const email = cell(raw, 8) || undefined
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) push('email', 'Email inválido')

      const phone = cell(raw, 9) || undefined

      const guardianName = cell(raw, 10) || undefined
      const guardianPhone = cell(raw, 11) || undefined

      const termsRaw = cell(raw, 12).toUpperCase()
      const termsAccepted = termsRaw === 'S'
      if (termsRaw !== 'S' && termsRaw !== 'N') push('termos_aceitos', 'Informe S ou N')

      const notes = cell(raw, 13) || undefined

      const minor = birthDate ? isMinor(birthDate, event.eventDate) : false
      if (minor && (!guardianName || !guardianPhone)) {
        push('responsavel_nome', 'Responsável obrigatório para atleta menor de 18 anos')
      }
      if (minor && termsRaw === 'N') {
        push('termos_aceitos', 'Responsável de atleta menor deve aceitar os termos (S)')
      }

      // Only attempt to place the athlete once the fields the match depends on
      // (birth date, gender, weight) have themselves validated cleanly —
      // otherwise this would just add a confusing second error on top of the
      // real one, and the row is rejected anyway.
      let divisionId: string | undefined
      if (birthDate && gender && Number.isFinite(declaredWeightKg) && declaredWeightKg > 0 && declaredWeightKg <= 300) {
        const age = calculateAge(birthDate, event.eventDate)
        const match = matchDivision(divisionCandidates, age, gender, declaredWeightKg)
        if (match.error) {
          push('peso_declarado_kg', match.error)
        } else {
          divisionId = match.divisionId
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors)
        continue
      }

      valid.push({
        row: rowNumber,
        fullName,
        clubName,
        birthDate: birthDate as string,
        gender: gender as Gender,
        belt: belt as Belt,
        declaredWeightKg,
        divisionId: divisionId as string,
        cpf,
        email,
        phone,
        preferredName,
        guardianName,
        guardianPhone,
        notes,
        termsAccepted,
        isMinor: minor,
      })
    }

    return { valid, errors }
  }

  // Each row is created atomically for its own Athlete(+Guardian) — see
  // AthleteService.createAthlete — followed by its EventEntry as a separate
  // step. A crash between the two would leave an orphan Athlete with no
  // entry; acceptable here because it surfaces as a row error in the job
  // report (never silently lost) and is correctable by re-running the import
  // or editing the athlete by hand, rather than by threading an external
  // Mongo session through AthleteService for this one caller.
  async importRows(
    rows: ParsedRow[],
    eventId: string,
    academyId: string,
    ctx: AthleteCtx,
    importJobId: string,
  ): Promise<{ successCount: number; errors: ImportRowError[] }> {
    let successCount = 0
    const errors: ImportRowError[] = []

    for (const row of rows) {
      try {
        let athleteId: string
        // AthleteService stores cpf exactly as submitted (punctuated or not),
        // while row.cpf here is already digits-only — compare by stripped
        // digits rather than an exact-string Mongo match so a permanent
        // athlete registered as "111.444.777-35" is still found when the
        // spreadsheet has "11144477735".
        const existing = row.cpf
          ? (await AthleteModel.find({ academyId, cpf: { $exists: true } })).find(
              (a) => a.cpf?.replace(/\D/g, '') === row.cpf,
            )
          : null
        if (existing) {
          athleteId = existing._id.toString()
        } else {
          const created = await this.#athleteService.createAthlete(
            {
              scope: 'event-only',
              eventOnlyEventId: eventId,
              fullName: row.fullName,
              preferredName: row.preferredName,
              gender: row.gender,
              birthDate: row.birthDate,
              nationality: 'Brazilian',
              email: row.email,
              phone: row.phone,
              cpf: row.cpf,
              currentBelt: row.belt,
              clubName: row.clubName,
              hasMedicalRestriction: false,
              termsAccepted: row.termsAccepted,
              imageAuthorizationAccepted: false,
              // termsAccepted: true is safe here — parseAndValidate rejects
              // any minor row whose termos_aceitos isn't "S" before it ever
              // reaches `valid`, so every row that gets here already has
              // guardian consent confirmed by the importing operator.
              guardian:
                row.isMinor && row.guardianName && row.guardianPhone
                  ? {
                      name: row.guardianName,
                      relationship: 'guardian',
                      phone: row.guardianPhone,
                      termsAccepted: true,
                      imageAuthorizationAccepted: false,
                    }
                  : undefined,
            },
            ctx,
          )
          athleteId = created.id
        }

        await EventEntryModel.create({
          eventId,
          divisionId: row.divisionId,
          athleteId,
          academyId,
          registrationMethod: 'import',
          importJobId,
          status: 'registered',
          declaredWeightKg: row.declaredWeightKg,
        })

        successCount++
      } catch (err) {
        errors.push({ row: row.row, message: this.#errorMessage(err) })
      }
    }

    return { successCount, errors }
  }

  async runImport(buffer: Buffer, filename: string, eventId: string, academyId: string, ctx: AthleteCtx) {
    const { valid, errors: parseErrors } = await this.parseAndValidate(buffer, eventId, academyId)

    const jobId = new Types.ObjectId()
    const { successCount, errors: createErrors } = await this.importRows(valid, eventId, academyId, ctx, jobId.toString())

    const invalidRowNumbers = new Set(parseErrors.map((e) => e.row))
    const totalRows = valid.length + invalidRowNumbers.size
    const errorCount = invalidRowNumbers.size + createErrors.length
    const allErrors = [...parseErrors, ...createErrors].sort((a, b) => a.row - b.row)

    const job = await ImportJobModel.create({
      _id: jobId,
      eventId,
      filename,
      importedBy: ctx.userId,
      totalRows,
      successCount,
      errorCount,
      errors: allErrors,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'ImportJob',
      entityId: job._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(job)
  }

  async listImportJobs(eventId: string, academyId: string) {
    await this.#findEvent(eventId, academyId)
    const jobs = await ImportJobModel.find({ eventId }).sort({ importedAt: -1 })
    return jobs.map((j) => this.#toDTO(j))
  }

  async getImportJob(eventId: string, academyId: string, jobId: string) {
    await this.#findEvent(eventId, academyId)
    const job = await ImportJobModel.findOne({ _id: jobId, eventId })
    if (!job) {
      throw new ImportServiceError('Import job not found', 404)
    }
    return this.#toDTO(job)
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new ImportServiceError('Event not found', 404)
    }
    return event
  }

  #errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return 'Erro desconhecido ao criar atleta/inscrição'
  }

  #toDTO(job: ImportJobDocument) {
    return {
      id: job._id.toString(),
      eventId: job.eventId.toString(),
      filename: job.filename,
      importedBy: job.importedBy.toString(),
      importedAt: job.importedAt.toISOString(),
      totalRows: job.totalRows,
      successCount: job.successCount,
      errorCount: job.errorCount,
      errors: job.errors,
    }
  }
}

export class ImportServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404,
  ) {
    super(message)
    this.name = 'ImportServiceError'
  }
}
