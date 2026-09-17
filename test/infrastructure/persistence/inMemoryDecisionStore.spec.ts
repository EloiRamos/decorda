import {InMemoryDecisionStore} from '../../../src/infrastructure/persistence/inMemoryDecisionStore';
import {describeDecisionStoreContract} from './decisionStoreContract';
import {initialDecisionState} from '../../../src/domain/fixtures';
import type {DecisionId} from '../../../src/domain/types';
import type {DecisionSnapshot} from '../../../src/application/decisionStore';

const DECISION_ID: DecisionId = initialDecisionState.decision_id;

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

describe('PERSISTENCE-001 InMemoryDecisionStore shared adapter contract', () => {
  let now_seconds = 1_000;

  describeDecisionStoreContract({
    createStore: () => new InMemoryDecisionStore({now: () => now_seconds}),
    time: {
      nowSeconds: () => now_seconds,
      advanceSeconds: delta => {
        now_seconds += delta;
      },
    },
  });
});

describe('PERSISTENCE-001 InMemoryDecisionStore fake-specific behavior', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('flips visibility exactly at the injected expiry boundary', async () => {
    let now_seconds = 1_000;
    const store = new InMemoryDecisionStore({now: () => now_seconds});

    const created = await store.createDecision({
      decision_id: DECISION_ID,
      initial_state: pendingSnapshot(),
      expires_at: 1_100,
    });
    expect(created.kind).toBe('CREATED');

    now_seconds = 1_099;
    await expect(store.loadDecision(DECISION_ID)).resolves.toMatchObject({
      kind: 'FOUND',
    });

    now_seconds = 1_100;
    await expect(store.loadDecision(DECISION_ID)).resolves.toEqual({
      kind: 'NOT_FOUND',
      decision_id: DECISION_ID,
    });
    await expect(
      store.applyMutation({
        decision_id: DECISION_ID,
        operation_id: 'op-at-expiry',
        base_version: 1,
        mutation: {
          kind: 'SELECT_CANDIDATE',
          candidate_id: 'option-riverside-picnic',
        },
        next_state: pendingSnapshot(),
      }),
    ).resolves.toEqual({kind: 'NOT_FOUND', decision_id: DECISION_ID});
  });

  it('isolates records between store instances', async () => {
    const clock = () => 1_000;
    const first = new InMemoryDecisionStore({now: clock});
    const second = new InMemoryDecisionStore({now: clock});

    await first.createDecision({
      decision_id: DECISION_ID,
      initial_state: pendingSnapshot(),
      expires_at: 2_000,
    });

    await expect(first.loadDecision(DECISION_ID)).resolves.toMatchObject({
      kind: 'FOUND',
    });
    await expect(second.loadDecision(DECISION_ID)).resolves.toEqual({
      kind: 'NOT_FOUND',
      decision_id: DECISION_ID,
    });
  });

  it('never consults the wall clock when a deterministic clock is injected', async () => {
    const date_now_spy = jest.spyOn(Date, 'now');
    let now_seconds = 1_000;
    const store = new InMemoryDecisionStore({now: () => now_seconds});

    await store.createDecision({
      decision_id: DECISION_ID,
      initial_state: pendingSnapshot(),
      expires_at: 2_000,
    });
    now_seconds = 1_500;
    await store.applyMutation({
      decision_id: DECISION_ID,
      operation_id: 'op-deterministic',
      base_version: 1,
      mutation: {
        kind: 'SELECT_CANDIDATE',
        candidate_id: 'option-riverside-picnic',
      },
      next_state: {
        ...pendingSnapshot(),
        selected_candidate_id: 'option-riverside-picnic',
      },
    });
    now_seconds = 1_999;
    await store.loadDecision(DECISION_ID);

    expect(date_now_spy).not.toHaveBeenCalled();
  });
});
