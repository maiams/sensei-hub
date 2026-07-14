import { describe, it, expect } from 'vitest'
import { calculateAgeClass, getWeightCategories, assignWeightCategory, AgeClassServiceError } from '../services/AgeClassService.js'

describe('calculateAgeClass', () => {
  const cases: Array<[string, string, string]> = [
    ['2016-06-15', '2026-06-15', 'mirim'],       // turns 10 exactly on event day
    ['2016-06-16', '2026-06-15', 'pre_mirim'],   // turns 10 the day after — still 9
    ['2019-01-01', '2026-06-15', 'pre_mirim'],   // 7
    ['2014-06-15', '2026-06-15', 'infantil'],    // exactly 12
    ['2013-06-15', '2026-06-15', 'infantil'],    // exactly 13
    ['2012-06-15', '2026-06-15', 'infanto_juvenil'], // exactly 14
    ['2011-06-15', '2026-06-15', 'infanto_juvenil'], // exactly 15
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
    // Turns 12 the day after the event -> still 11 on event day
    expect(calculateAgeClass('2014-06-16', '2026-06-15')).toBe('mirim')
  })

  it('throws when event date is before birth date', () => {
    expect(() => calculateAgeClass('2020-01-01', '2019-01-01')).toThrow(AgeClassServiceError)
  })

  it('throws when age is below the youngest configured class', () => {
    expect(() => calculateAgeClass('2025-01-01', '2026-06-15')).toThrow(AgeClassServiceError)
  })
})

describe('getWeightCategories', () => {
  it('returns the 7-category adult ladder for male senior', () => {
    const categories = getWeightCategories('male', 'senior')
    expect(categories.map((c) => c.label)).toEqual([
      'Leve Extra', 'Meio-Leve', 'Leve', 'Meio-Médio', 'Médio', 'Meio-Pesado', 'Pesado',
    ])
    expect(categories[categories.length - 1]?.maxKg).toBeNull()
  })

  it('returns the 7-category adult ladder for female veteran classes', () => {
    const categories = getWeightCategories('female', 'veteran_j1')
    expect(categories).toHaveLength(7)
  })

  it('throws for youth classes (not configured)', () => {
    expect(() => getWeightCategories('male', 'infantil')).toThrow(AgeClassServiceError)
  })

  it('throws when gender is not_informed', () => {
    expect(() => getWeightCategories('not_informed', 'senior')).toThrow(AgeClassServiceError)
  })
})

describe('assignWeightCategory', () => {
  it('assigns the exact boundary weight to the lower category (male senior)', () => {
    expect(assignWeightCategory(60, 'male', 'senior').label).toBe('Leve Extra')
    expect(assignWeightCategory(60.1, 'male', 'senior').label).toBe('Meio-Leve')
    expect(assignWeightCategory(66, 'male', 'senior').label).toBe('Meio-Leve')
  })

  it('assigns the open category above the last boundary', () => {
    expect(assignWeightCategory(150, 'male', 'senior').label).toBe('Pesado')
    expect(assignWeightCategory(100.5, 'male', 'senior').label).toBe('Pesado')
  })

  it('assigns female boundaries correctly', () => {
    expect(assignWeightCategory(48, 'female', 'senior').label).toBe('Ligeiro')
    expect(assignWeightCategory(48.1, 'female', 'senior').label).toBe('Meio-Leve')
    expect(assignWeightCategory(90, 'female', 'senior').label).toBe('Pesado')
  })
})
