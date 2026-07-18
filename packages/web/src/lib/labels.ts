import { BELT_VALUES } from '@sensei-hub/shared'

export const BELT_LABELS: Record<string, string> = {
  white: 'Branca',
  burgundy: 'Bordô',
  gray: 'Cinza',
  blue: 'Azul',
  yellow: 'Amarela',
  orange: 'Laranja',
  green: 'Verde',
  purple: 'Roxa',
  brown: 'Marrom',
  'black-1dan': 'Preta — 1º Dan',
  'black-2dan': 'Preta — 2º Dan',
  'black-3dan': 'Preta — 3º Dan',
  'black-4dan': 'Preta — 4º Dan',
  'black-5dan': 'Preta — 5º Dan',
  'coral-6dan': 'Coral — 6º Dan',
  'coral-7dan': 'Coral — 7º Dan',
  'coral-8dan': 'Coral — 8º Dan',
  'red-9dan': 'Vermelha — 9º Dan',
  'red-10dan': 'Vermelha — 10º Dan',
}

export const BELT_OPTIONS = BELT_VALUES.map((value) => ({ value, label: BELT_LABELS[value] }))

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
  // Bracket / matches
  'No active bracket for this division': 'Nenhuma chave ativa para esta divisão',
  'A bracket already exists for this division — pass force to regenerate': 'Já existe uma chave ativa para esta divisão',
  'No confirmed entries in this division': 'Não há inscrições confirmadas nesta divisão',
  'Match already has a result — use the correction endpoint': 'Esta luta já tem resultado — use a correção',
  'Match has no result yet — use the result endpoint': 'Esta luta ainda não tem resultado',
  'Cannot correct: a subsequent match already has a recorded result for an athlete from this match':
    'Não é possível corrigir: uma luta seguinte desta atleta já tem resultado registrado',
  'Bracket is not fully decided yet': 'A chave ainda não foi totalmente decidida',
  // Areas / dispatch
  'Area not found': 'Área não encontrada',
  'Area is closed': 'Esta área está fechada',
  'Match not found': 'Luta não encontrada',
  'Match already has a result': 'Esta luta já tem resultado',
  'Match participants are not defined yet': 'Os participantes desta luta ainda não foram definidos',
  'Match is already being fought on a scoreboard': 'Esta luta já está em andamento em outro placar',
  'Match is not dispatched to this area': 'Esta luta não foi enviada para esta área',
  // Scoreboard
  'Scoreboard not found': 'Placar não encontrado',
  'Scoreboard is not active': 'Este placar não está mais ativo',
  'Winner is not a participant of this match': 'A vencedora indicada não participa desta luta',
  'Golden score is disabled for this division': 'O golden score está desativado para esta divisão',
  'Fight is not tied — the leader wins at the end of regular time':
    'A luta não está empatada — quem está à frente vence ao fim do tempo regular',
  'Already in golden score': 'A luta já está em golden score',
  'Osaekomi already running': 'Já há um osaekomi em andamento',
  'No osaekomi running': 'Não há osaekomi em andamento',
  'Ippon already scored': 'Ippon já foi marcado',
  'Two waza-ari already scored': 'Os dois waza-ari já foram marcados',
  'Three shido already given': 'Os três shido já foram dados',
  'No ippon to remove': 'Não há ippon para remover',
  'No waza-ari to remove': 'Não há waza-ari para remover',
  'No yuko to remove': 'Não há yuko para remover',
  'No shido to remove': 'Não há shido para remover',
  // Check-in / weigh-in
  'Athlete already checked in for this event': 'Esta atleta já fez check-in neste evento',
  'Attendance not found': 'Registro de check-in não encontrado',
  'Check-in already undone': 'Este check-in já foi desfeito',
}

export function translateApiError(message: string): string {
  if (API_ERROR_TRANSLATIONS[message]) return API_ERROR_TRANSLATIONS[message]
  const transitionMatch = message.match(/^Cannot transition entry from "(.+)" to "(.+)"$/)
  if (transitionMatch) {
    const [, from, to] = transitionMatch
    return `Não é possível mover a inscrição de "${EVENT_ENTRY_STATUS_LABELS[from!] ?? from}" para "${EVENT_ENTRY_STATUS_LABELS[to!] ?? to}"`
  }
  const restingMatch = message.match(/^Athlete still resting for (\d+)s — retry with ignoreRest to override$/)
  if (restingMatch) {
    return `Atleta ainda em descanso por ${restingMatch[1]}s — force novamente ignorando o descanso, se necessário`
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
