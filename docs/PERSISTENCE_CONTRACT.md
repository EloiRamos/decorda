# Persistence Contract

## 1. Scope and non-goals

This contract defines the first durable state-store boundary for Decorda. The selected store is Amazon DynamoDB, but this contract does not authorize dependency installation, adapter implementation, AWS resource creation, network exposure, or live qualification.

The design is limited to one synthetic active decision, one bounded canonical item per decision, optimistic concurrency, and bounded idempotency. It does not add general CRUD, production identity, multi-region operation, secondary indexes, streams, backups, PITR, model calls, or product rules.

## 2. Layer boundary

- Domain code owns feasibility, consensus, participant rules, confirmation, and later replanning.
- Application code loads canonical state, validates a requested action through domain functions, computes the complete next immutable state, and calls the persistence port.
- The application-facing `DecisionStore` port and its commands/results belong in a future `src/application/decisionStore.ts` file.
- `InMemoryDecisionStore`, DynamoDB DTOs/serialization, and `DynamoDbDecisionStore` belong under `src/infrastructure/persistence/`.
- UI code consumes application results and never imports a DynamoDB adapter.
- Infrastructure implements the application port. Application and domain code do not import infrastructure.

The store never evaluates feasibility or consensus. It trusts the application-provided next state as already validated, then enforces identity, version, idempotency, bounds, and atomic persistence.

## 3. Persistence interface

The future TypeScript-facing contract is:

```ts
export interface DecisionStore {
  createDecision(
    input: CreateDecisionInput,
  ): Promise<CreateDecisionResult>;

  loadDecision(
    decision_id: DecisionId,
  ): Promise<LoadDecisionResult>;

  applyMutation(
    input: ApplyDecisionMutationInput,
  ): Promise<ApplyDecisionMutationResult>;
}

export type CreateDecisionInput = Readonly<{
  decision_id: DecisionId;
  initial_state: DecisionSnapshot;
  expires_at: number;
}>;

export type ApplyDecisionMutationInput = Readonly<{
  decision_id: DecisionId;
  operation_id: OperationId;
  base_version: number;
  mutation: DecisionMutationIntent;
  next_state: DecisionSnapshot;
}>;
```

`loadDecision` is the only load operation; it always means the current canonical state and uses a strongly consistent read in DynamoDB. `createDecision` creates version `1` and never overwrites an existing decision. No update, list, scan, or generic delete method is part of the minimum. Live test-data removal is table-level teardown; TTL is secondary expiry protection.

`OperationId` is an opaque, non-empty client-generated string of at most 128 UTF-8 bytes. `base_version` and all stored versions are positive safe integers.

## 4. Canonical record

The application-facing canonical state is:

```ts
export type DecisionSnapshot = Readonly<{
  selected_candidate_id: CandidateOptionId | null;
  participant_responses: readonly ParticipantResponse[];
  confirmed_plan: ConfirmedPlan | null;
  fixture_state: DecisionFixtureState;
}>;

export type CanonicalDecisionState = Readonly<
  DecisionSnapshot & {
    decision_id: DecisionId;
    version: number;
  }
>;
```

The single DynamoDB item has these stable public-safe attributes:

| Attribute | Meaning |
|---|---|
| `decision_id` | String partition key. |
| `schema_version` | Integer persistence schema version, initially `1`. |
| `version` | Positive integer canonical decision version. |
| `selected_candidate_id` | Selected candidate ID or DynamoDB `NULL`. |
| `participant_responses` | Ordered bounded response list. |
| `confirmed_plan` | Confirmed plan map or DynamoDB `NULL`. |
| `fixture_state` | Minimum synthetic fixture references needed to reconstruct the decision context. |
| `operation_ids` | Bounded list of accepted operation IDs used by the conditional expression. |
| `operation_receipts` | Bounded list of receipt maps described in section 6. |
| `expires_at` | Epoch-seconds TTL no later than 24 hours after the authorized session or capture. |

The record does not contain UI state, focus state, rendered labels, feasibility results, consensus status, or other deterministic derived values. Candidate details and constraints remain fixture/domain data; only their stable references and the selected ID are persisted. Timestamps are not needed for correctness and are omitted.

The item must remain at or below 32 KiB. A decision permits at most 40 successful logical mutations and therefore at most 40 receipts.

## 5. DynamoDB key schema

- Table count: one.
- Table class: DynamoDB Standard.
- Billing mode: `PAY_PER_REQUEST`.
- Partition key: `decision_id` (`String`).
- Sort key: none.
- Secondary indexes: none.
- Canonical representation: exactly one item for each decision ID.

Creation uses a conditional `PutItem` equivalent to `attribute_not_exists(decision_id)`. Reads use `GetItem` with `ConsistentRead=true`. Normal operation never uses `Scan` or `Query`.

## 6. Selected idempotency design

### Decision

Select **Option A — single canonical item with bounded recent operation IDs**.

Every successful mutation appends one receipt:

```ts
export type OperationReceipt = Readonly<{
  operation_id: OperationId;
  mutation_fingerprint: string;
  committed_version: number;
}>;
```

The fingerprint is the lowercase hexadecimal SHA-256 digest of a deterministic, fixed-field serialization of `{base_version, mutation, next_state}`. The serialization uses a fixed key order and no `undefined` values. This binds an operation ID to the exact validated request while keeping every stored receipt fixed-size. The adapter compares the digest byte-for-byte; this digest is integrity metadata, not a security or authentication mechanism.

Receipts are retained for the entire lifetime of the decision item and are never evicted individually. The lifetime ends only when the bounded synthetic decision expires or the table is explicitly torn down. The maximum of 40 successful mutations bounds both receipt lists and item growth. Mutation 41 returns `LIMIT_EXCEEDED` without changing state.

### Comparison

| Concern | Option A: bounded receipts in canonical item | Option B: companion items |
|---|---|---|
| Correctness | State and receipt change in one item write. | Requires a transaction to keep state and receipt atomic. |
| Growth | Linear but capped at 40 receipts and 32 KiB. | Adds an item per operation and separate TTL behavior. |
| Conditional write | One item/version condition. | Canonical update plus conditional receipt creation. |
| Replay/conflict | One strongly consistent item read exposes the receipt. | Requires companion lookup and canonical refresh. |
| Cleanup | Receipt lifecycle equals decision lifecycle. | Each companion needs TTL and table-item accounting. |
| Requests/cost | Smallest request and write-item count. | Higher transactional/request cost. |
| Complexity | Fits the qualified one-item/no-sort-key design. | Adds key prefixes, transactions, and more failure modes. |

Option B is rejected for the minimum.

## 7. Version and CAS semantics

- `createDecision` creates version `1`.
- Every mutation supplies the caller's positive integer `base_version`.
- A new mutation can commit only when stored `version = base_version` and `operation_id` is absent.
- Success replaces the persisted decision snapshot and increments `version` exactly once to `base_version + 1`.
- A stale mutation writes nothing. There is no merge, partial write, retry, or last-write-wins fallback.
- Replay/conflict adjudication takes precedence over stale-version adjudication when the operation ID already exists.

The DynamoDB update condition is conceptually:

```text
version = :base_version
AND NOT contains(operation_ids, :operation_id)
AND size(operation_ids) < :maximum_operations
```

The atomic update conceptually sets the complete validated snapshot, sets `version = :base_version + 1`, and appends the operation ID and receipt. If the condition fails, the adapter performs one strongly consistent canonical read and classifies the result in this order:

1. matching operation ID and fingerprint: `IDEMPOTENT_REPLAY`;
2. matching operation ID and different fingerprint: `OPERATION_ID_CONFLICT`;
3. current version differs from `base_version`: `STALE_VERSION`;
4. receipt limit reached: `LIMIT_EXCEEDED`;
5. otherwise: normalized `INFRASTRUCTURE_ERROR`.

After an applied or stale result, the returned `canonical_state` comes from a strongly consistent canonical read. `committed_version` identifies the exact version created by a successful operation even if a later write wins before that refresh.

## 8. Mutation semantics

The minimum logical mutation intents are:

```ts
export type DecisionMutationIntent =
  | Readonly<{
      kind: 'SELECT_CANDIDATE';
      candidate_id: CandidateOptionId;
    }>
  | Readonly<{
      kind: 'SET_PARTICIPANT_RESPONSE';
      participant_id: ParticipantId;
      response_state: ParticipantResponseState;
    }>
  | Readonly<{
      kind: 'CONFIRM_PLAN';
      plan_id: PlanId;
    }>;
```

The application loads canonical state, runs the existing domain/application transition, and supplies both the logical intent and the complete resulting `next_state`. The adapter does not re-run or reinterpret product rules. CAS guarantees that the validated result is installed only over the exact state from which it was computed.

`SELECT_CANDIDATE` persists the selected ID and application-computed response/confirmation reset. `SET_PARTICIPANT_RESPONSE` persists the application-computed response set and may include a newly confirmed plan when the existing unanimous-consensus rule produces one. `CONFIRM_PLAN` is available only when the application has separately validated that confirmation is permitted; persistence itself does not decide consensus.

## 9. Result and error model

Expected outcomes are discriminated results, not exceptions:

```ts
export type CreateDecisionResult =
  | Readonly<{kind: 'CREATED'; canonical_state: CanonicalDecisionState}>
  | Readonly<{kind: 'ALREADY_EXISTS'; canonical_state: CanonicalDecisionState}>
  | PersistenceFailure;

export type LoadDecisionResult =
  | Readonly<{kind: 'FOUND'; canonical_state: CanonicalDecisionState}>
  | Readonly<{kind: 'NOT_FOUND'; decision_id: DecisionId}>
  | PersistenceFailure;

export type ApplyDecisionMutationResult =
  | Readonly<{
      kind: 'APPLIED';
      applied: true;
      operation_id: OperationId;
      committed_version: number;
      canonical_state: CanonicalDecisionState;
    }>
  | Readonly<{
      kind: 'STALE_VERSION';
      applied: false;
      reason: 'STALE_VERSION';
      current_version: number;
      canonical_state: CanonicalDecisionState;
    }>
  | Readonly<{
      kind: 'IDEMPOTENT_REPLAY';
      applied: false;
      reason: 'IDEMPOTENT_REPLAY';
      operation_id: OperationId;
      committed_version: number;
      canonical_state: CanonicalDecisionState;
    }>
  | Readonly<{
      kind: 'OPERATION_ID_CONFLICT';
      applied: false;
      reason: 'OPERATION_ID_CONFLICT';
      operation_id: OperationId;
      current_version: number;
      canonical_state: CanonicalDecisionState;
    }>
  | Readonly<{kind: 'NOT_FOUND'; decision_id: DecisionId}>
  | PersistenceFailure;

export type PersistenceFailure =
  | Readonly<{
      kind: 'LIMIT_EXCEEDED';
      reason: 'ITEM_SIZE' | 'OPERATION_COUNT' | 'INPUT_BOUNDS';
    }>
  | Readonly<{
      kind: 'INFRASTRUCTURE_ERROR';
      retryable: boolean;
      safe_code: string;
    }>;
```

`ALREADY_EXISTS` and `LIMIT_EXCEEDED` are necessary additions: the former makes conditional create explicit, while the latter fails closed on the qualified 32 KiB/40-operation/input envelope. Application/UI results never expose raw AWS error objects, stack traces, resource identifiers, or request metadata. Unexpected programming faults may throw internally, but the adapter boundary normalizes infrastructure failures before returning.

## 10. Local fake contract

`InMemoryDecisionStore` implements the exact `DecisionStore` interface without AWS packages. It stores immutable deep copies keyed by `decision_id` and must match:

- conditional create and `ALREADY_EXISTS`;
- strongly current load and `NOT_FOUND`;
- positive integer versions starting at `1`;
- exact CAS and one-step version increments;
- the three mutation intents;
- full-lifetime bounded receipts;
- same-ID/same-fingerprint replay;
- same-ID/different-fingerprint conflict;
- replay/conflict precedence over stale results;
- operation and item bounds;
- no mutation on every non-`APPLIED` result.

The fake accepts a deterministic clock/expiry value through test setup only; it must not rely on wall-clock timing in unit tests. Contract tests are adapter-agnostic and must be reusable against the DynamoDB adapter's pure boundary later.

## 11. DynamoDB adapter responsibilities

Allowed responsibilities:

- key construction;
- DTO serialization and deserialization;
- strongly consistent reads;
- conditional create and update;
- version and operation-receipt conditions;
- receipt storage and TTL mapping;
- enforcing item/input/operation bounds;
- normalization of DynamoDB failures.

Forbidden responsibilities:

- feasibility, consensus, participant, confirmation, or replanning rules;
- choosing or changing a candidate;
- deriving UI, focus, or presentation state;
- polling orchestration or screen lifecycle;
- authentication or model calls;
- speculative merge, automatic mutation retry, or last-write-wins behavior.

## 12. Serialization and DTO boundary

Dedicated DynamoDB DTOs are required because DynamoDB `AttributeValue` maps, receipt metadata, TTL, and schema version are infrastructure concerns. They belong under `src/infrastructure/persistence/` and must not leak into domain/application types.

Serialization rules:

- use the stable snake-case field names in section 4;
- preserve participant-response array order;
- encode absent selected/confirmed state as DynamoDB `NULL`, never `undefined`;
- preserve versions, TTL, costs, and times as integers where specified;
- reject `NaN`, infinities, unsafe integers, functions, classes, symbols, platform values, and unknown fields;
- construct new plain objects and arrays without mutating domain/application input;
- deserialize into validated plain immutable data, not class instances;
- reject unsupported `schema_version` as `INFRASTRUCTURE_ERROR` with a safe code;
- build mutation fingerprints from the fixed `base_version`, discriminated intent, and normalized next-state fields, never generic object-property iteration.

## 13. AWS SDK dependency decision

The current package graph contains no DynamoDB AWS SDK package. A future DynamoDB adapter requires exactly:

```text
@aws-sdk/client-dynamodb
```

Use the modular low-level `DynamoDBClient` with `GetItemCommand`, `PutItemCommand`, and `UpdateItemCommand`. Explicit small-schema `AttributeValue` mapping avoids adding `@aws-sdk/lib-dynamodb` or `@aws-sdk/util-dynamodb`.

This dependency is not authorized by this contract. Adding it requires separate human authorization plus version, lockfile, license, provenance, compatibility, vulnerability, and storage review. Expected storage impact is a bounded package-graph increase, to be measured before installation; no estimate from this design grants installation authority.

The AWS-backed adapter is intended for a separately authorized server-side path, not direct credentialed access from the TV client.

## 14. Implementation sequencing

| Phase | Status | Scope |
|---|---|---|
| P1 — Persistence contracts/types | implemented | Add the application port, commands/results, and infrastructure DTO types; no dependency or cloud action. |
| P2 — In-memory adapter + tests | implemented | Implement exact create/load/CAS/idempotency/error semantics and shared contract tests; no AWS. |
| P3 — DynamoDB serialization/adapter pure pieces | implemented | Implement deterministic DTO mapping and pure request/response builders only after the SDK/API contract is frozen; no AWS mutation. |
| P4 — AWS SDK dependency + adapter integration | implemented (SDK adapter integration) | Review/add the exact SDK dependency and integrate the adapter; no resource creation without further authority. |
| P5 — Live DynamoDB qualification | qualified under explicit authorization (bounded session, torn down) | Revalidate credit/cost/API posture, create the bounded table, run the evidence session, and fully tear down. |

## 15. Cost and live qualification boundary

Any future live qualification must revalidate the controlling credit instrument and current prices immediately before creation, then remain within all of these limits:

- `us-east-1`, one DynamoDB Standard table, `PAY_PER_REQUEST`;
- partition key `decision_id` (`String`), no sort key, no indexes;
- at most 8 table items, one active decision, 32 KiB per item, and 256 KiB total logical storage;
- at most 40 logical writes and 330 logical reads for the decision;
- at most 300 polling reads, a 2000 ms interval, one request in flight, no retry, and a 10-minute active session;
- at most 1,280 WRUs and 2,640 RRUs for the qualified worst case;
- conservative maximum qualified DynamoDB evidence-envelope cost of `$0.001195536`;
- zero personal spend and a promotional-credit ceiling revalidated before use;
- TTL `expires_at` no later than 24 hours after the authorized session/capture;
- PITR, backups, Streams/CDC, global tables, import/export, DAX, pre-warming, deletion protection, and customer-managed KMS keys disabled or prohibited;
- default AWS-owned DynamoDB encryption only;
- explicit table deletion and absence verification after capture; TTL is not teardown;
- `RESIDUAL_RESOURCE_COUNT = 0`.

During the judging accounting window, retained AWS resources, requests, state-store activity, and promotional-credit consumption remain zero unless superseded by explicit human authority.

## 16. Security and privacy boundary

Only bounded synthetic validation state may be persisted. Never store real household PII, credentials, cookies, access tokens, pairing/bearer capabilities, AWS identifiers, account/payment data, or secret material. Any future device-pairing capability remains outside this contract unless explicitly reauthorized.

The TV client receives public-safe canonical decision results only. AWS credentials and raw service errors never cross the infrastructure boundary.

## 17. Explicit unresolved items

Unresolved blockers: `0`.

Exact SDK version, installation size, server-side packaging, physical table name, IAM policy, endpoint integration, and live test timing are deliberately deferred to P4/P5 because they require separate dependency or AWS authority. They do not change the frozen application contract, item/key model, CAS behavior, or idempotency design.

## 18. Exact next natural step

This contract is frozen. Each phase above was implemented within its stated scope; the live qualification phase was carried out as a bounded, explicitly authorized session and fully torn down.
