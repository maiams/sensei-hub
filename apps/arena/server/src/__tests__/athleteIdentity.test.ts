import { describe, it, expect } from 'vitest'
import { resolveAthleteIdentity, maskCPF } from '@arena/shared'

// Pure cascade — no DB. This is the "duas Alices" fix: two athletes with
// the same name at the check-in desk or the scoring table need a display
// identifier the operator can actually tell apart. The real seed data (the
// FPJ spreadsheet used to load the demo event) leaves federationNumber,
// zempoNumber and cpf blank for every athlete, so birthDate — the one
// required field — has to be a reliable last resort.
describe('resolveAthleteIdentity', () => {
  it('prefers federationNumber when present', () => {
    const identity = resolveAthleteIdentity({
      federationNumber: '12345',
      zempoNumber: '999',
      cpf: '11144477735',
      birthDate: '2012-03-01',
    })
    expect(identity).toEqual({ label: 'Federação 12345', source: 'federation' })
  })

  it('falls back to zempoNumber (generic label — never the source system name)', () => {
    const identity = resolveAthleteIdentity({
      zempoNumber: '998877',
      cpf: '11144477735',
      birthDate: '2012-03-01',
    })
    expect(identity.label).toBe('Reg. 998877')
    expect(identity.label.toLowerCase()).not.toContain('zempo')
    expect(identity.source).toBe('external_registration')
  })

  it('falls back to a masked CPF — never the full number', () => {
    const identity = resolveAthleteIdentity({ cpf: '111.444.777-35', birthDate: '2012-03-01' })
    expect(identity.label).toBe('CPF ***.***.***-35')
    expect(identity.label).not.toContain('111.444.777-35')
    expect(identity.label).not.toContain('11144477735')
    expect(identity.source).toBe('cpf')
  })

  it('falls back to birth year when nothing else is available (the real-world common case)', () => {
    const identity = resolveAthleteIdentity({ birthDate: '2012-07-15' })
    expect(identity).toEqual({ label: 'nasc. 2012', source: 'birth_year' })
  })

  it('treats blank/whitespace-only optional fields as absent', () => {
    const identity = resolveAthleteIdentity({
      federationNumber: '   ',
      zempoNumber: '',
      cpf: undefined,
      birthDate: '2014-01-01',
    })
    expect(identity).toEqual({ label: 'nasc. 2014', source: 'birth_year' })
  })
})

describe('maskCPF', () => {
  it('masks all but the last 2 digits of an 11-digit CPF', () => {
    expect(maskCPF('11144477735')).toBe('***.***.***-35')
    expect(maskCPF('111.444.777-35')).toBe('***.***.***-35')
  })

  it('masks fully when the input is not a valid 11-digit CPF', () => {
    expect(maskCPF('123')).toBe('***.***.***-**')
    expect(maskCPF('')).toBe('***.***.***-**')
  })
})
