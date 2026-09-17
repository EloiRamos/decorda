/* eslint-env jest */
import type {
  ApplyDecisionMutationInput,
  CreateDecisionInput,
  DecisionMutationIntent,
  DecisionSnapshot,
  DecisionStore,
  OperationId,
} from '../../../src/application/decisionStore';
import {
  initialDecisionState,
  referenceCandidateOptions,
} from '../../../src/domain/fixtures';
import type {
  DecisionId,
  ParticipantId,
  ParticipantResponse,
} from '../../../src/domain/types';

export type DecisionStoreTimeControl = Readonly<{
  nowSeconds: () => number;
  advanceSeconds: (delta: number) => void;
}>;

export type DecisionStoreContractHarness = Readonly<{
  // Returns an isolated store instance; the suite calls it once per test.
  createStore: () => DecisionStore;
  time: DecisionStoreTimeControl;
  expiryHorizonSeconds?: number;
}>;

type MutableSnapshot = {
  selected_candidate_id: DecisionSnapshot['selected_candidate_id'];
  participant_responses: ParticipantResponse[];
  confirmed_plan: DecisionSnapshot['confirmed_plan'];
  fixture_state: DecisionSnapshot['fixture_state'];
};

const DECISION_ID: DecisionId = initialDecisionState.decision_id;
const OTHER_DECISION_ID: DecisionId = 'decision-contract-other';
const RIVERSIDE_ID = referenceCandidateOptions[0].id;
const PLAN_ID = 'plan-saturday-activity' as const;
const PARTICIPANT_IDS: readonly ParticipantId[] =
  initialDecisionState.participant_responses.map(response => response.participant_id);

function pendingSnapshot(): DecisionSnapshot {
  return {
    selected_candidate_id: null,
    participant_responses: initialDecisionState.participant_responses.map(
      response => ({...response}),
    ),
    confirmed_plan: null,
    fixture_state: initialDecisionState.fixture_state,
  };
}

function approvedThrough(count: number): DecisionSnapshot {
  return {
    ...pendingSnapshot(),
    selected_candidate_id: RIVERSIDE_ID,
    participant_responses: initialDecisionState.participant_responses.map(
      (response, index) => ({
        ...response,
        response_state: index < count ? ('approved' as const) : response.response_state,
      }),
    ),
  };
}

function selectCandidateIntent(): DecisionMutationIntent {
  return {kind: 'SELECT_CANDIDATE', candidate_id: RIVERSIDE_ID};
}

function approveParticipantIntent(
  index: number,
): DecisionMutationIntent {
  return {
    kind: 'SET_PARTICIPANT_RESPONSE',
    participant_id: PARTICIPANT_IDS[index % PARTICIPANT_IDS.length],
    response_state: 'approved',
  };
}

function asMutable(snapshot: DecisionSnapshot): MutableSnapshot {
  return snapshot as MutableSnapshot;
}

export function describeDecisionStoreContract(
  harness: DecisionStoreContractHarness,
): void {
  const horizon = harness.expiryHorizonSeconds ?? 3600;

  function createInput(
    decision_id: DecisionId = DECISION_ID,
    initial_state: DecisionSnapshot = pendingSnapshot(),
  ): CreateDecisionInput {
    return {
      decision_id,
      initial_state,
      expires_at: harness.time.nowSeconds() + horizon,
    };
  }

  function applyInput(
    operation_id: OperationId,
    base_version: number,
    mutation: DecisionMutationIntent,
    next_state: DecisionSnapshot,
    decision_id: DecisionId = DECISION_ID,
  ): ApplyDecisionMutationInput {
    return {
      decision_id,
      operation_id,
      base_version,
      mutation,
      next_state,
    };
  }

  function createStore(): DecisionStore {
    return harness.createStore();
  }

  async function createActive(
    store: DecisionStore,
    initial_state: DecisionSnapshot = pendingSnapshot(),
  ): Promise<void> {
    const created = await store.createDecision(
      createInput(DECISION_ID, initial_state),
    );
    if (created.kind !== 'CREATED') {
      throw new Error(`expected CREATED, received ${created.kind}`);
    }
  }

  async function applyOrThrow(
    store: DecisionStore,
    input: ApplyDecisionMutationInput,
  ): Promise<Extract<
    Awaited<ReturnType<DecisionStore['applyMutation']>>,
    {kind: 'APPLIED'}
  >> {
    const result = await store.applyMutation(input);
    if (result.kind !== 'APPLIED') {
      throw new Error(`expected APPLIED, received ${result.kind}`);
    }
    return result;
  }

  async function loadCanonical(
    store: DecisionStore,
    decision_id: DecisionId = DECISION_ID,
  ): Promise<Extract<
    Awaited<ReturnType<DecisionStore['loadDecision']>>,
    {kind: 'FOUND'}
  >['canonical_state']> {
    const loaded = await store.loadDecision(decision_id);
    if (loaded.kind !== 'FOUND') {
      throw new Error(`expected FOUND, received ${loaded.kind}`);
    }
    return loaded.canonical_state;
  }

  describe('create and load', () => {
    it('creates a new decision at version 1 with the supplied snapshot', async () => {
      const store = createStore();

      const result = await store.createDecision(createInput());

      expect(result.kind).toBe('CREATED');
      if (result.kind !== 'CREATED') {
        throw new Error(`expected CREATED, received ${result.kind}`);
      }
      expect(result.canonical_state).toEqual({
        ...pendingSnapshot(),
        decision_id: DECISION_ID,
        version: 1,
      });
    });

    it('loads back the canonical created state', async () => {
      const store = createStore();
      await createActive(store);

      expect(await store.loadDecision(DECISION_ID)).toEqual({
        kind: 'FOUND',
        canonical_state: {
          ...pendingSnapshot(),
          decision_id: DECISION_ID,
          version: 1,
        },
      });
    });

    it('returns ALREADY_EXISTS with the current canonical state on duplicate create', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.createDecision(createInput());

      expect(result.kind).toBe('ALREADY_EXISTS');
      if (result.kind !== 'ALREADY_EXISTS') {
        throw new Error(`expected ALREADY_EXISTS, received ${result.kind}`);
      }
      expect(result.canonical_state.version).toBe(2);
      expect(result.canonical_state.selected_candidate_id).toBe(RIVERSIDE_ID);
    });

    it('does not overwrite the existing decision on duplicate create', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      await store.createDecision(createInput());

      expect(await loadCanonical(store)).toEqual({
        ...approvedThrough(1),
        decision_id: DECISION_ID,
        version: 2,
      });
    });

    it('returns NOT_FOUND with the decision id for an unknown decision', async () => {
      const store = createStore();

      expect(await store.loadDecision(OTHER_DECISION_ID)).toEqual({
        kind: 'NOT_FOUND',
        decision_id: OTHER_DECISION_ID,
      });
    });
  });

  describe('compare-and-set versions', () => {
    it('applies a mutation whose base_version matches the stored version', async () => {
      const store = createStore();
      await createActive(store);

      const result = await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result).toEqual({
        kind: 'APPLIED',
        applied: true,
        operation_id: 'op-select',
        committed_version: 2,
        canonical_state: {
          ...approvedThrough(1),
          decision_id: DECISION_ID,
          version: 2,
        },
      });
    });

    it('increments the version by exactly one per applied mutation', async () => {
      const store = createStore();
      await createActive(store);

      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      await applyOrThrow(
        store,
        applyInput(
          'op-approve-1',
          2,
          approveParticipantIntent(0),
          approvedThrough(2),
        ),
      );

      expect((await loadCanonical(store)).version).toBe(3);
    });

    it('rejects a stale base_version with the current version', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.applyMutation(
        applyInput('op-stale', 1, approveParticipantIntent(0), approvedThrough(2)),
      );

      expect(result).toEqual({
        kind: 'STALE_VERSION',
        applied: false,
        reason: 'STALE_VERSION',
        current_version: 2,
        canonical_state: {
          ...approvedThrough(1),
          decision_id: DECISION_ID,
          version: 2,
        },
      });
    });

    it('does not mutate on a stale result and records no receipt', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      await store.applyMutation(
        applyInput('op-stale', 1, approveParticipantIntent(0), approvedThrough(2)),
      );

      expect(await loadCanonical(store)).toEqual({
        ...approvedThrough(1),
        decision_id: DECISION_ID,
        version: 2,
      });
      const retry = await store.applyMutation(
        applyInput('op-stale', 2, approveParticipantIntent(0), approvedThrough(2)),
      );
      expect(retry.kind).toBe('APPLIED');
      expect(retry.kind === 'APPLIED' && retry.committed_version).toBe(3);
    });

    it('never merges, retries, or falls back to last-write-wins', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      const rejected = await store.applyMutation(
        applyInput('op-loser', 1, approveParticipantIntent(0), approvedThrough(2)),
      );
      expect(rejected.kind).toBe('STALE_VERSION');

      await applyOrThrow(
        store,
        applyInput('op-winner', 2, approveParticipantIntent(1), approvedThrough(2)),
      );

      const state = await loadCanonical(store);
      expect(state).toEqual({
        ...approvedThrough(2),
        decision_id: DECISION_ID,
        version: 3,
      });
      const loser_retry = await store.applyMutation(
        applyInput('op-loser', 3, approveParticipantIntent(0), approvedThrough(3)),
      );
      expect(loser_retry.kind).toBe('APPLIED');
      expect(await loadCanonical(store)).toEqual({
        ...approvedThrough(3),
        decision_id: DECISION_ID,
        version: 4,
      });
    });
  });

  describe('idempotent replay and conflicts', () => {
    it('applies the first operation for an operation ID', async () => {
      const store = createStore();
      await createActive(store);

      const result = await store.applyMutation(
        applyInput('op-first', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result.kind).toBe('APPLIED');
    });

    it('replays the same operation ID with the same request', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result).toEqual({
        kind: 'IDEMPOTENT_REPLAY',
        applied: false,
        reason: 'IDEMPOTENT_REPLAY',
        operation_id: 'op-select',
        committed_version: 2,
        canonical_state: {
          ...approvedThrough(1),
          decision_id: DECISION_ID,
          version: 2,
        },
      });
    });

    it('does not increment the version on replay', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect((await loadCanonical(store)).version).toBe(2);
    });

    it('returns the original committed version on replay', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result.kind).toBe('IDEMPOTENT_REPLAY');
      expect(result.kind === 'IDEMPOTENT_REPLAY' && result.committed_version).toBe(
        2,
      );
    });

    it('replay after later writes keeps the original committed version and current state', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      await applyOrThrow(
        store,
        applyInput(
          'op-approve-1',
          2,
          approveParticipantIntent(0),
          approvedThrough(2),
        ),
      );

      const result = await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result.kind).toBe('IDEMPOTENT_REPLAY');
      if (result.kind !== 'IDEMPOTENT_REPLAY') {
        throw new Error(`expected IDEMPOTENT_REPLAY, received ${result.kind}`);
      }
      expect(result.committed_version).toBe(2);
      expect(result.canonical_state).toEqual({
        ...approvedThrough(2),
        decision_id: DECISION_ID,
        version: 3,
      });
    });

    it('conflicts when the same operation ID carries a different request', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.applyMutation(
        applyInput('op-select', 2, approveParticipantIntent(0), approvedThrough(2)),
      );

      expect(result).toEqual({
        kind: 'OPERATION_ID_CONFLICT',
        applied: false,
        reason: 'OPERATION_ID_CONFLICT',
        operation_id: 'op-select',
        current_version: 2,
        canonical_state: {
          ...approvedThrough(1),
          decision_id: DECISION_ID,
          version: 2,
        },
      });
    });

    it('does not mutate on conflict and keeps the original receipt', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      await store.applyMutation(
        applyInput('op-select', 2, approveParticipantIntent(0), approvedThrough(2)),
      );

      expect(await loadCanonical(store)).toEqual({
        ...approvedThrough(1),
        decision_id: DECISION_ID,
        version: 2,
      });
      const original_replay = await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      expect(original_replay.kind).toBe('IDEMPOTENT_REPLAY');
    });

    it('gives replay and conflict precedence over stale versions', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      await applyOrThrow(
        store,
        applyInput(
          'op-approve-1',
          2,
          approveParticipantIntent(0),
          approvedThrough(2),
        ),
      );

      const replay = await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      const conflict = await store.applyMutation(
        applyInput('op-select', 2, approveParticipantIntent(0), approvedThrough(2)),
      );

      expect(replay.kind).toBe('IDEMPOTENT_REPLAY');
      expect(conflict.kind).toBe('OPERATION_ID_CONFLICT');
      expect(
        conflict.kind === 'OPERATION_ID_CONFLICT' && conflict.current_version,
      ).toBe(3);
    });
  });

  describe('operation and input bounds', () => {
    it('rejects an empty operation ID as INPUT_BOUNDS without mutating', async () => {
      const store = createStore();
      await createActive(store);

      const result = await store.applyMutation(
        applyInput('', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result).toEqual({kind: 'LIMIT_EXCEEDED', reason: 'INPUT_BOUNDS'});
      expect((await loadCanonical(store)).version).toBe(1);
      const later = await store.applyMutation(
        applyInput('op-later', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      expect(later.kind).toBe('APPLIED');
    });

    it('rejects operation IDs over 128 UTF-8 bytes, counting bytes not code units', async () => {
      const store = createStore();
      await createActive(store);

      const ascii_overflow = await store.applyMutation(
        applyInput(
          'a'.repeat(129),
          1,
          selectCandidateIntent(),
          approvedThrough(1),
        ),
      );
      const multibyte_overflow = await store.applyMutation(
        applyInput(
          'é'.repeat(100),
          1,
          selectCandidateIntent(),
          approvedThrough(1),
        ),
      );

      expect(ascii_overflow).toEqual({
        kind: 'LIMIT_EXCEEDED',
        reason: 'INPUT_BOUNDS',
      });
      expect(multibyte_overflow).toEqual({
        kind: 'LIMIT_EXCEEDED',
        reason: 'INPUT_BOUNDS',
      });
      expect((await loadCanonical(store)).version).toBe(1);
    });

    it('rejects non-positive or unsafe base_version as INPUT_BOUNDS', async () => {
      const store = createStore();
      await createActive(store);

      for (const base_version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const result = await store.applyMutation(
          applyInput(
            'op-bad-base',
            base_version,
            selectCandidateIntent(),
            approvedThrough(1),
          ),
        );
        expect(result).toEqual({
          kind: 'LIMIT_EXCEEDED',
          reason: 'INPUT_BOUNDS',
        });
      }
      expect((await loadCanonical(store)).version).toBe(1);
    });

    it('accepts an operation ID of exactly 128 UTF-8 bytes', async () => {
      const store = createStore();
      await createActive(store);

      const result = await store.applyMutation(
        applyInput(
          'é'.repeat(64),
          1,
          selectCandidateIntent(),
          approvedThrough(1),
        ),
      );

      expect(result.kind).toBe('APPLIED');
      expect(result.kind === 'APPLIED' && result.committed_version).toBe(2);
    });

    it('accepts forty successful operations', async () => {
      const store = createStore();
      await createActive(store);

      for (let index = 0; index < 40; index += 1) {
        const result = await store.applyMutation(
          applyInput(
            `op-bound-${index}`,
            1 + index,
            approveParticipantIntent(index),
            approvedThrough(index + 1),
          ),
        );
        expect(result.kind).toBe('APPLIED');
      }

      expect((await loadCanonical(store)).version).toBe(41);
    });

    it('rejects the forty-first new operation with OPERATION_COUNT', async () => {
      const store = createStore();
      await createActive(store);
      for (let index = 0; index < 40; index += 1) {
        await applyOrThrow(
          store,
          applyInput(
            `op-bound-${index}`,
            1 + index,
            approveParticipantIntent(index),
            approvedThrough(index + 1),
          ),
        );
      }

      const result = await store.applyMutation(
        applyInput('op-bound-40', 41, selectCandidateIntent(), approvedThrough(4)),
      );

      expect(result).toEqual({
        kind: 'LIMIT_EXCEEDED',
        reason: 'OPERATION_COUNT',
      });
      expect((await loadCanonical(store)).version).toBe(41);
    });

    it('keeps replay working at the receipt limit', async () => {
      const store = createStore();
      await createActive(store);
      for (let index = 0; index < 40; index += 1) {
        await applyOrThrow(
          store,
          applyInput(
            `op-bound-${index}`,
            1 + index,
            approveParticipantIntent(index),
            approvedThrough(index + 1),
          ),
        );
      }

      const result = await store.applyMutation(
        applyInput(
          'op-bound-39',
          40,
          approveParticipantIntent(39),
          approvedThrough(40),
        ),
      );

      expect(result.kind).toBe('IDEMPOTENT_REPLAY');
      expect(
        result.kind === 'IDEMPOTENT_REPLAY' && result.committed_version,
      ).toBe(41);
    });

    it('keeps conflict working at the receipt limit', async () => {
      const store = createStore();
      await createActive(store);
      for (let index = 0; index < 40; index += 1) {
        await applyOrThrow(
          store,
          applyInput(
            `op-bound-${index}`,
            1 + index,
            approveParticipantIntent(index),
            approvedThrough(index + 1),
          ),
        );
      }

      const result = await store.applyMutation(
        applyInput(
          'op-bound-39',
          40,
          approveParticipantIntent(38),
          approvedThrough(0),
        ),
      );

      expect(result.kind).toBe('OPERATION_ID_CONFLICT');
      expect(
        result.kind === 'OPERATION_ID_CONFLICT' && result.current_version,
      ).toBe(41);
    });
  });

  describe('expiry', () => {
    it('loads a decision while it is active', async () => {
      const store = createStore();
      await createActive(store);
      harness.time.advanceSeconds(horizon - 1);

      expect(await store.loadDecision(DECISION_ID)).toMatchObject({
        kind: 'FOUND',
      });
    });

    it('treats an expired decision as absent', async () => {
      const store = createStore();
      await createActive(store);
      harness.time.advanceSeconds(horizon + 1);

      expect(await store.loadDecision(DECISION_ID)).toEqual({
        kind: 'NOT_FOUND',
        decision_id: DECISION_ID,
      });
    });

    it('rejects mutations for an expired decision', async () => {
      const store = createStore();
      await createActive(store);
      harness.time.advanceSeconds(horizon + 1);

      const result = await store.applyMutation(
        applyInput('op-after-expiry', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result).toEqual({kind: 'NOT_FOUND', decision_id: DECISION_ID});
      expect(await store.loadDecision(DECISION_ID)).toEqual({
        kind: 'NOT_FOUND',
        decision_id: DECISION_ID,
      });
    });

    it('allows a fresh lifecycle when the expired id is created again', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-before-expiry', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      harness.time.advanceSeconds(horizon + 1);

      const recreated = await store.createDecision(createInput());
      expect(recreated.kind).toBe('CREATED');
      if (recreated.kind !== 'CREATED') {
        throw new Error(`expected CREATED, received ${recreated.kind}`);
      }
      expect(recreated.canonical_state.version).toBe(1);

      const old_operation = await store.applyMutation(
        applyInput('op-before-expiry', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      expect(old_operation.kind).toBe('APPLIED');
    });
  });

  describe('immutability', () => {
    it('isolates stored state from create-input mutation', async () => {
      const store = createStore();
      const initial = pendingSnapshot();
      await store.createDecision(createInput(DECISION_ID, initial));

      const mutated = asMutable(initial);
      mutated.selected_candidate_id = RIVERSIDE_ID;
      mutated.participant_responses.push({
        participant_id: 'participant-injected',
        response_state: 'approved',
      });

      expect(await loadCanonical(store)).toEqual({
        ...pendingSnapshot(),
        decision_id: DECISION_ID,
        version: 1,
      });
    });

    it('isolates stored state from load-result mutation', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const loaded = await loadCanonical(store);
      const mutated = asMutable(loaded);
      mutated.selected_candidate_id = null;
      mutated.participant_responses.push({
        participant_id: 'participant-injected',
        response_state: 'rejected',
      });
      mutated.participant_responses[0] = {
        participant_id: PARTICIPANT_IDS[0],
        response_state: 'rejected',
      };

      expect(await loadCanonical(store)).toEqual({
        ...approvedThrough(1),
        decision_id: DECISION_ID,
        version: 2,
      });
    });

    it('isolates stored state from apply-input mutation', async () => {
      const store = createStore();
      await createActive(store);
      const next_state = approvedThrough(1);

      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), next_state),
      );

      const mutated = asMutable(next_state);
      mutated.selected_candidate_id = null;
      mutated.participant_responses.push({
        participant_id: 'participant-injected',
        response_state: 'approved',
      });

      expect(await loadCanonical(store)).toEqual({
        ...approvedThrough(1),
        decision_id: DECISION_ID,
        version: 2,
      });
    });

    it('isolates stored state from apply-result mutation', async () => {
      const store = createStore();
      await createActive(store);

      const result = await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      const mutated = asMutable(result.canonical_state);
      mutated.selected_candidate_id = null;
      mutated.participant_responses.push({
        participant_id: 'participant-injected',
        response_state: 'rejected',
      });

      expect(await loadCanonical(store)).toEqual({
        ...approvedThrough(1),
        decision_id: DECISION_ID,
        version: 2,
      });
    });
  });

  describe('mutation fingerprint', () => {
    it('treats the same logical request as a stable fingerprint', async () => {
      const store = createStore();
      await createActive(store);

      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );
      const reissued = await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(reissued.kind).toBe('IDEMPOTENT_REPLAY');
    });

    it('produces a different fingerprint when the mutation changes', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.applyMutation(
        applyInput('op-select', 2, approveParticipantIntent(0), approvedThrough(2)),
      );

      expect(result.kind).toBe('OPERATION_ID_CONFLICT');
    });

    it('produces a different fingerprint when the next state changes', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.applyMutation(
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(2)),
      );

      expect(result.kind).toBe('OPERATION_ID_CONFLICT');
    });

    it('produces a different fingerprint when the base version changes', async () => {
      const store = createStore();
      await createActive(store);
      await applyOrThrow(
        store,
        applyInput('op-select', 1, selectCandidateIntent(), approvedThrough(1)),
      );

      const result = await store.applyMutation(
        applyInput('op-select', 2, selectCandidateIntent(), approvedThrough(1)),
      );

      expect(result.kind).toBe('OPERATION_ID_CONFLICT');
    });
  });

  describe('persistence boundary', () => {
    it('stores the supplied next_state without rerunning product rules', async () => {
      const store = createStore();
      await createActive(store);
      const product_illegal_state: DecisionSnapshot = {
        selected_candidate_id: 'option-not-in-fixture',
        participant_responses: [
          {participant_id: 'participant-alex', response_state: 'approved'},
          {participant_id: 'participant-unknown', response_state: 'rejected'},
        ],
        confirmed_plan: {
          plan_id: PLAN_ID,
          version: 7,
          selected_components: [
            {component_id: 'component-activity', option_id: RIVERSIDE_ID},
          ],
          confirmation_state: 'confirmed',
        },
        fixture_state: initialDecisionState.fixture_state,
      };

      const result = await applyOrThrow(
        store,
        applyInput(
          'op-illegal-but-validated-upstream',
          1,
          selectCandidateIntent(),
          product_illegal_state,
        ),
      );

      expect(result.canonical_state).toEqual({
        ...product_illegal_state,
        decision_id: DECISION_ID,
        version: 2,
      });
      expect(await loadCanonical(store)).toEqual({
        ...product_illegal_state,
        decision_id: DECISION_ID,
        version: 2,
      });
    });
  });
}
