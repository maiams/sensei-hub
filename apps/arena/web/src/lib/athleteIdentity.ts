// Single reusable helper for the "which Alice is this" problem — check-in
// search, table operation and (per the contract in this file's own history)
// the event roster listing all resolve an athlete's display identifier the
// same way. The canonical cascade + CPF masking logic lives in
// @arena/shared/src/athleteIdentity.ts so server and web never drift: some
// screens (check-in, which already downloads the full competitor registry
// for offline-safe search) resolve it client-side from data already in
// hand; others (table operation, scoreboard) receive it pre-resolved from
// the server, which deliberately never sends raw federationNumber/
// zempoNumber/cpf to those lower-privilege, name-only DTOs.
export {
  resolveAthleteIdentity,
  maskCPF,
  type AthleteIdentity,
  type AthleteIdentitySource,
  type AthleteIdentitySourceKind,
} from '@arena/shared'
