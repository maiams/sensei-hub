import { createApiErrorTranslator } from '@sensei-hub/core-web'

export {
  BELT_LABELS,
  BELT_OPTIONS,
  GENDER_LABELS,
  GENDER_OPTIONS,
  isMinor,
  formatDate,
} from '@sensei-hub/core-web'

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

const DOJO_API_ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid CPF': 'CPF inválido',
  'CPF already registered in this academy': 'Este CPF já está cadastrado nesta academia',
  'Guardian is required for athletes under 18': 'Responsável é obrigatório para atletas menores de 18 anos',
  'Guardian already registered for this athlete': 'Este atleta já possui um responsável cadastrado',
  'No guardian registered for this athlete': 'Este atleta não possui responsável cadastrado',
  'Athlete not found': 'Atleta não encontrado',
  'Weight record not found': 'Registro de peso não encontrado',
  'Correction reason is required': 'É necessário informar o motivo da correção',
  'Academy not found': 'Academia não encontrada',
}

export const translateApiError = createApiErrorTranslator(DOJO_API_ERROR_TRANSLATIONS)
