export const BELT_LABELS: Record<string, string> = {
  white: 'Branca',
  yellow: 'Amarela',
  orange: 'Laranja',
  green: 'Verde',
  blue: 'Azul',
  brown: 'Marrom',
  'black-1dan': 'Preta 1º Dan',
  'black-2dan': 'Preta 2º Dan',
  'black-3dan': 'Preta 3º Dan',
  'black-4dan': 'Preta 4º Dan',
  'black-5dan': 'Preta 5º Dan',
  'black-6dan': 'Preta 6º Dan',
  'black-7dan': 'Preta 7º Dan',
  'black-8dan': 'Preta 8º Dan',
  'black-9dan': 'Preta 9º Dan',
  'black-10dan': 'Preta 10º Dan',
}

export const BELT_OPTIONS = Object.entries(BELT_LABELS).map(([value, label]) => ({ value, label }))

export const GENDER_LABELS: Record<string, string> = {
  male: 'Masculino',
  female: 'Feminino',
  not_informed: 'Não informado',
}

export const GENDER_OPTIONS = Object.entries(GENDER_LABELS).map(([value, label]) => ({ value, label }))

export const GUARDIAN_RELATIONSHIP_LABELS: Record<string, string> = {
  father: 'Pai',
  mother: 'Mãe',
  guardian: 'Tutor(a)',
  other: 'Outro',
}

export const GUARDIAN_RELATIONSHIP_OPTIONS = Object.entries(GUARDIAN_RELATIONSHIP_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export const ATHLETE_STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  suspended: 'Suspenso',
  pending: 'Pendente',
}

export function isMinor(birthDate: string, referenceDate = new Date().toISOString().slice(0, 10)): boolean {
  if (!birthDate) return false
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [ry, rm, rd] = referenceDate.split('-').map(Number)
  if (!by || !bm || !bd || !ry || !rm || !rd) return false
  let age = ry - by
  if (rm < bm || (rm === bm && rd < bd)) age--
  return age < 18
}

const API_ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid CPF': 'CPF inválido',
  'CPF already registered in this academy': 'Este CPF já está cadastrado nesta academia',
  'Guardian is required for athletes under 18': 'Responsável é obrigatório para atletas menores de 18 anos',
  'Guardian already registered for this athlete': 'Este atleta já possui um responsável cadastrado',
  'No guardian registered for this athlete': 'Este atleta não possui responsável cadastrado',
  'Athlete not found': 'Atleta não encontrado',
  'Weight record not found': 'Registro de peso não encontrado',
  'Correction reason is required': 'É necessário informar o motivo da correção',
  'Reason is required': 'É necessário informar um motivo',
  'Email already in use': 'Este e-mail já está em uso',
  'Invalid credentials': 'E-mail ou senha inválidos',
  'Event not found': 'Evento não encontrado',
  'Division not found': 'Divisão não encontrada',
  'Entry not found': 'Inscrição não encontrada',
  'Cannot delete a division that has entries': 'Não é possível apagar uma divisão que já tem inscrições',
  'Athlete is already registered in this division': 'Esta atleta já está inscrita nesta divisão',
}

export function translateApiError(message: string): string {
  if (API_ERROR_TRANSLATIONS[message]) return API_ERROR_TRANSLATIONS[message]
  const transitionMatch = message.match(/^Cannot transition entry from "(.+)" to "(.+)"$/)
  if (transitionMatch) {
    const [, from, to] = transitionMatch
    return `Não é possível mover a inscrição de "${EVENT_ENTRY_STATUS_LABELS[from!] ?? from}" para "${EVENT_ENTRY_STATUS_LABELS[to!] ?? to}"`
  }
  return message
}

export const EVENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  registration: 'Inscrições abertas',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

export const EVENT_STATUS_OPTIONS = Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))

export const EVENT_ENTRY_STATUS_LABELS: Record<string, string> = {
  incomplete: 'Incompleta',
  registered: 'Inscrita',
  checked_in: 'Check-in feito',
  weighed_in: 'Pesada',
  confirmed: 'Confirmada',
  disqualified: 'Desclassificada',
  withdrawn: 'Retirada',
}

export const OVERWEIGHT_POLICY_LABELS: Record<string, string> = {
  disqualify: 'Desclassificar automaticamente',
  reallocate: 'Realocar para a categoria correta',
}

export const OVERWEIGHT_POLICY_OPTIONS = Object.entries(OVERWEIGHT_POLICY_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function formatDate(isoDate: string): string {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
