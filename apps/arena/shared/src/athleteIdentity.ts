// Resolves a short, human-readable identifier to tell apart two athletes
// with the same (or a very similar) name on operational screens — the
// "duas Alices" problem: check-in search, table operation, and (per the
// entries listing this DTO field feeds) the event roster.
//
// Real seed/import data is sparse: federationNumber, zempoNumber and cpf are
// all optional on the competitor model (see competitor.ts) and, in the FPJ
// spreadsheet actually used to seed events today, all three are blank for
// every athlete. birthDate is the one field that's always present (required
// on both CreateCompetitorInput and CompetitorDTO), so it has to be the
// guaranteed fallback — everything else is a nice-to-have when an academy
// actually fills it in.
//
// Cascade, most authoritative/stable first:
//   1. federationNumber — official federation registration. Whichever
//      federation the academy is affiliated with (CBJ, a state federation,
//      etc.) — the field itself is federation-agnostic, so the label stays
//      generic rather than assuming one specific body.
//   2. zempoNumber — external registration number, typically carried over
//      from an import. Label is deliberately generic ("Reg.") — CLAUDE.md
//      forbids surfacing a competitor's brand name in this product's UI, so
//      the field name (an internal implementation detail) never leaks into
//      what an operator sees on screen.
//   3. cpf — a government ID: unique, but sensitive, and the athlete is
//      frequently a minor. ALWAYS rendered masked (see maskCPF) — this
//      function never returns the full number, even if the caller passes
//      one in.
//   4. birthDate — required field, so this is the guaranteed fallback when
//      the first three are all empty (today's actual common case). Shown as
//      birth YEAR only, not the full date: enough to disambiguate two same-
//      name athletes of different ages without displaying a full date of
//      birth on an operational screen that doesn't need it (data
//      minimization).
export interface AthleteIdentitySource {
  federationNumber?: string | undefined
  zempoNumber?: string | undefined
  cpf?: string | undefined
  birthDate: string // YYYY-MM-DD
}

export type AthleteIdentitySourceKind = 'federation' | 'external_registration' | 'cpf' | 'birth_year'

export interface AthleteIdentity {
  label: string
  source: AthleteIdentitySourceKind
}

// Masks a CPF to its last 2 digits: "123.456.789-01" -> "***.***.***-01".
// Anything that isn't an 11-digit CPF (missing, malformed, partially typed)
// masks to a fully-generic placeholder rather than risking a partial leak.
export function maskCPF(cpf: string): string {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return '***.***.***-**'
  return `***.***.***-${digits.slice(-2)}`
}

export function resolveAthleteIdentity(athlete: AthleteIdentitySource): AthleteIdentity {
  const federationNumber = athlete.federationNumber?.trim()
  if (federationNumber) {
    return { label: `Federação ${federationNumber}`, source: 'federation' }
  }
  const zempoNumber = athlete.zempoNumber?.trim()
  if (zempoNumber) {
    return { label: `Reg. ${zempoNumber}`, source: 'external_registration' }
  }
  const cpf = athlete.cpf?.trim()
  if (cpf) {
    return { label: `CPF ${maskCPF(cpf)}`, source: 'cpf' }
  }
  const year = athlete.birthDate.slice(0, 4)
  return { label: `nasc. ${year}`, source: 'birth_year' }
}
