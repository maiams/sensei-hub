import { z } from 'zod'

// Judo-wide vocabulary used by both products: the dojo keeps the athlete's
// belt progression, the arena uses belt/gender for divisions and seeding, and
// both record weights (dojo tracking vs. event weigh-in).
export const BELT_VALUES = [
  'white', 'burgundy', 'gray', 'blue', 'yellow', 'orange', 'green', 'purple', 'brown',
  'black-1dan', 'black-2dan', 'black-3dan', 'black-4dan', 'black-5dan',
  'coral-6dan', 'coral-7dan', 'coral-8dan',
  'red-9dan', 'red-10dan',
] as const

export const Belt = z.enum(BELT_VALUES)
export type Belt = z.infer<typeof Belt>

export const Gender = z.enum(['male', 'female', 'not_informed'])
export type Gender = z.infer<typeof Gender>

// Fixed column order (A–N) of the athlete-registration spreadsheet — the
// dojo→arena interchange contract. The dojo's export writes these columns and
// the arena's import template/parser reads them; position matters, header
// text is a label only.
export const ATHLETE_SHEET_HEADERS = [
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
] as const

// Canonical Portuguese belt labels — the dojo→arena spreadsheet contract:
// the dojo's athlete export writes these labels and the arena's import
// parses them (case/accent-insensitively), so both sides derive from this
// single table and cannot drift apart.
export const BELT_LABEL_PT: Record<Belt, string> = {
  white: 'Branca',
  burgundy: 'Bordô',
  gray: 'Cinza',
  blue: 'Azul',
  yellow: 'Amarela',
  orange: 'Laranja',
  green: 'Verde',
  purple: 'Roxa',
  brown: 'Marrom',
  'black-1dan': 'Preta 1º Dan',
  'black-2dan': 'Preta 2º Dan',
  'black-3dan': 'Preta 3º Dan',
  'black-4dan': 'Preta 4º Dan',
  'black-5dan': 'Preta 5º Dan',
  'coral-6dan': 'Coral 6º Dan',
  'coral-7dan': 'Coral 7º Dan',
  'coral-8dan': 'Coral 8º Dan',
  'red-9dan': 'Vermelha 9º Dan',
  'red-10dan': 'Vermelha 10º Dan',
}

export const WeightSource = z.enum(['manual', 'scale', 'import', 'corrected'])
export type WeightSource = z.infer<typeof WeightSource>
