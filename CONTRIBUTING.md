# Contributing

DECORDA is a small, deliberately bounded project. Contributions are welcome
when they keep it that way.

## Before you start

Contributions must be original work, written independently from the published
DECORDA specification and public API documentation. Do not copy or adapt Amazon
sample application code or assets.

Record the source, exact version, purpose and license of every dependency or
copied public snippet before use. Do not add a dependency merely for
convenience when a small local implementation is sufficient — the dependency
graph is part of what this repository claims about itself.

## Running the checks

Every change must pass the same gate the project holds itself to:

```sh
npm ci
npm test -- --runInBand     # 424 tests / 25 suites
npm run lint                # 0 errors
npx tsc --noEmit            # no output
```

`npm run build:release` additionally requires the Vega CLI with an active Vega
SDK. See [docs/NATIVE_RUN.md](docs/NATIVE_RUN.md) for the full native run and
capture procedure.

## Layer boundaries

The import direction is one-way and is not negotiable:

```text
domain  <-  application  <-  ui
domain  <-  application  <-  infrastructure
```

`src/domain/` depends on nothing above it. `src/application/` composes domain
behavior and owns the store port. `src/ui/` consumes application results.
`src/infrastructure/` implements ports and owns no product rules. Tests mirror
the source layer under `test/`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the reasoning.

Place a new module according to these boundaries before implementation begins.
Do not create empty speculative directories, and do not add barrel or index
files without a concrete current need.

## Data and claims

- Use synthetic data in tests and examples. All fixture content in this
  repository is deterministic and synthetic by design.
- Never include credentials, account identifiers, private paths, real
  endpoints or tokens — in code, in tests, in documentation or in commit
  messages.
- Do not strengthen a claim the evidence does not support. If a change makes a
  documented statement inaccurate, update the statement in the same change.
  Caveats in [docs/VERIFICATION.md](docs/VERIFICATION.md) are load-bearing and
  must not be softened to make prose read better.
- Keep QR, phone, second-screen, live-weather, WebSocket and production claims
  out of scope unless the public specification is deliberately revised.
