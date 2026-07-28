// apps/arena/web/src/lib/athleteIdentity.ts is a thin re-export of
// @arena/shared's cascade — this exercises it through the SAME import path
// the actual screens use (check-in search, table operation), so a future
// change to that re-export (e.g. accidentally re-exporting the wrong thing)
// would be caught here, not just in @arena/server's copy of this test.
//
// The one rule that must never break: a CPF is a sensitive government ID
// (frequently belonging to a minor) and must NEVER appear unmasked in any
// label this cascade produces.
import { describe, it, expect } from 'vitest'
import { resolveAthleteIdentity, maskCPF } from '../athleteIdentity'

describe('resolveAthleteIdentity — cascade order', () => {
  it('prefers federationNumber over everything else', () => {
    const identity = resolveAthleteIdentity({
      federationNumber: 'FPJ-4321',
      zempoNumber: 'Z-1',
      cpf: '111.444.777-35',
      birthDate: '2000-01-01',
    })
    expect(identity).toEqual({ label: 'Federação FPJ-4321', source: 'federation' })
  })

  it('falls back to zempoNumber when federationNumber is absent', () => {
    const identity = resolveAthleteIdentity({
      zempoNumber: 'Z-99',
      cpf: '111.444.777-35',
      birthDate: '2000-01-01',
    })
    expect(identity).toEqual({ label: 'Reg. Z-99', source: 'external_registration' })
  })

  it('falls back to a masked CPF when federationNumber and zempoNumber are absent', () => {
    const identity = resolveAthleteIdentity({ cpf: '111.444.777-35', birthDate: '2012-03-01' })
    expect(identity.source).toBe('cpf')
    expect(identity.label).toBe('CPF ***.***.***-35')
  })

  it('falls back to birth year, never the full date, when nothing else is present', () => {
    const identity = resolveAthleteIdentity({ birthDate: '2012-07-15' })
    expect(identity).toEqual({ label: 'nasc. 2012', source: 'birth_year' })
    expect(identity.label).not.toContain('07-15')
  })

  it('treats blank/whitespace-only fields as absent, not as a value to display', () => {
    const identity = resolveAthleteIdentity({
      federationNumber: '   ',
      zempoNumber: '',
      cpf: '111.444.777-35',
      birthDate: '2012-03-01',
    })
    expect(identity.source).toBe('cpf')
  })
})

describe('maskCPF', () => {
  it('keeps only the last 2 digits visible', () => {
    expect(maskCPF('111.444.777-35')).toBe('***.***.***-35')
  })

  it('masks an unformatted (digits-only) CPF the same way', () => {
    expect(maskCPF('11144477735')).toBe('***.***.***-35')
  })

  it('never leaks a malformed/partial CPF — masks fully generic instead of guessing', () => {
    expect(maskCPF('123')).toBe('***.***.***-**')
    expect(maskCPF('')).toBe('***.***.***-**')
    expect(maskCPF('not-a-cpf-at-all')).toBe('***.***.***-**')
  })

  it('NEVER returns the input string verbatim for a real 11-digit CPF', () => {
    const raw = '111.444.777-35'
    const masked = maskCPF(raw)
    expect(masked).not.toBe(raw)
    // The 9 leading digits must not appear anywhere in the output.
    expect(masked).not.toContain('111')
    expect(masked).not.toContain('444')
    expect(masked).not.toContain('777')
  })
})
