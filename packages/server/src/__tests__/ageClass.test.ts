import { describe, it, expect } from 'vitest'
import { calculateAgeClass, getWeightCategories, assignWeightCategory, AgeClassServiceError } from '../services/AgeClassService.js'

// Boundaries follow FPJ's "Tabelas de Classes e Categorias 2026" (Sub-09/11/13/15/18),
// "conforme tabela da CBJ" — see comment in AgeClassService.ts for the source.
describe('calculateAgeClass', () => {
  const cases: Array<[string, string, string]> = [
    ['2019-06-15', '2026-06-15', 'pre_mirim'],   // exactly 7
    ['2018-06-15', '2026-06-15', 'pre_mirim'],   // exactly 8
    ['2017-06-15', '2026-06-15', 'mirim'],       // exactly 9
    ['2016-06-15', '2026-06-15', 'mirim'],       // exactly 10
    ['2015-06-15', '2026-06-15', 'infantil'],    // exactly 11
    ['2014-06-15', '2026-06-15', 'infantil'],    // exactly 12
    ['2013-06-15', '2026-06-15', 'infanto_juvenil'], // exactly 13
    ['2012-06-15', '2026-06-15', 'infanto_juvenil'], // exactly 14
    ['2011-06-15', '2026-06-15', 'juvenil'],     // exactly 15
    ['2010-06-15', '2026-06-15', 'juvenil'],     // exactly 16
    ['2009-06-15', '2026-06-15', 'juvenil'],     // exactly 17
    ['2008-06-15', '2026-06-15', 'junior'],      // exactly 18
    ['2006-06-15', '2026-06-15', 'junior'],      // exactly 20
    ['2005-06-15', '2026-06-15', 'senior'],      // exactly 21
    ['1997-06-15', '2026-06-15', 'senior'],      // exactly 29
    ['1996-06-15', '2026-06-15', 'veteran_j1'],  // exactly 30
    ['1987-06-15', '2026-06-15', 'veteran_j1'],  // exactly 39
    ['1986-06-15', '2026-06-15', 'veteran_j2'],  // exactly 40
    ['1977-06-15', '2026-06-15', 'veteran_j2'],  // exactly 49
    ['1976-06-15', '2026-06-15', 'veteran_m3'],  // exactly 50
    ['1967-06-15', '2026-06-15', 'veteran_m3'],  // exactly 59
    ['1966-06-15', '2026-06-15', 'veteran_m4'],  // exactly 60
    ['1957-06-15', '2026-06-15', 'veteran_m4'],  // exactly 69
    ['1956-06-15', '2026-06-15', 'veteran_m5'],  // exactly 70
    ['1926-06-15', '2026-06-15', 'veteran_m5'],  // exactly 100
  ]

  it.each(cases)('birthDate=%s eventDate=%s -> %s', (birthDate, eventDate, expected) => {
    expect(calculateAgeClass(birthDate, eventDate)).toBe(expected)
  })

  it('birthday not yet reached on event date counts the younger age', () => {
    // Turns 11 the day after the event -> still 10 (mirim) on event day
    expect(calculateAgeClass('2015-06-16', '2026-06-15')).toBe('mirim')
  })

  it('throws when event date is before birth date', () => {
    expect(() => calculateAgeClass('2020-01-01', '2019-01-01')).toThrow(AgeClassServiceError)
  })

  it('throws when age is below the youngest configured class', () => {
    expect(() => calculateAgeClass('2025-01-01', '2026-06-15')).toThrow(AgeClassServiceError)
  })
})

// Weight tables follow the same FPJ/CBJ source referenced above.
describe('getWeightCategories', () => {
  it('returns the 7-category adult ladder for male senior', () => {
    const categories = getWeightCategories('male', 'senior')
    expect(categories.map((c) => c.label)).toEqual([
      'Ligeiro', 'Meio Leve', 'Leve', 'Meio Médio', 'Médio', 'Meio Pesado', 'Pesado',
    ])
    expect(categories[categories.length - 1]?.maxKg).toBeNull()
  })

  it('returns the same adult ladder for junior and veteran classes', () => {
    expect(getWeightCategories('male', 'junior')).toEqual(getWeightCategories('male', 'senior'))
    expect(getWeightCategories('female', 'veteran_j1')).toEqual(getWeightCategories('female', 'senior'))
  })

  it('returns the 10-category male pre_mirim (Sub-09) ladder', () => {
    const categories = getWeightCategories('male', 'pre_mirim')
    expect(categories.map((c) => c.label)).toEqual([
      'Super Ligeiro', 'Ligeiro', 'Meio Leve', 'Leve', 'Meio Médio',
      'Médio', 'Meio Pesado', 'Pesado', 'Super Pesado', 'Extra Pesado',
    ])
    expect(categories.map((c) => c.maxKg)).toEqual([23, 26, 29, 32, 36, 40, 45, 50, 55, null])
  })

  it('returns the 9-category female infantil (Sub-13) ladder', () => {
    const categories = getWeightCategories('female', 'infantil')
    expect(categories.map((c) => c.maxKg)).toEqual([32, 36, 40, 44, 48, 52, 57, 63, null])
  })

  it('returns the 8-category male juvenil (Cadete/Sub-18) ladder', () => {
    const categories = getWeightCategories('male', 'juvenil')
    expect(categories.map((c) => c.maxKg)).toEqual([50, 55, 60, 66, 73, 81, 90, null])
  })

  it('throws when gender is not_informed', () => {
    expect(() => getWeightCategories('not_informed', 'senior')).toThrow(AgeClassServiceError)
  })
})

describe('assignWeightCategory', () => {
  it('assigns the exact boundary weight to the lower category (male senior)', () => {
    expect(assignWeightCategory(60, 'male', 'senior').label).toBe('Ligeiro')
    expect(assignWeightCategory(60.1, 'male', 'senior').label).toBe('Meio Leve')
    expect(assignWeightCategory(66, 'male', 'senior').label).toBe('Meio Leve')
  })

  it('assigns the open category above the last boundary', () => {
    expect(assignWeightCategory(150, 'male', 'senior').label).toBe('Pesado')
    expect(assignWeightCategory(100.5, 'male', 'senior').label).toBe('Pesado')
  })

  it('assigns female boundaries correctly', () => {
    expect(assignWeightCategory(48, 'female', 'senior').label).toBe('Ligeiro')
    expect(assignWeightCategory(48.1, 'female', 'senior').label).toBe('Meio Leve')
    expect(assignWeightCategory(90, 'female', 'senior').label).toBe('Pesado')
  })

  it('assigns youth boundaries correctly (male mirim / Sub-11)', () => {
    expect(assignWeightCategory(28, 'male', 'mirim').label).toBe('Super Ligeiro')
    expect(assignWeightCategory(28.1, 'male', 'mirim').label).toBe('Ligeiro')
    expect(assignWeightCategory(61, 'male', 'mirim').label).toBe('Extra Pesado')
  })
})
