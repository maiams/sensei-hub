import { createApiErrorTranslator } from '@sensei-hub/core-web'

export {
  BELT_LABELS,
  BELT_OPTIONS,
  GENDER_LABELS,
  GENDER_OPTIONS,
  isMinor,
  formatDate,
} from '@sensei-hub/core-web'

export const EVENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  registration: 'Inscrições abertas',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

export const EVENT_STATUS_OPTIONS = Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))

// Phrased as noun-phrases describing the status of the *inscrição* (entry)
// rather than adjectives agreeing with the athlete's gender — "Inscrita"/
// "Confirmada" read as if describing the person and were wrong for male
// athletes; "Inscrição feita"/"Confirmação feita" are gender-neutral.
export const EVENT_ENTRY_STATUS_LABELS: Record<string, string> = {
  incomplete: 'Cadastro incompleto',
  registered: 'Inscrição feita',
  checked_in: 'Check-in feito',
  weighed_in: 'Pesagem feita',
  confirmed: 'Confirmação feita',
  disqualified: 'Desclassificação registrada',
  withdrawn: 'Retirada registrada',
}

export const OVERWEIGHT_POLICY_LABELS: Record<string, string> = {
  disqualify: 'Desclassificar automaticamente',
  reallocate: 'Realocar para a categoria correta',
}

export const OVERWEIGHT_POLICY_OPTIONS = Object.entries(OVERWEIGHT_POLICY_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export const USER_ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  academy_admin: 'Admin da academia',
  event_manager: 'Gestor do evento',
  coach: 'Treinador',
  staff: 'Equipe/recepção',
  weigh_in_operator: 'Operador de pesagem',
  scoreboard_operator: 'Mesário/placar',
  athlete: 'Atleta',
  guardian: 'Responsável',
}

// Roles an academy_admin can hand out from the Arena's user-management screen.
// Deliberately excludes super_admin/academy_admin (elevated — not meant to be
// self-service here) and athlete/guardian (not Arena staff accounts; those
// come from the Dojô/event entries, not this screen).
export const ARENA_ASSIGNABLE_ROLES = ['event_manager', 'staff', 'weigh_in_operator', 'scoreboard_operator'] as const

const ARENA_API_ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid CPF': 'CPF inválido',
  'CPF already registered in this organization': 'Este CPF já está cadastrado nesta organização',
  'Guardian name and phone are required for athletes under 18':
    'Nome e telefone do responsável são obrigatórios para atletas menores de 18 anos',
  'Athlete not found': 'Atleta não encontrado',
  'Weight record not found': 'Registro de peso não encontrado',
  'Correction reason is required': 'É necessário informar o motivo da correção',
  'Event not found': 'Evento não encontrado',
  'Division not found': 'Divisão não encontrada',
  'Entry not found': 'Inscrição não encontrada',
  'Cannot delete a division that has entries': 'Não é possível apagar uma divisão que já tem inscrições',
  'Athlete is already registered in this division': 'Esta atleta já está inscrita nesta divisão',
  // Bracket / matches
  'No active bracket for this division': 'Nenhuma chave ativa para esta divisão',
  'A bracket already exists for this division — pass force to regenerate': 'Já existe uma chave ativa para esta divisão',
  'No confirmed entries in this division': 'Não há inscrições confirmadas nesta divisão',
  'At least 2 athletes are required': 'É preciso pelo menos 2 atletas confirmadas para gerar a chave',
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
  // Users
  'Email already in use': 'Este e-mail já está cadastrado',
  'Cannot assign a role higher than your own': 'Você não pode atribuir um papel maior que o seu',
}

export const translateApiError = createApiErrorTranslator(ARENA_API_ERROR_TRANSLATIONS, [
  (message) => {
    const m = message.match(/^Cannot transition entry from "(.+)" to "(.+)"$/)
    if (!m) return null
    const [, from, to] = m
    return `Não é possível mover a inscrição de "${EVENT_ENTRY_STATUS_LABELS[from!] ?? from}" para "${EVENT_ENTRY_STATUS_LABELS[to!] ?? to}"`
  },
  (message) => {
    const m = message.match(/^Athlete still resting for (\d+)s — retry with ignoreRest to override$/)
    if (!m) return null
    return `Atleta ainda em descanso por ${m[1]}s — force novamente ignorando o descanso, se necessário`
  },
  (message) => {
    const m = message.match(/^Rodízio only supports 3–6 athletes \(got (\d+)\)$/)
    if (!m) return null
    return `O rodízio só aceita de 3 a 6 atletas confirmadas (esta divisão tem ${m[1]})`
  },
  (message) => {
    const m = message.match(/^(\d+) athletes do not fit in a Chave-(\d+)$/)
    if (!m) return null
    return `${m[1]} atletas não cabem numa chave de ${m[2]}`
  },
])
