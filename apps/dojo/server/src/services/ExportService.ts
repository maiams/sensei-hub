import * as XLSX from 'xlsx'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { GuardianModel } from '../repositories/GuardianModel.js'
import { AcademyModel } from '@sensei-hub/core-server'
import { BELT_LABEL_PT, ATHLETE_SHEET_HEADERS } from '@sensei-hub/shared'

// The workbook this service writes is exactly what the arena's ImportService
// parses: ATHLETE_SHEET_HEADERS column order, DD/MM/AAAA dates, M/F gender,
// BELT_LABEL_PT belt labels, S/N terms. Athletes with gender 'not_informed' are exported with an empty
// genero cell: the arena flags the row and the operator fills it in, rather
// than the export silently dropping the athlete.
export const EXPORT_HEADERS = [...ATHLETE_SHEET_HEADERS]

function toBRDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

export class ExportService {
  // Builds the championship-registration spreadsheet for every active athlete.
  async buildAthleteWorkbook(academyId: string): Promise<Buffer> {
    const academy = await AcademyModel.findById(academyId)
    if (!academy) {
      throw new ExportServiceError('Academy not found', 404)
    }

    const athletes = await AthleteModel.find({ academyId, status: 'active' }).sort({ fullName: 1 })
    const athleteIds = athletes.map((a) => a._id)
    const guardians = await GuardianModel.find({ athleteId: { $in: athleteIds } })
    const guardianByAthlete = new Map(guardians.map((g) => [g.athleteId.toString(), g]))

    const rows = athletes.map((a) => {
      const guardian = guardianByAthlete.get(a._id.toString())
      return [
        a.fullName,
        a.preferredName ?? '',
        a.clubName ?? academy.name,
        toBRDate(a.birthDate),
        a.gender === 'male' ? 'M' : a.gender === 'female' ? 'F' : '',
        BELT_LABEL_PT[a.currentBelt],
        a.latestWeightKg ?? '',
        a.cpf ?? '',
        a.email ?? '',
        a.phone ?? '',
        guardian?.name ?? '',
        guardian?.phone ?? '',
        a.termsAccepted ? 'S' : 'N',
        '',
      ]
    })

    const sheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Atletas')
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }
}

export class ExportServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404,
  ) {
    super(message)
    this.name = 'ExportServiceError'
  }
}
