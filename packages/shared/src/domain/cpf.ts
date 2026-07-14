// Pure CPF (Brazilian tax ID) validation — no I/O, checks verification digits.
export function isValidCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false

  const checkDigit = (base: string): number => {
    let sum = 0
    let factor = base.length + 1
    for (const digit of base) {
      sum += Number(digit) * factor
      factor--
    }
    const result = (sum * 10) % 11
    return result === 10 ? 0 : result
  }

  const base9 = digits.slice(0, 9)
  const d1 = checkDigit(base9)
  const d2 = checkDigit(base9 + d1)
  return digits === `${base9}${d1}${d2}`
}
