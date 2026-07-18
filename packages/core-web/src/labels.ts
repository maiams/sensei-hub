import { BELT_VALUES, BELT_LABEL_PT } from '@sensei-hub/shared'

// UI labels shared by both products — belts/gender come from the same
// canonical table as the dojo→arena spreadsheet contract.
export const BELT_LABELS: Record<string, string> = BELT_LABEL_PT

export const BELT_OPTIONS = BELT_VALUES.map((value) => ({ value, label: BELT_LABELS[value] }))

export const GENDER_LABELS: Record<string, string> = {
  male: 'Masculino',
  female: 'Feminino',
  not_informed: 'Não informado',
}

export const GENDER_OPTIONS = Object.entries(GENDER_LABELS).map(([value, label]) => ({ value, label }))

export function isMinor(birthDate: string, referenceDate = new Date().toISOString().slice(0, 10)): boolean {
  if (!birthDate) return false
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [ry, rm, rd] = referenceDate.split('-').map(Number)
  if (!by || !bm || !bd || !ry || !rm || !rd) return false
  let age = ry - by
  if (rm < bm || (rm === bm && rd < bd)) age--
  return age < 18
}

export function formatDate(isoDate: string): string {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Error messages the shared core-server routes can return
const COMMON_API_ERROR_TRANSLATIONS: Record<string, string> = {
  'Email already in use': 'Este e-mail já está em uso',
  'Invalid credentials': 'E-mail ou senha inválidos',
  'Reason is required': 'É necessário informar um motivo',
}

// Each product builds its translator from the common dictionary plus its own
// messages and, optionally, product-specific pattern matchers.
export function createApiErrorTranslator(
  extra: Record<string, string>,
  patterns: Array<(message: string) => string | null> = [],
): (message: string) => string {
  const table = { ...COMMON_API_ERROR_TRANSLATIONS, ...extra }
  return (message: string) => {
    if (table[message]) return table[message]
    for (const pattern of patterns) {
      const translated = pattern(message)
      if (translated) return translated
    }
    return message
  }
}
