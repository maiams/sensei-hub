# CLAUDE.md — Local Judo Academy Platform

This project is a local-first judo academy management and competition platform inspired by the functional category of systems like Zempo, but it must not copy Zempo’s brand, code, visual identity, proprietary workflows, database structure, protected content, or private behavior.

The goal is to build an independent system for academies, clubs, and local tournaments.

## Product Vision

Build a practical platform for judo academies to manage athletes, classes, check-ins, weigh-ins, internal events, brackets, scoreboards, and local competitions.

The system should work well for a single academy first, then support multiple academies later.

The product must be useful in real gym conditions: limited staff, noisy environment, mobile phones, unstable internet, quick registration flows, and simple operation by non-technical users.

## Product Scope

The platform should support:

* Academy management.
* Athlete registration.
* Coach and staff access.
* Mobile check-in.
* Weigh-in flow.
* Competition/event creation.
* Bracket generation.
* Match scheduling.
* Scoreboard operation.
* Basic ranking/history.
* Attendance history.
* Athlete profile.
* Belt/rank tracking.
* Weight category tracking.
* Local reports.

This is not initially a national federation system.

Do not overbuild federation-level complexity before the academy-level product is stable.

## Core Users

Primary users:

* Academy owner.
* Coach.
* Assistant coach.
* Front desk/admin staff.
* Athlete.
* Parent or guardian.
* Event operator.
* Scoreboard operator.
* Weigh-in operator.

Each user type must have explicit permissions.

Never assume that all authenticated users can see or change all data.

## Domain Concepts

Important entities:

* Academy
* User
* Athlete
* Guardian
* Coach
* Staff member
* Class
* Attendance/check-in
* Belt/rank
* Weight record
* Event
* Division/category
* Bracket
* Match
* Scoreboard
* Penalty
* Result
* Medical/eligibility flag
* Device/session
* Audit log

The model should be designed so a future multi-academy version is possible, even if the first release only supports one academy.

## MVP Priorities

The first usable version should prioritize:

1. Athlete registration.
2. Academy staff login.
3. Mobile check-in.
4. Manual weigh-in entry.
5. Event creation.
6. Category/division setup.
7. Bracket creation.
8. Match list.
9. Scoreboard screen.
10. Result saving.
11. Basic athlete history.

Avoid adding advanced ranking, payment, federation integrations, or complex analytics until the core competition flow works end to end.

## Non-Negotiable Product Rules

Do not copy Zempo.

Do not scrape, import, or reproduce proprietary Zempo data unless the user provides legal authorization and an explicit data source.

Do not use Zempo branding, names, icons, layout, or private workflow assumptions.

This project may be inspired by common sports-management concepts, but it must remain original.

## Local-First Assumption

The product is intended for local academy use.

Design for:

* One academy running a small internal tournament.
* Multiple mats in the same venue.
* Staff using phones or tablets.
* A public display showing the scoreboard.
* Intermittent connectivity.
* Fast correction of human mistakes.
* Simple recovery from operator errors.

Whenever possible, workflows should tolerate bad internet and allow safe retry.

## Mobile Check-In

The check-in flow should be simple and fast.

Possible check-in methods:

* QR code.
* Short code.
* Staff-assisted search.
* Phone number or document search, if legally appropriate.
* Guardian-assisted check-in for minors.

Check-in must record:

* Athlete
* Academy
* Event or class
* Timestamp
* Check-in method
* Operator, if staff-assisted
* Device/session metadata when useful

Check-in must prevent obvious duplicates but allow authorized correction.

## Weigh-In Integration

The system should support both manual and integrated weigh-in.

Manual weigh-in:

* Operator selects athlete.
* Operator enters weight.
* System validates expected category.
* System records timestamp and operator.
* System allows correction with audit trail.

Integrated weigh-in:

* System can receive weight from a scale or external local service.
* Integration must be isolated behind an adapter/service layer.
* Do not hardcode a single hardware vendor into the domain model.
* All readings must be confirmable by an operator before becoming official.
* Failed hardware integration must not block manual operation.

A weight record should include:

* Athlete ID
* Event ID, if applicable
* Weight value
* Unit
* Source: manual, scale, imported, corrected
* Operator ID
* Timestamp
* Correction reason, if corrected
* Original record reference, if corrected

## Scoreboard

The scoreboard must be reliable, visible, and simple.

It should support:

* Athlete names.
* Academy/team names.
* Category/division.
* Match timer.
* Osaekomi timer, if implemented.
* Scores.
* Penalties.
* Match state.
* Winner.
* Method of victory.
* Manual correction.
* Operator controls.
* Public display mode.

The operator screen and the public display should be separate views.

The public display must not expose admin controls.

Scoreboard state should be persisted frequently enough to recover from refreshes or device failure.

Do not assume the scoreboard rules are universal. Rules may vary by event, age group, federation, or local policy. Encapsulate scoring rules so they can evolve.

## Brackets and Matches

Bracket generation should be deterministic and auditable.

For the MVP, prefer simple formats:

* Single elimination.
* Round-robin for small groups.
* Manual match creation/editing.

Advanced formats can come later.

Bracket logic should be tested carefully.

Important edge cases:

* Odd number of athletes.
* Athlete no-show.
* Athlete moved to another category.
* Duplicate athlete entry.
* Same academy pairing avoidance, if required.
* Manual seeding.
* Late registration.
* Withdrawal after bracket generation.
* Match result correction.

## Permissions

Use role-based access control from the beginning.

Suggested roles:

* Super admin
* Academy admin
* Coach
* Staff
* Event manager
* Weigh-in operator
* Scoreboard operator
* Athlete
* Guardian

Permission checks must be enforced server-side.

Frontend hiding is not authorization.

## Audit Trail

The system must keep audit logs for important actions:

* Athlete creation/update.
* Check-in.
* Weigh-in.
* Weight correction.
* Event creation/update.
* Bracket generation.
* Match result entry.
* Match result correction.
* Scoreboard correction.
* Permission changes.

Audit logs should answer:

* Who did it?
* What changed?
* When did it happen?
* From where/session/device?
* What was the previous value?
* What is the new value?
* Why was it corrected, when applicable?

## Data Privacy

The system may handle personal data, including minors.

Use data minimization.

Do not collect sensitive data unless required.

Do not expose athlete personal information publicly.

Public screens should show only the information needed for the event.

Guardian access must be scoped only to linked athletes.

Avoid storing documents unless absolutely required.

If documents are stored, protect them carefully.

## Architecture Principles

Prefer a clean, boring, maintainable architecture.

Suggested layers:

* UI
* API/routes/controllers
* Application services/use cases
* Domain models
* Repositories/data access
* External integrations/adapters
* Background jobs, if needed

Keep domain logic out of UI components.

Keep integration logic out of core domain models.

Use clear boundaries for:

* Authentication
* Authorization
* Check-in
* Weigh-in
* Bracket generation
* Scoreboard state
* Reporting

## Technical Quality Bar

All important business logic must be testable without requiring the full UI.

Test especially:

* Permission checks.
* Check-in duplicate prevention.
* Weigh-in validation and correction.
* Category assignment.
* Bracket generation.
* Match result transitions.
* Scoreboard state transitions.
* Audit log creation.

Do not trust manual testing alone for tournament logic.

## Integration Design

External hardware and systems must be integrated through adapters.

Do not let hardware-specific details leak into the database schema unless necessary.

Examples:

* ScaleAdapter
* CheckInDeviceAdapter
* ScoreboardDisplayAdapter
* NotificationAdapter

Each adapter should have a clear interface and a mock implementation for tests.

The app must continue working manually when integrations fail.

## Offline and Resilience

Because events may happen in gyms with unstable internet, consider resilience from the beginning.

Important behaviors:

* Safe retry.
* Idempotent operations.
* Clear sync status.
* Local operator feedback.
* No silent data loss.
* Conflict handling.
* Recovery after refresh or crash.

Do not claim offline support unless it is actually implemented and tested.

## UI Principles

The UI should be optimized for real use during events.

Prioritize:

* Large readable text.
* Fast search.
* Few clicks.
* Clear status.
* Mistake recovery.
* Operator confidence.
* Mobile-first flows for check-in.
* Display-friendly scoreboard.

Avoid:

* Dense admin screens during event operation.
* Hidden destructive actions.
* Ambiguous buttons.
* Tiny controls on mobile.
* Overly clever animations.

## Naming

Sensei Hub is the umbrella for two independent products that share the same stack but build and run separately, with separate databases:

* **Sensei Dojô** — academy management (athletes, anamnese, guardians, belts, weight tracking, staff). Code under `apps/dojo/`.
* **Sensei Arena** — championship management (events, divisions, entries, check-in, weigh-in, brackets, matches, areas, scoreboard, public display, printing, Excel import, PWA/offline, mDNS cluster). Code under `apps/arena/`.

The two integrate only by file (the Dojô exports an `.xlsx` the Arena imports), never at runtime. Shared technical code lives in `packages/` (`@sensei-hub/shared`, `core-server`, `core-web`, `desktop-runtime`). See `docs/status-e-plano.md` §3 for the full structure and the domain bridges (AuthCtx, the slim Arena competitor vs. the full Dojô athlete, the split weight records, the export/import contract).

When adding a feature, first decide which product it belongs to; keep academy-management concerns out of the Arena and championship concerns out of the Dojô.

## Acceptance Criteria for New Features

Every new feature should define:

* User role.
* User goal.
* Preconditions.
* Main flow.
* Edge cases.
* Permission rules.
* Data created or changed.
* Audit requirements.
* Validation rules.
* Test cases.
* Failure behavior.

Do not implement vague features without converting them into acceptance criteria.

## Development Discipline

Before implementing, inspect the existing codebase.

Before changing architecture, explain the trade-off.

Before adding dependencies, justify them.

Before modifying data models, consider migration impact.

Before changing permission logic, add or update tests.

Before declaring completion, run relevant checks.

## Default Implementation Order

For product features, prefer this order:

1. Define the domain model.
2. Define permissions.
3. Define API contract.
4. Add tests for business logic.
5. Implement backend logic.
6. Implement UI.
7. Add audit logs.
8. Add validation.
9. Verify with realistic scenarios.
10. Document usage.

## What Claude Must Push Back On

Claude must push back if asked to:

* Copy Zempo directly.
* Reproduce proprietary screens or branding.
* Skip authorization.
* Store sensitive athlete data casually.
* Build scoreboard logic without tests.
* Implement weigh-in without audit trail.
* Allow result correction without history.
* Treat frontend validation as sufficient security.
* Add complex federation features before the local MVP works.
* Add AI features before the core workflow is reliable.
* Ignore minors’ privacy.

## Good Default Response

When working on this project, Claude should respond with:

* Clear assumptions.
* A focused implementation plan.
* Risks and trade-offs.
* Small, reviewable changes.
* Verification steps.
* Honest limitations.

The product should feel simple for the academy, but the engineering underneath must be careful, auditable, and reliable.
