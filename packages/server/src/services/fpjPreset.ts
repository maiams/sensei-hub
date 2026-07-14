import type { WeightCategoryRow } from '@sensei-hub/shared'

// Static seed data, no I/O. Source: FPJ (Federação Paulista de Judô) "Tabelas de
// Classes e Categorias 2026" (Divisão Aspirante, v2, 03/02/2026, https://fpj.com.br),
// which states it follows the CBJ table. Age boundaries: Sub-09 (7-8), Sub-11
// (9-10), Sub-13 (11-12), Sub-15 (13-14), Cadete/Sub-18 (15-17). The "Adulto"
// bucket (18+) is the source table's own single, unsubdivided-by-age bracket —
// junior/senior/veteran age distinctions are a competition-time concern, not part
// of this preset.
//
// This is only used to power `DivisionTemplateService.loadFpjPreset()` (an
// explicit, one-time "load standard categories" action) and per-group
// "restaurar valores da FPJ" (see `DivisionGroupModel.sourcePreset`). Once
// loaded, every number here is freely editable/deletable by the academy —
// nothing in the app re-reads this file as an implicit fallback.
export interface FpjPresetTemplate {
  key: string
  label: string
  minAge: number
  maxAge: number | null
  categories: {
    male: WeightCategoryRow[]
    female: WeightCategoryRow[]
  }
}

export const FPJ_PRESET_TEMPLATES: FpjPresetTemplate[] = [
  {
    key: 'pre-mirim',
    label: 'Pré-mirim (Sub-09)',
    minAge: 7,
    maxAge: 8,
    categories: {
      male: [
        { label: 'Super Ligeiro', maxKg: 23 },
        { label: 'Ligeiro', maxKg: 26 },
        { label: 'Meio Leve', maxKg: 29 },
        { label: 'Leve', maxKg: 32 },
        { label: 'Meio Médio', maxKg: 36 },
        { label: 'Médio', maxKg: 40 },
        { label: 'Meio Pesado', maxKg: 45 },
        { label: 'Pesado', maxKg: 50 },
        { label: 'Super Pesado', maxKg: 55 },
        { label: 'Extra Pesado', maxKg: null },
      ],
      female: [
        { label: 'Super Ligeiro', maxKg: 23 },
        { label: 'Ligeiro', maxKg: 26 },
        { label: 'Meio Leve', maxKg: 29 },
        { label: 'Leve', maxKg: 32 },
        { label: 'Meio Médio', maxKg: 36 },
        { label: 'Médio', maxKg: 40 },
        { label: 'Meio Pesado', maxKg: 45 },
        { label: 'Pesado', maxKg: 50 },
        { label: 'Super Pesado', maxKg: 55 },
        { label: 'Extra Pesado', maxKg: null },
      ],
    },
  },
  {
    key: 'mirim',
    label: 'Mirim (Sub-11)',
    minAge: 9,
    maxAge: 10,
    categories: {
      male: [
        { label: 'Super Ligeiro', maxKg: 28 },
        { label: 'Ligeiro', maxKg: 30 },
        { label: 'Meio Leve', maxKg: 33 },
        { label: 'Leve', maxKg: 36 },
        { label: 'Meio Médio', maxKg: 40 },
        { label: 'Médio', maxKg: 45 },
        { label: 'Meio Pesado', maxKg: 50 },
        { label: 'Pesado', maxKg: 55 },
        { label: 'Super Pesado', maxKg: 60 },
        { label: 'Extra Pesado', maxKg: null },
      ],
      female: [
        { label: 'Super Ligeiro', maxKg: 28 },
        { label: 'Ligeiro', maxKg: 30 },
        { label: 'Meio Leve', maxKg: 33 },
        { label: 'Leve', maxKg: 36 },
        { label: 'Meio Médio', maxKg: 40 },
        { label: 'Médio', maxKg: 45 },
        { label: 'Meio Pesado', maxKg: 50 },
        { label: 'Pesado', maxKg: 55 },
        { label: 'Super Pesado', maxKg: 60 },
        { label: 'Extra Pesado', maxKg: null },
      ],
    },
  },
  {
    key: 'infantil',
    label: 'Infantil (Sub-13)',
    minAge: 11,
    maxAge: 12,
    categories: {
      male: [
        { label: 'Super Ligeiro', maxKg: 35 },
        { label: 'Ligeiro', maxKg: 40 },
        { label: 'Meio Leve', maxKg: 45 },
        { label: 'Leve', maxKg: 50 },
        { label: 'Meio Médio', maxKg: 55 },
        { label: 'Médio', maxKg: 60 },
        { label: 'Meio Pesado', maxKg: 66 },
        { label: 'Pesado', maxKg: 73 },
        { label: 'Super Pesado', maxKg: null },
      ],
      female: [
        { label: 'Super Ligeiro', maxKg: 32 },
        { label: 'Ligeiro', maxKg: 36 },
        { label: 'Meio Leve', maxKg: 40 },
        { label: 'Leve', maxKg: 44 },
        { label: 'Meio Médio', maxKg: 48 },
        { label: 'Médio', maxKg: 52 },
        { label: 'Meio Pesado', maxKg: 57 },
        { label: 'Pesado', maxKg: 63 },
        { label: 'Super Pesado', maxKg: null },
      ],
    },
  },
  {
    key: 'infanto-juvenil',
    label: 'Infanto-juvenil (Sub-15)',
    minAge: 13,
    maxAge: 14,
    categories: {
      male: [
        { label: 'Super Ligeiro', maxKg: 40 },
        { label: 'Ligeiro', maxKg: 45 },
        { label: 'Meio Leve', maxKg: 50 },
        { label: 'Leve', maxKg: 55 },
        { label: 'Meio Médio', maxKg: 60 },
        { label: 'Médio', maxKg: 66 },
        { label: 'Meio Pesado', maxKg: 73 },
        { label: 'Pesado', maxKg: 81 },
        { label: 'Super Pesado', maxKg: null },
      ],
      female: [
        { label: 'Super Ligeiro', maxKg: 36 },
        { label: 'Ligeiro', maxKg: 40 },
        { label: 'Meio Leve', maxKg: 44 },
        { label: 'Leve', maxKg: 48 },
        { label: 'Meio Médio', maxKg: 52 },
        { label: 'Médio', maxKg: 57 },
        { label: 'Meio Pesado', maxKg: 63 },
        { label: 'Pesado', maxKg: 70 },
        { label: 'Super Pesado', maxKg: null },
      ],
    },
  },
  {
    key: 'juvenil',
    label: 'Juvenil (Cadete/Sub-18)',
    minAge: 15,
    maxAge: 17,
    categories: {
      male: [
        { label: 'Super Ligeiro', maxKg: 50 },
        { label: 'Ligeiro', maxKg: 55 },
        { label: 'Meio Leve', maxKg: 60 },
        { label: 'Leve', maxKg: 66 },
        { label: 'Meio Médio', maxKg: 73 },
        { label: 'Médio', maxKg: 81 },
        { label: 'Meio Pesado', maxKg: 90 },
        { label: 'Pesado', maxKg: null },
      ],
      female: [
        { label: 'Super Ligeiro', maxKg: 40 },
        { label: 'Ligeiro', maxKg: 44 },
        { label: 'Meio Leve', maxKg: 48 },
        { label: 'Leve', maxKg: 52 },
        { label: 'Meio Médio', maxKg: 57 },
        { label: 'Médio', maxKg: 63 },
        { label: 'Meio Pesado', maxKg: 70 },
        { label: 'Pesado', maxKg: null },
      ],
    },
  },
  {
    key: 'adulto',
    label: 'Adulto (Júnior, Sênior, Veteranos)',
    minAge: 18,
    maxAge: null,
    categories: {
      male: [
        { label: 'Ligeiro', maxKg: 60 },
        { label: 'Meio Leve', maxKg: 66 },
        { label: 'Leve', maxKg: 73 },
        { label: 'Meio Médio', maxKg: 81 },
        { label: 'Médio', maxKg: 90 },
        { label: 'Meio Pesado', maxKg: 100 },
        { label: 'Pesado', maxKg: null },
      ],
      female: [
        { label: 'Ligeiro', maxKg: 48 },
        { label: 'Meio Leve', maxKg: 52 },
        { label: 'Leve', maxKg: 57 },
        { label: 'Meio Médio', maxKg: 63 },
        { label: 'Médio', maxKg: 70 },
        { label: 'Meio Pesado', maxKg: 78 },
        { label: 'Pesado', maxKg: null },
      ],
    },
  },
]

export function findFpjPresetTemplate(key: string): FpjPresetTemplate | undefined {
  return FPJ_PRESET_TEMPLATES.find((t) => t.key === key)
}
