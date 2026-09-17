# Provenance

Where every part of DECORDA came from, what was scaffolded versus authored,
what it depends on and under which licenses, and what evidence backs the claims
made about it.

## Scope of this repository

This repository is the distribution tree for DECORDA. It contains the product,
its tests, its contracts and its evidence summaries. Development working
records, raw execution evidence and internal tooling are retained privately and
are deliberately not published. Every claim made here is traceable to evidence
recorded at release time; where a claim rests on evidence not published here,
[docs/VERIFICATION.md](docs/VERIFICATION.md) says so explicitly.

## Scaffold

- Generator: official Vega CLI `vega project generate`
- Vega CLI: `1.3.4`
- Active Vega SDK: `0.24.9914`
- Template: `helloWorld` (React Native 0.83)
- Project name: `Decorda`
- Package ID: `com.agentisstudio.decorda`
- Generated: `2026-09-03T18:19:12+01:00`
- Classification: `GENERATOR-PRODUCED`

The generator emitted the following files before any human-authored edit:

| Relative path | Bytes |
|---|---:|
| `.eslintrc` | 624 |
| `.gitignore` | 101 |
| `.prettierrc` | 123 |
| `app.json` | 154 |
| `babel.config.js` | 72 |
| `index.js` | 287 |
| `jest.config.json` | 830 |
| `manifest.toml` | 485 |
| `metro.config.js` | 308 |
| `package.json` | 1,833 |
| `src/App.tsx` | 3,023 |
| `src/assets/background.png` | 697,827 |
| `src/assets/debug.png` | 5,433 |
| `src/assets/get-started.png` | 1,590 |
| `src/assets/home.png` | 747 |
| `src/assets/learn-more.png` | 4,161 |
| `src/assets/vega.png` | 343,965 |
| `src/components/Tile.tsx` | 1,828 |
| `src/data/tiles.tsx` | 1,418 |
| `test/App.spec.tsx` | 607 |
| `test/Tile.spec.tsx` | 940 |
| `tsconfig.json` | 224 |

No lockfile, dependency tree, symlink or repository metadata was emitted by the
generator. **Generator demo source was replaced rather than adapted.** Unused
demo components, tests and assets were removed after their pre-edit provenance
was captured — which is why none of the asset files above appear in this tree.

## Package name disclosure

`package.json` declares `"name": "@amazon-devices/decorda"`. This is the **Vega
generator default**, kept unchanged because it determines the toolchain's build
output paths. The package is marked `"private": true` and is **never published
to npm**. The scoped name implies **no affiliation with, endorsement by, or
origin from Amazon.**

## Human-authored clean-room baseline

DECORDA's source and documentation are authored from the published DECORDA
specification and public API documentation. **No Amazon sample repository, no
private implementation, no external product code and no third-party source was
used as a source.**

The initial clean-room baseline covered `src/App.tsx`, `test/App.spec.tsx`,
`README.md`, `CONTRIBUTING.md`, `PROVENANCE.md` and `.gitignore`. At that
baseline the root `LICENSE` was the unmodified Apache License 2.0 text —
historical state, superseded by the MIT decision recorded at the end of this
document.

Development proceeded in bounded phases. Original and updated files per phase:

### Domain model and synthetic fixtures

- Source authority: frozen public specification v1.0
- Classification: `HUMAN-AUTHORED CLEAN-ROOM`
- Files: `src/domain/types.ts`, `src/domain/fixtures.ts`,
  `test/domain/fixtures.spec.ts`
- Dependencies added: none
- Data boundary: deterministic synthetic fixtures only

### Constraint / feasibility core

- Source authority: frozen public specification v1.0 plus the domain model
- Classification: `HUMAN-AUTHORED CLEAN-ROOM`
- Files: `src/domain/feasibility.ts`, `test/domain/feasibility.spec.ts`
- Dependencies added: none
- Boundary: pure deterministic functions only — no state mutation, no
  persistence, no network or model calls, no UI, no new time representation

### Canonical lifecycle and runtime preparation

- Source authority: frozen public specification v1.0, the persistence contract,
  and the existing clean-room domain/application interfaces
- Classification: `HUMAN-AUTHORED CLEAN-ROOM`
- Original files: `src/domain/decisionScenario.ts`,
  `src/application/decisionLifecycle.ts`, `src/application/decisionSession.ts`,
  `src/application/decisionRefresh.ts`,
  `src/infrastructure/network/httpDecisionSession.ts`,
  `src/infrastructure/server/decisionHandler.ts`,
  `src/infrastructure/server/createDecisionHandler.ts`,
  `src/infrastructure/runtime/createDecisionSession.ts`,
  `src/infrastructure/runtime/decisionRuntimeConfig.ts`,
  `src/ui/screens/DecisionDetailsScreen.tsx`, their tests,
  `scripts/package-decision-backend.mjs` and `docs/DECISION_RUNTIME.md`
- Updated clean-room files: `src/App.tsx`,
  `src/application/decisionState.ts`, `src/ui/screens/DecisionScreen.tsx` and
  their tests
- Reused reviewed runtime dependency: `@aws-sdk/client-dynamodb@3.1126.0`,
  server-side only; no dependency or lockfile change in this phase
- New dependencies, copied samples, private implementation input, assets and
  live service calls: none

### TV UI authority and implementation

- Source authority: frozen public specification v1.0 plus the human-owned
  design package `docs/design/tv-ui-design-v1.zip`
  (SHA-256 `766e85a7fbb5224546977e493f17e66e497062c68b4cf5fb0003e36f59ead840`,
  verified before every phase that consumed it)
- Classification: `HUMAN-AUTHORED CLEAN-ROOM` design, then bounded
  implementation against that frozen design
- Files: `src/ui/theme/conceptA.ts`, `src/ui/components/DecisionShell.tsx`,
  `src/ui/components/TruthSpine.tsx`, and reworked
  `src/ui/screens/DecisionScreen.tsx`,
  `src/ui/screens/DecisionDetailsScreen.tsx`,
  `src/ui/components/FocusableControl.tsx`, `src/App.tsx`, with matching tests.
  No new dependencies; no domain or application behavior change.
- **Early native visual evidence generations were recorded as `PARTIAL` or
  defect-bearing and were superseded. None was reused as proof after
  remediation.**

### Layout remediation — two-stage Replan, compact TruthSpine, scroll-origin fix

- The complete Replan stage exceeded the 976 px safe budget by approximately
  600 logical pixels. The original adjudication verdict was
  `STOP — FINAL_LAYOUT_REMEDIATION_NOT_SAFELY_DEFINABLE`, amended the same day
  to `PASS — TWO_STAGE_REPLAN_REMEDIATION_READY` with a frozen composition and
  explicit budget arithmetic.
- Remediation implemented exactly as adjudicated: two-stage Replan presentation
  on the **unchanged application state machine**; a presentation-only
  compact-fit TruthSpine variant with dedicated theme values and frozen line
  heights; surgical scroll-origin restoration in
  `src/ui/components/TruthSpine.tsx` (`scrollTo y:0` on `originKey` change,
  derived as `replan-stage-a` / `replan-stage-b` / `outside-replan` in
  `src/ui/screens/DecisionScreen.tsx`).
- Deterministic layout budgets frozen by tests: candidates spine 969, replan
  spine 970, Stage A 963, Stage B 959 — all ≤ 976; task-critical font floor
  19 px. No focus-architecture change, no new application state, no dependency
  change.
- An intermediate native verification generation was recorded honestly as
  `PARTIAL` (Replan spine scrolled out of frame) and superseded by the release
  qualification below. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
  full rationale.

## Dependency installation

- Package manager: npm `10.8.2` on Node.js `20.20.0`
- Install command class: generator-required `npm install --no-audit --no-fund`
- Resolved graph: **1,091 lockfile package entries; no dependency was added to
  the generator's `package.json`** beyond the one reviewed SDK noted above
- Classification: `INSTALL-GENERATED` for `package-lock.json` and
  `node_modules/`

Direct runtime dependencies resolve to React `19.2.0` (MIT), React Native
`0.83.0` (MIT) and `@amazon-devices/react-native-kepler` `4.0.1` (Amazon
Program Materials License). Direct developer dependencies are the official
generator list; their resolved licenses are MIT or Apache-2.0 except the
required `@amazon-devices/*` Vega packages.

Complete lockfile license summary at install time:

```text
MIT 930   ISC 68   Apache-2.0 26   BSD-3-Clause 28   BSD-2-Clause 16
Python-2.0 3   0BSD 2   BlueOak-1.0.0 1   (MIT OR CC0-1.0) 4
(MIT OR Apache-2.0) 1   CC-BY-4.0 1   CC-BY-3.0 1   CC0-1.0 1
six Amazon packages pointing to their included license files
three entries with omitted lockfile license fields
```

Those three (`exit` 0.1.2, `memorystream` 0.3.1 and `rechoir` 0.6.2) each
declare MIT in installed metadata and include a license file.

The Amazon Program Materials packages are **required by the documented Vega
toolchain, are not vendored, are excluded from the DECORDA license grant, and
remain governed by their own terms.** No package in `node_modules/` is project
source or intended repository content. No third-party source is vendored in
this repository, so no `NOTICE` file is required.

## Validation-generated files

The Vega build creates `build/`, `buildinfo.json` and
`generated/eslint-plugin-kepler/keplerESLintState.json`. Lint may recreate the
ESLint state file. These are `TOOL-GENERATED — DISPOSABLE`, are gitignored, and
are not part of this repository. Built packages were approximately 455 KB per
architecture. No autolinked package was added.

## Release build and native qualification

- Release build on the accepted tree: Vega CLI 1.3.4, active SDK 0.24.9914,
  target OS 1.2 — `vega vtbuild` exit 0, manifest validation 0 errors. The
  aarch64 package that ran natively hashed to
  `cdf21b723b4057bb47889224f0ec76649a7dbc6362080d86b8fec6d31de673c4`.
  `BUILD PASS != RELEASE PASS` — the build is an input, not the verdict.
- Native proof: local Vega Virtual Device `tv - aarch64` at 1920x1080, real
  guest-side `inputd-cli` input, guest-side emulator-console framebuffer
  capture. All approved frames are single native viewports with no stitch, crop
  or substitute. They include a **falsifying control frame** showing the
  confirmed-stage spine genuinely scrolled immediately before the Stage A
  transition — the direct before/after proof of the scroll-origin fix and of
  the no-normalization negative requirement.
- Method and exact commands are preserved in
  [docs/NATIVE_RUN.md](docs/NATIVE_RUN.md).

## Joined durable qualification

- Real chain exercised: product client adapter → HTTPS/TLS → Lambda (the
  repository's own compiled backend) → `decisionHandler` → application
  lifecycle and replanning flow → `DynamoDbDecisionStore` → real DynamoDB; plus
  fresh-client latest-version recovery and the bounded refresh controller on
  the real path. **28 effective rows, 28 PASS, 0 FAIL.**
- Durable lifecycle observed **independently of HTTP**: direct consistent
  `GetItem` before and after every sensitive step. Explicit Confirm committed
  CAS 7 / plan 1 with all four approvals present but `confirmed_plan` absent at
  CAS 6; replan Confirm committed CAS 8 / plan 2 with the preserved component
  unchanged; unfinished Back produced zero durable mutation.
- **CAS pre-confirm test-control caveat (preserve verbatim in any retelling):**
  genuine `STALE_VERSION` and `OPERATION_ID_CONFLICT` cannot be reached on an
  already-confirmed decision because ordinary mutations correctly
  short-circuit with `REJECTED/ALREADY_CONFIRMED` before the CAS layer. Both
  outcomes were genuinely observed only in a labelled pre-confirm
  test-control window on the same real table and endpoint, opened by one
  disclosed direct DynamoDB deletion — a test-control action, not a
  product operation. Ordinary post-confirm user lifecycle does not naturally
  reach those outcomes, and no claim says it does.
- Deviation disclosed at qualification time: the Function URL used
  `AuthType AWS_IAM` (SigV4) instead of a public unauthenticated URL — a
  strictly stronger transport posture; the joined server path is the product
  path either way.
- Teardown verified by querying after deletion, not by the delete requests:
  table, function, Function URL configuration, IAM role and log group all
  ABSENT; `RESIDUAL_RESOURCE_COUNT=0`; live stack under 25 minutes;
  promotional credit consumed conservatively < $0.01; personal spend $0.00.
  The local virtual device was stopped with 0 processes remaining.

## Manifest reconciliation

Two package-metadata fields were reconciled after the qualified build:

- `title`: the generator remnant `"Basic UI React Native Application for
  project decorda"` became `"Decorda"`, matching the toolchain guidance that
  the package title should be a short, user-friendly display name, and matching
  `app.json` `displayName` and `package.json` `kepler.appName`.
- `build-number`: the generator manifest omitted the field and the toolchain
  defaulted the packaged value to 0. It is now an explicit `build-number = 1`.
  The Vega packaging tool documents the field as a "monotonically increasing
  integer between 1 and 2^63-1" used for package update checks and validates a
  positive integer (0 produces a toolchain warning). 1 is the first deliberate
  build of the deliberate release; no broader build-number policy is invented
  or claimed.
- Preserved unchanged: package id `com.agentisstudio.decorda`, component
  `com.agentisstudio.decorda.main`, `os.version` min/target `1.2`, needs and
  runtime module declarations. Zero behavior change — both fields are package
  display and update metadata only.
- **The recorded Release package hash above corresponds to the pre-reconciliation
  manifest. Any rebuilt package must not claim it.**

## README screenshot provenance

The four screenshots in the README were copied unchanged from approved native
release evidence into tracked `docs/assets/readme/`. Byte equality was verified;
destination SHA-256 equals source SHA-256 in every row.

| Destination | Source frame | SHA-256 (identical) |
|---|---|---|
| `docs/assets/readme/01_candidates.png` | candidates full fit, Release | `73067cdd8cab4d96bf07a167f6e38fcd36c0f08c0332a399269a80d506fbab3c` |
| `docs/assets/readme/02_plan_confirmed.png` | pre-replan spine-scrolled control | `7da9283c013c1affb563a6f164005984aed1f2156ef8a82f90c3f0191419be6f` |
| `docs/assets/readme/03_replan_select_replacement.png` | replan Stage A at scroll origin, Release | `2e0b2e7cff6a5d7af57ff82ef6a70eb199985580a3f6f2d2ddb2fd35c23bf4de` |
| `docs/assets/readme/04_scoped_reapproval.png` | replan Stage B at scroll origin, Release | `97637beff7f22dd71111b441852ed0a8883d0d50da0a41b5bde9084afb38cc57` |

**Reported substitution for screenshot #2.** No dedicated at-scroll-origin
plan-confirmed frame exists in the approved native evidence, and **none was
fabricated**. The slot uses the strongest approved lifecycle frame — the
confirmed canonical plan stage (PLAN CONFIRMED, decision version 7, plan
version 1, all participants APPROVED) — which is the release qualification's
falsifying-control frame, captured at a scrolled truth-spine position. The
filename `02_plan_confirmed.png` remains semantically truthful: the frame
depicts the plan-confirmed canonical state. The README caption states the
scrolled position. Earlier evidence generations, including a `PARTIAL`
generation and a known-clipped overflow-regression set, were rejected as
superseded or clipped.

## Demo video

```text
MASTER=DECORDA_DEMO_v2.mp4
SHA256=d41c94d7a64e8d7c45fd3ea941ee45ee0db381c8b56a6351af5ca912f88c9795
SIZE=12,598,740 bytes   DURATION=152.600 s   1920x1080   H.264 High / AAC-LC
QA=19/19 PASS   OWNER_ACCEPTED=YES   FREEZE=ACTIVE
PUBLIC_URL=https://youtu.be/C4sDO5JaRjc
```

This is the master's identity, recorded so the published video can be checked
against it. Production directory, capture tooling and edit specification are
deliberately not recorded here. The video is not committed to this repository.

## License reconciliation — 2026-09-17

- Owner license decision: project-owned DECORDA source and documentation were
  reconciled from the repository's earlier Apache-2.0 posture to **MIT**. The
  root [LICENSE](LICENSE) is now the canonical MIT License text and carries the
  copyright line.
- Third-party terms unchanged: `@amazon-devices/*` Vega packages remain under
  the Amazon Program Materials License and are excluded from the project's MIT
  grant; React (MIT), React Native (MIT), `@aws-sdk/client-dynamodb`
  (Apache-2.0) and all other dependencies remain under their own observed
  licenses. **No dependency is represented as relicensed by DECORDA.**
- This is an owner licensing decision recorded from repository state. It is not
  external legal review. Earlier Apache-2.0 statements above — the clean-room
  baseline license text and install-time grant wording — are retained as
  clearly labelled historical state.
