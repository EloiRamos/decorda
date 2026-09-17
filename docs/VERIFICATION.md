# Verification

Every public claim DECORDA makes, and exactly what evidence class backs it.

This page exists so that nothing in this repository has to be taken on trust
without knowing what kind of trust it asks for. Some claims you can reproduce
yourself in five minutes. Some were observed once, on the recorded release
state, and are reported as recorded evidence. The difference is never blurred.

## 1. Evidence classes

```text
OBSERVED_IN_VIDEO               visible in the frozen demo master, reached through real controls
OBSERVED_NATIVE_RELEASE         observed on a Vega Virtual Device running the Release package
OBSERVED_DURABLE_QUALIFICATION  observed in the bounded HTTPS/Lambda/DynamoDB session
LOCAL_TEST_EVIDENCE             local Jest regression only
DESCRIPTIVE_ARCHITECTURE        design statement, not a runtime observation
```

## 2. Standing distinctions

These are stated before any claim because they are what keeps the claims
honest:

```text
LOCAL TEST PASS  !=  NATIVE RUNTIME PASS
BUILD PASS       !=  RELEASE PASS
HTTP SUCCESS     !=  DURABLE WRITE
DECLARED STATE   !=  OBSERVED STATE
```

A passing test suite says the code does what its authors asserted. It does not
say the Release package launches on a television. A 200 response does not say a
row was written. A delete request does not say a resource is gone.

## 3. The claims

| # | Public claim | Evidence class | Notes |
|---|---|---|---|
| 1 | A shared decision lifecycle runs on a TV canvas, driven by D-pad and focus | `OBSERVED_IN_VIDEO` + `OBSERVED_NATIVE_RELEASE` | Whole lifecycle driven through the product's own controls |
| 2 | Hard-constraint failures are shown with their reasons, not hidden | `OBSERVED_IN_VIDEO` | On screen: "Costs 72 EUR, above the 60 EUR limit."; "Returns at 18:30, after the 18:00 return time." Both rows show `UNAVAILABLE` controls |
| 3 | Four approvals make a decision ready and commit nothing | `OBSERVED_IN_VIDEO` + `OBSERVED_NATIVE_RELEASE` | One viewport shows all four `APPROVED`, `CAS 6`, and `PLAN VERSION —` simultaneously |
| 4 | Only an explicit Confirm commits a plan | `OBSERVED_IN_VIDEO` | Confirm activation and the resulting canonical state both filmed |
| 5 | Decision (CAS) version and plan version are distinct axes | `OBSERVED_IN_VIDEO` | `Decision version 7 · Plan version 1` visible together with both spine rows |
| 6 | A context change reopens only the affected component; the rest stays saved | `OBSERVED_IN_VIDEO` | `AFFECTED · MAY CHANGE` and `PRESERVED · STAYS AS SAVED` in one viewport |
| 7 | Replanning is scoped to the affected part only | `OBSERVED_IN_VIDEO` | Stage A replacement list; Stage B four scoped response cards |
| 8 | A single rejection holds the replan; Confirm becomes genuinely inert | `OBSERVED_IN_VIDEO` | `SCOPED CONSENSUS · REJECTED` with `Confirm replanned plan · UNAVAILABLE` in one viewport |
| 9 | Consensus is necessary but never sufficient — a second explicit Confirm is required | `OBSERVED_IN_VIDEO` | Consensus reached, then Confirm separately activated |
| 10 | Plan version 2 is created with the preserved component untouched | `OBSERVED_IN_VIDEO` | `Decision version 8 · Plan version 2`; `Return-by-18:00 arrangement · retained 17:00` |
| 11 | Leaving an unfinished replan performs zero durable writes | `OBSERVED_DURABLE_QUALIFICATION` | Version, plan version, operation-id count and both components identical before and after an abandoned draft |
| 12 | A genuinely fresh client recovers the confirmed plan at the latest version | `OBSERVED_DURABLE_QUALIFICATION` | Including from a forced-cold execution environment |
| 13 | Runs natively on Vega OS from a Release package at 1920x1080 | `OBSERVED_NATIVE_RELEASE` | Virtual Device `tv - aarch64`; full guest-framebuffer capture, no stitching, no crop, no upscale |
| 14 | 424 tests across 25 suites pass | `LOCAL_TEST_EVIDENCE` | Local regression only — explicitly **not** a runtime proof |
| 15 | The decision flow was qualified end to end over HTTPS → Lambda → DynamoDB | `OBSERVED_DURABLE_QUALIFICATION` | 28 effective rows, 28 pass, 0 fail; durable state observed by strongly consistent reads independent of the product path |
| 16 | The qualification stack was ephemeral and is gone | `OBSERVED_DURABLE_QUALIFICATION` | `RESIDUAL_RESOURCE_COUNT=0`; absence observed by querying afterwards, not inferred from delete requests |
| 17 | At qualification teardown, no cloud resources remained | `OBSERVED_DURABLE_QUALIFICATION` | A historical observation made at teardown. It does **not** state the condition of any cloud account now; current state requires a fresh observation. See the time-dependence caveat in §7 |
| 18 | The demo video passed deterministic QA 19/19 and is frozen | `OBSERVED_IN_VIDEO` | Includes duration, streams, non-silence, no-black-frames, no-credential and owner-name-zero checks |
| 19 | All data is deterministic synthetic fixture data | `DESCRIPTIVE_ARCHITECTURE` + `LOCAL_TEST_EVIDENCE` | The persistence contract forbids storing real household personal data, credentials, tokens or payment data |
| 20 | Layering is `domain → application → ui / infrastructure` | `DESCRIPTIVE_ARCHITECTURE` | Enforced by convention and review, not by a build-time checker |

## 4. Reproduce it yourself

Everything in this block is reproducible on an ordinary development machine.
This is the `LOCAL_TEST_EVIDENCE` layer in full — nothing more, nothing less.

```sh
npm ci
npm test -- --runInBand     # 424 tests / 25 suites
npm run lint                # 0 errors (11 pre-existing style warnings)
npx tsc --noEmit            # no output
npm run build:release       # requires Vega CLI + active Vega SDK
```

Recorded results at release, on Node v20.20.0 with npm 10.8.2:

| Check | Result |
|---|---|
| Full regression (`npm test -- --runInBand`) | **PASS — 424 tests / 25 suites** |
| Lint (`npm run lint`) | **PASS** — 0 errors, 11 warnings (pre-existing `no-void` style warnings and the standard Kepler system-distributed-library notice) |
| Typecheck (`tsc --noEmit`) | **PASS** — no output, exit 0 |
| Whitespace / conflict (`git diff --check`) | **PASS** |
| Release build (`npm run build:release`) | **PASS** — `vega vtbuild` exit 0, manifest validation 0 errors, three architectures (aarch64 / armv7 / x86_64) |

`LOCAL TEST PASS != NATIVE RUNTIME PASS.` Section 5 is what establishes native
behavior.

**On the build hash.** The aarch64 Release package that ran natively during
qualification hashed to
`cdf21b723b4057bb47889224f0ec76649a7dbc6362080d86b8fec6d31de673c4` **at build
time**. That is historical evidence identifying the qualified package. It is
explicitly *not* the hash of whatever you build today: the manifest has since
been reconciled (see [PROVENANCE.md](../PROVENANCE.md)), and a rebuilt package
must not claim it.

## 5. Recorded evidence, not reproducible here

The native and joined-durable qualifications were executed **once**, on the
recorded release state. Raw execution evidence is retained privately and is
deliberately not published. What follows is the summary those records support.

### 5.1 Native Vega Virtual Device qualification

Release package on a local Vega Virtual Device (`tv - aarch64`) at 1920x1080,
driven through real guest-side input injection, captured as full guest
framebuffer frames. No stitching, no crop, no HTML substitute, no state
injection. The procedure is written up in full in
[NATIVE_RUN.md](NATIVE_RUN.md).

Scroll-origin contract results:

```text
ENTER REPLAN A → TruthSpine y=0                     PASS
A → B          → TruthSpine y=0                     PASS
B → A          → TruthSpine y=0                     PASS
unrelated non-Replan transitions → no normalization PASS
```

The first row is backed by a **falsifying control frame**, not by an assertion
that the spine looked right. Immediately before the transition, at the
confirmed stage, the spine was genuinely scrolled with `SESSION MODE`
off-screen. One transition later it is at the top. The same frame
simultaneously proves the negative requirement — the spine stayed scrolled
across the unrelated responses → confirmed transition, so no normalization
fired outside Replan.

Full-fit assertions:

```text
REPLAN_A_SPINE_SCROLL_ORIGIN=PASS      REPLAN_B_SPINE_SCROLL_ORIGIN=PASS
REPLAN_A_FULL_SPINE_VISIBLE=YES        REPLAN_B_FULL_SPINE_VISIBLE=YES
REPLAN_A_COMPLETE_STAGE_VISIBLE=YES    REPLAN_B_COMPLETE_STAGE_VISIBLE=YES
REPLAN_A_BOTTOM_CLIPPING=NO            REPLAN_B_BOTTOM_CLIPPING=NO
```

Each is a single native viewport at scroll origin showing the complete spine
and the complete stage simultaneously — including, in Stage B, the selected
replacement summary, all four participant cards, all eight response controls, a
real rejection, the full `Confirm replanned plan · UNAVAILABLE` label, and
*Back without saving replan* carrying its complete focus frame.

### 5.2 Joined durable HTTPS / Lambda / DynamoDB qualification

The chain actually exercised:

```text
real product client adapter (src/infrastructure/network/httpDecisionSession.ts)
  -> real HTTPS request over TLS
  -> real AWS Lambda execution (the repository's own compiled backend)
  -> real decisionHandler
  -> real application lifecycle / replanning flow
  -> real DynamoDbDecisionStore adapter
  -> real DynamoDB table
  -> response -> fresh-client read / poll / reopen path
```

No in-memory store, SDK double, mock DynamoDB, mock HTTP transport or
fixture-only persistence took part in any row. Durable state was observed
**independently of the product path** by direct strongly consistent `GetItem`
before and after every sensitive step. No row infers a durable write from an
HTTP status.

**28 effective rows, 28 PASS, 0 FAIL.** The rows that carry the product's
central claims:

| Row | Contract requirement | Observed |
|---|---|---|
| A5 | responses and readiness alone must not confirm a plan | all four approved in DynamoDB **and `confirmed_plan` absent** at CAS v6 |
| A6 | explicit Confirm → durable plan persisted | `APPLIED`, CAS **v7**, durable plan **version 1**, `confirmation_state "confirmed"` |
| B1 | fresh client recovers the latest version from DynamoDB, not memory | fresh client object and fresh transport against a **forced-cold Lambda execution environment** returned `LOADED` at version 7 with the confirmed plan |
| C1 | replay safety on the confirm path | `REPLAYED`, zero durable change |
| C2 | a confirmed plan cannot be silently cleared | ordinary post-confirm selection with a *valid* CAS base → `REJECTED/ALREADY_CONFIRMED`, zero change |
| C4/C5 | replan confirm replay and stale base | not applied, zero change, no second plan increment |
| C8 | genuine replay | same operation id, base version and payload → `REPLAYED`, version and operation-id count unchanged |
| C9 | genuine CAS stale | **fresh** operation id with stale `base_version 1` while the record was at 2 → `STALE`, version unchanged, response **not** recorded |
| C10 | genuine operation-id conflict | spent operation id reused with a **different** payload → `OPERATION_ID_CONFLICT`, version and selection unchanged |
| D1 | scoped replan begins from the latest confirmed record | `REPLAN_READY`, affected `[component-activity]`, preserved `[component-return-arrangement]`, 2 eligible replacements, zero durable write |
| D2–D3 | real replacement selection and renewed scoped responses | selection accepted; four renewed responses held in the transient draft with the durable version still 7 |
| D4 | explicit replan Confirm creates the next canonical version | `APPLIED`, CAS **v7 → v8**, plan version **1 → 2** |
| D5 | preserved component unchanged | `component-return-arrangement` remained `option-riverside-picnic` while the affected component changed |
| E1 | unfinished Back → zero durable mutation | begin, real selection, one real scoped response, then abandoned: version 7→7, plan version 1→1, operation-id count 6→6, both components identical |
| F1 | bounded polling on the real path | real refresh controller, `maximum_reads=4`: stop `READ_LIMIT`, exactly 4 reads, max 1 in flight, intervals 2005/2004/2002 ms against the frozen 2000 ms |

Final completed-lifecycle durable state, exported before any test control: CAS
version **8**, plan version **2** confirmed, `component-activity` =
`option-museum-workshop`, `component-return-arrangement` =
`option-riverside-picnic`, 7 operation ids, all four participants approved.

**Three superseded driver rows are disclosed rather than deleted.** Three
initial rows reported FAIL. All three were errors in the qualification driver,
not product failures, and each was corrected and re-proven: one mis-read the
persisted item's field names while the plan *was* in fact durably written, and
two expected `STALE`/`OPERATION_ID_CONFLICT` where the already-confirmed
short-circuit correctly returns `REJECTED`. They are retained in the private
record marked as superseded driver assertion errors, with their explanation and
successor row.

## 6. Cost and teardown

| Item | Observed |
|---|---|
| EC2 instances created | **0** — the native proof used a local virtual device |
| Ephemeral cloud resources created | 1 DynamoDB table, 1 IAM role with inline policy, 1 Lambda function, 1 Lambda Function URL, 1 CloudWatch log group |
| Bedrock / Cognito / API Gateway / S3 / VPC / NAT / EIP | **none created** |
| HTTPS/Lambda invocations | 27 across three qualification phases |
| DynamoDB durable writes | ~15 — inside the frozen 40 logical-write envelope |
| DynamoDB reads | ~55 independent observations plus 4 polled reads — inside the 330 logical-read / 300-poll envelope |
| Live stack lifetime | under 25 minutes |
| Region | `us-east-1` |
| Promotional credit consumed | **< $0.01** (conservative) |
| Personal spend | **$0.00 / €0.00** |

Teardown was verified by **querying afterwards, not by the delete requests**.
The table, the function, the Function URL configuration, the IAM role and the
log group were each confirmed ABSENT. `RESIDUAL_RESOURCE_COUNT=0`. The local
virtual device was stopped with 0 processes remaining.

`ATTEMPTED DELETE != OBSERVED ABSENCE.`

## 7. Mandatory caveats

These are load-bearing. Do not soften them.

**The CAS pre-confirm test-control caveat.** Genuine `STALE_VERSION` and
`OPERATION_ID_CONFLICT` cannot be reached on an already-confirmed decision,
because ordinary mutations correctly short-circuit with
`REJECTED/ALREADY_CONFIRMED` before the CAS layer. Rather than claim those two
outcomes without observing them, the completed-lifecycle item was first
exported, then **one** direct DynamoDB deletion — a disclosed test-control
action, not a product operation — reopened a pre-confirm window on the same
real table and endpoint, and both outcomes were genuinely observed there.
**Nothing here claims that the ordinary post-confirm user lifecycle naturally
reaches those outcomes.** CAS conflict handling is therefore deliberately not
presented as a headline product claim: any short public phrasing would either
overclaim or require qualification detail, so it is omitted rather than
softened.

**One deviation was disclosed at qualification time.** The Function URL used
`AuthType AWS_IAM` (SigV4) rather than a public unauthenticated URL — a
strictly stronger transport posture. The joined server path (HTTPS → Lambda →
handler → application → DynamoDB adapter → DynamoDB) is the product path either
way.

**Claim 17 is time-dependent.** The teardown above is a historical observation
from the qualification session. It does not establish the state of any cloud
account today. A current zero-resource posture requires a current observation.

**No security, certification or production-readiness claim is made anywhere.**
Not in this document, not in the README, not in the source. DECORDA is a
concept implementation with one deterministic scenario. No accessibility
certification is claimed either; the contrast figures in the README are local
measurements of the shipped palette, and platform assistive-technology
announcement behavior is not independently certified.

## 8. Demo video

```text
MASTER=DECORDA_DEMO_v2.mp4
SHA256=d41c94d7a64e8d7c45fd3ea941ee45ee0db381c8b56a6351af5ca912f88c9795
SIZE=12,598,740 bytes   DURATION=152.600 s   1920x1080   H.264 High / AAC-LC
QA=19/19 PASS   OWNER_ACCEPTED=YES   FREEZE=ACTIVE
PUBLIC_URL=https://youtu.be/C4sDO5JaRjc
```

The master is produced, QA-passed and frozen. It is not committed to this
repository — see the README for why, and for the public link.
