// Pure, no I/O. Privacy rule for PUBLIC screens (scoreboard display,
// next-matches board, public prints): when the event sets
// `publicHideNamesUnderAge`, athletes younger than that at the event date
// appear as "FirstName L." — operator/staff views always get the full name.

export function ageAt(birthDate: string, referenceDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [ry, rm, rd] = referenceDate.split('-').map(Number) as [number, number, number]
  let age = ry - by
  if (rm < bm || (rm === bm && rd < bd)) age--
  return age
}

export function publicDisplayName(
  fullName: string,
  birthDate: string | undefined,
  eventDate: string,
  hideUnderAge: number | null,
): string {
  if (hideUnderAge === null || !birthDate) return fullName
  if (ageAt(birthDate, eventDate) >= hideUnderAge) return fullName

  const parts = fullName.trim().split(/\s+/)
  const first = parts[0] ?? fullName
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  return last ? `${first} ${last[0]?.toUpperCase()}.` : first
}
