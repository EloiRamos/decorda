import type {
  ApplyDecisionMutationInput,
  ApplyDecisionMutationResult,
  CanonicalDecisionState,
  CreateDecisionInput,
  CreateDecisionResult,
  DecisionMutationIntent,
  DecisionSnapshot,
  DecisionStore,
  LoadDecisionResult,
  OperationId,
  OperationReceipt,
  PersistenceFailure,
} from '../../src/application/decisionStore';
import {
  initialDecisionState,
  referenceCandidateOptions,
} from '../../src/domain/fixtures';
import type {DecisionId} from '../../src/domain/types';

const DECISION_ID: DecisionId = initialDecisionState.decision_id;
const OPERATION_ID: OperationId = 'op-select-riverside-1';

const riversidePicnicId = referenceCandidateOptions[0].id;

// F5 boundary: riverside picnic selected, all four responses approved, and
// the unanimous-consensus plan confirmed by the F5 application slice.
function boundarySnapshot(): DecisionSnapshot {
  return {
    selected_candidate_id: riversidePicnicId,
    participant_responses: initialDecisionState.participant_responses.map(
      response => ({
        ...response,
        response_state: 'approved' as const,
      }),
    ),
    confirmed_plan: {
      plan_id: 'plan-saturday-activity',
      version: 1,
      selected_components: [
        {
          component_id: 'component-activity',
          option_id: riversidePicnicId,
        },
      ],
      confirmation_state: 'confirmed',
    },
    fixture_state: initialDecisionState.fixture_state,
  };
}

function canonicalAt(version: number): CanonicalDecisionState {
  return {
    ...boundarySnapshot(),
    decision_id: DECISION_ID,
    version,
  };
}

function intentPayload(intent: DecisionMutationIntent): string {
  switch (intent.kind) {
    case 'SELECT_CANDIDATE':
      return intent.candidate_id;
    case 'SET_PARTICIPANT_RESPONSE':
      return intent.participant_id;
    case 'CONFIRM_PLAN':
      return intent.plan_id;
    default: {
      const exhaustive: never = intent;
      return exhaustive;
    }
  }
}

type LimitReason = Extract<
  PersistenceFailure,
  {kind: 'LIMIT_EXCEEDED'}
>['reason'];

const FROZEN_LIMIT_REASONS: readonly LimitReason[] = [
  'ITEM_SIZE',
  'OPERATION_COUNT',
  'INPUT_BOUNDS',
];

function limitReasonLabel(reason: LimitReason): string {
  switch (reason) {
    case 'ITEM_SIZE':
    case 'OPERATION_COUNT':
    case 'INPUT_BOUNDS':
      return reason;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

type ExpectedDecisionStoreShape = {
  createDecision(input: CreateDecisionInput): Promise<CreateDecisionResult>;
  loadDecision(decision_id: DecisionId): Promise<LoadDecisionResult>;
  applyMutation(
    input: ApplyDecisionMutationInput,
  ): Promise<ApplyDecisionMutationResult>;
};

type StoreContractMatches = [DecisionStore] extends [
  ExpectedDecisionStoreShape,
]
  ? [ExpectedDecisionStoreShape] extends [DecisionStore]
    ? true
    : false
  : false;

const STORE_CONTRACT_MATCHES: StoreContractMatches = true;

describe('PERSISTENCE-001 application persistence contract', () => {
  it('declares exactly the three store methods returning promises', () => {
    expect(STORE_CONTRACT_MATCHES).toBe(true);
  });

  it('carries the frozen command fields on both inputs', () => {
    const createInput = {
      decision_id: DECISION_ID,
      initial_state: boundarySnapshot(),
      expires_at: 1_800_000_000,
    } as const;
    const createAsContract: CreateDecisionInput = createInput;
    const mutationInput = {
      decision_id: DECISION_ID,
      operation_id: OPERATION_ID,
      base_version: 1,
      mutation: {
        kind: 'SELECT_CANDIDATE',
        candidate_id: riversidePicnicId,
      } as const,
      next_state: boundarySnapshot(),
    } as const;
    const mutationAsContract: ApplyDecisionMutationInput = mutationInput;

    expect(Object.keys(createInput)).toEqual([
      'decision_id',
      'initial_state',
      'expires_at',
    ]);
    expect(Object.keys(mutationInput)).toEqual([
      'decision_id',
      'operation_id',
      'base_version',
      'mutation',
      'next_state',
    ]);
    expect(createAsContract.initial_state).toEqual(boundarySnapshot());
    expect(mutationAsContract.base_version).toBe(1);
  });

  it('represents the F5 boundary as a valid DecisionSnapshot', () => {
    const snapshot = boundarySnapshot();

    expect(Object.keys(snapshot)).toEqual([
      'selected_candidate_id',
      'participant_responses',
      'confirmed_plan',
      'fixture_state',
    ]);
    expect(snapshot.selected_candidate_id).toBe('option-riverside-picnic');
    expect(snapshot.participant_responses).toEqual(
      initialDecisionState.participant_responses.map(response => ({
        ...response,
        response_state: 'approved',
      })),
    );
    expect(snapshot.confirmed_plan).toEqual({
      plan_id: 'plan-saturday-activity',
      version: 1,
      selected_components: [
        {
          component_id: 'component-activity',
          option_id: 'option-riverside-picnic',
        },
      ],
      confirmation_state: 'confirmed',
    });
    expect(snapshot.fixture_state).toEqual(initialDecisionState.fixture_state);
  });

  it('extends the snapshot to canonical state with decision id and version', () => {
    const canonical = canonicalAt(1);

    expect(Object.keys(canonical)).toEqual([
      'selected_candidate_id',
      'participant_responses',
      'confirmed_plan',
      'fixture_state',
      'decision_id',
      'version',
    ]);
    expect(canonical.decision_id).toBe('decision-saturday-activity');
    expect(canonical.version).toBe(1);
    expect(Number.isInteger(canonical.version)).toBe(true);
  });

  it('supports exactly the three mutation discriminants with their payloads', () => {
    const intents: readonly DecisionMutationIntent[] = [
      {kind: 'SELECT_CANDIDATE', candidate_id: riversidePicnicId},
      {
        kind: 'SET_PARTICIPANT_RESPONSE',
        participant_id: 'participant-blair',
        response_state: 'approved',
      },
      {kind: 'CONFIRM_PLAN', plan_id: 'plan-saturday-activity'},
    ];

    expect(intents.map(intent => intent.kind)).toEqual([
      'SELECT_CANDIDATE',
      'SET_PARTICIPANT_RESPONSE',
      'CONFIRM_PLAN',
    ]);
    expect(intents.map(intentPayload)).toEqual([
      'option-riverside-picnic',
      'participant-blair',
      'plan-saturday-activity',
    ]);
  });

  it('returns CREATED with the canonical state', () => {
    const result = {
      kind: 'CREATED',
      canonical_state: canonicalAt(1),
    } as const;
    const asContract: CreateDecisionResult = result;

    expect(Object.keys(result)).toEqual(['kind', 'canonical_state']);
    expect(result.canonical_state.version).toBe(1);
    expect(asContract.kind).toBe('CREATED');
  });

  it('returns ALREADY_EXISTS with the existing canonical state', () => {
    const result = {
      kind: 'ALREADY_EXISTS',
      canonical_state: canonicalAt(3),
    } as const;
    const asContract: CreateDecisionResult = result;

    expect(Object.keys(result)).toEqual(['kind', 'canonical_state']);
    expect(result.canonical_state.version).toBe(3);
    expect(asContract.kind).toBe('ALREADY_EXISTS');
  });

  it('returns FOUND with the canonical state', () => {
    const result = {
      kind: 'FOUND',
      canonical_state: canonicalAt(2),
    } as const;
    const asContract: LoadDecisionResult = result;

    expect(Object.keys(result)).toEqual(['kind', 'canonical_state']);
    expect(result.canonical_state.decision_id).toBe(DECISION_ID);
    expect(asContract.kind).toBe('FOUND');
  });

  it('returns NOT_FOUND with the decision id and no canonical state', () => {
    const result = {
      kind: 'NOT_FOUND',
      decision_id: DECISION_ID,
    } as const;
    const asContract: LoadDecisionResult = result;

    expect(Object.keys(result)).toEqual(['kind', 'decision_id']);
    expect(result.decision_id).toBe(DECISION_ID);
    expect('canonical_state' in result).toBe(false);
    expect(asContract.kind).toBe('NOT_FOUND');
  });

  it('returns APPLIED with the committed version and canonical state', () => {
    const result = {
      kind: 'APPLIED',
      applied: true,
      operation_id: OPERATION_ID,
      committed_version: 2,
      canonical_state: canonicalAt(2),
    } as const;
    const asContract: ApplyDecisionMutationResult = result;

    expect(Object.keys(result)).toEqual([
      'kind',
      'applied',
      'operation_id',
      'committed_version',
      'canonical_state',
    ]);
    expect(result.applied).toBe(true);
    expect(result.committed_version).toBe(2);
    expect(asContract.kind).toBe('APPLIED');
  });

  it('returns STALE_VERSION with the current version and no write', () => {
    const result = {
      kind: 'STALE_VERSION',
      applied: false,
      reason: 'STALE_VERSION',
      current_version: 5,
      canonical_state: canonicalAt(5),
    } as const;
    const asContract: ApplyDecisionMutationResult = result;

    expect(Object.keys(result)).toEqual([
      'kind',
      'applied',
      'reason',
      'current_version',
      'canonical_state',
    ]);
    expect(result.applied).toBe(false);
    expect(result.current_version).toBe(5);
    expect(asContract.kind).toBe('STALE_VERSION');
  });

  it('returns IDEMPOTENT_REPLAY with the original committed version', () => {
    const result = {
      kind: 'IDEMPOTENT_REPLAY',
      applied: false,
      reason: 'IDEMPOTENT_REPLAY',
      operation_id: OPERATION_ID,
      committed_version: 2,
      canonical_state: canonicalAt(4),
    } as const;
    const asContract: ApplyDecisionMutationResult = result;

    expect(Object.keys(result)).toEqual([
      'kind',
      'applied',
      'reason',
      'operation_id',
      'committed_version',
      'canonical_state',
    ]);
    expect(result.applied).toBe(false);
    expect(result.committed_version).toBe(2);
    expect(asContract.kind).toBe('IDEMPOTENT_REPLAY');
  });

  it('returns OPERATION_ID_CONFLICT with the current version', () => {
    const result = {
      kind: 'OPERATION_ID_CONFLICT',
      applied: false,
      reason: 'OPERATION_ID_CONFLICT',
      operation_id: OPERATION_ID,
      current_version: 4,
      canonical_state: canonicalAt(4),
    } as const;
    const asContract: ApplyDecisionMutationResult = result;

    expect(Object.keys(result)).toEqual([
      'kind',
      'applied',
      'reason',
      'operation_id',
      'current_version',
      'canonical_state',
    ]);
    expect(result.applied).toBe(false);
    expect(result.current_version).toBe(4);
    expect(asContract.kind).toBe('OPERATION_ID_CONFLICT');
  });

  it('fails closed with exactly the frozen LIMIT_EXCEEDED reasons', () => {
    for (const reason of FROZEN_LIMIT_REASONS) {
      const failure = {kind: 'LIMIT_EXCEEDED', reason} as const;
      const asContract: PersistenceFailure = failure;

      expect(Object.keys(failure)).toEqual(['kind', 'reason']);
      expect(limitReasonLabel(reason)).toBe(reason);
      expect(asContract).toEqual({kind: 'LIMIT_EXCEEDED', reason});
    }
  });

  it('normalizes infrastructure errors to retryable plus safe_code only', () => {
    const retryable = {
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: true,
      safe_code: 'THROTTLING',
    } as const;
    const terminal = {
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: false,
      safe_code: 'SCHEMA_VERSION_UNSUPPORTED',
    } as const;
    const asContractOne: PersistenceFailure = retryable;
    const asContractTwo: PersistenceFailure = terminal;

    for (const failure of [retryable, terminal]) {
      expect(Object.keys(failure)).toEqual(['kind', 'retryable', 'safe_code']);
      expect(typeof failure.retryable).toBe('boolean');
      expect(typeof failure.safe_code).toBe('string');
      expect(failure.safe_code.length).toBeGreaterThan(0);
      expect('error' in failure).toBe(false);
      expect('stack' in failure).toBe(false);
      expect('request_id' in failure).toBe(false);
    }
    expect(retryable.retryable).toBe(true);
    expect(terminal.retryable).toBe(false);
    expect(asContractOne.kind).toBe('INFRASTRUCTURE_ERROR');
    expect(asContractTwo.kind).toBe('INFRASTRUCTURE_ERROR');
  });

  it('keeps the receipt to operation id, fingerprint, and committed version', () => {
    const receipt: OperationReceipt = {
      operation_id: OPERATION_ID,
      mutation_fingerprint:
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      committed_version: 2,
    };

    expect(Object.keys(receipt)).toEqual([
      'operation_id',
      'mutation_fingerprint',
      'committed_version',
    ]);
    expect(receipt.operation_id).toBe(OPERATION_ID);
    expect(receipt.committed_version).toBe(2);
  });
});
