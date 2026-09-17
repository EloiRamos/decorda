import {evaluateConsensus, recordParticipantResponse} from '../domain/consensus';
import {
  createReferenceConfirmedPlan,
  findReferenceCandidate,
  isReferenceCandidateFeasible,
  referencePendingResponses,
  REFERENCE_DECISION_ID,
  REFERENCE_PLAN_ID,
} from '../domain/decisionScenario';
import {initialDecisionState, referenceParticipants} from '../domain/fixtures';
import type {
  CandidateOptionId,
  DecisionId,
  ParticipantId,
  ParticipantResponseState,
} from '../domain/types';
import type {
  ApplyDecisionMutationResult,
  CanonicalDecisionState,
  DecisionSnapshot,
  DecisionStore,
  OperationId,
  PersistenceFailure,
} from './decisionStore';

export type CanonicalLifecycleResult =
  | Readonly<{
      kind: 'CANONICAL';
      outcome:
        | 'CREATED'
        | 'ALREADY_EXISTS'
        | 'LOADED'
        | 'APPLIED'
        | 'REPLAYED'
        | 'STALE'
        | 'NO_CHANGE';
      canonical_state: CanonicalDecisionState;
      committed_version?: number;
    }>
  | Readonly<{kind: 'NOT_FOUND'; decision_id: DecisionId}>
  | Readonly<{kind: 'EXPIRED'}>
  | Readonly<{
      kind: 'REJECTED';
      reason:
        | 'ALREADY_CONFIRMED'
        | 'CANDIDATE_INFEASIBLE'
        | 'CANDIDATE_UNKNOWN'
        | 'CANDIDATE_REQUIRED'
        | 'CONFIRMATION_NOT_READY'
        | 'PARTICIPANT_UNKNOWN'
        | 'PENDING_RESPONSE_NOT_ALLOWED';
      canonical_state: CanonicalDecisionState;
    }>
  | PersistenceFailure
  | Readonly<{
      kind: 'OPERATION_ID_CONFLICT';
      canonical_state: CanonicalDecisionState;
    }>;

export type MutationIdentity = Readonly<{
  operation_id: OperationId;
  base_version: number;
}>;

export function createReferenceSnapshot(): DecisionSnapshot {
  return {
    selected_candidate_id: null,
    participant_responses: referencePendingResponses(),
    confirmed_plan: null,
    fixture_state: initialDecisionState.fixture_state,
  };
}

function snapshotOf(canonical: CanonicalDecisionState): DecisionSnapshot {
  return {
    selected_candidate_id: canonical.selected_candidate_id,
    participant_responses: canonical.participant_responses,
    confirmed_plan: canonical.confirmed_plan,
    fixture_state: canonical.fixture_state,
  };
}

function fromMutation(
  result: ApplyDecisionMutationResult,
): CanonicalLifecycleResult {
  switch (result.kind) {
    case 'APPLIED':
      return {
        kind: 'CANONICAL',
        outcome: 'APPLIED',
        canonical_state: result.canonical_state,
        committed_version: result.committed_version,
      };
    case 'IDEMPOTENT_REPLAY':
      return {
        kind: 'CANONICAL',
        outcome: 'REPLAYED',
        canonical_state: result.canonical_state,
        committed_version: result.committed_version,
      };
    case 'STALE_VERSION':
      return {
        kind: 'CANONICAL',
        outcome: 'STALE',
        canonical_state: result.canonical_state,
      };
    case 'OPERATION_ID_CONFLICT':
      return {
        kind: 'OPERATION_ID_CONFLICT',
        canonical_state: result.canonical_state,
      };
    default:
      return result;
  }
}

export async function openCanonicalDecision(
  store: DecisionStore,
  decision_id: DecisionId = REFERENCE_DECISION_ID,
): Promise<CanonicalLifecycleResult> {
  const result = await store.loadDecision(decision_id);
  if (result.kind === 'FOUND') {
    return {
      kind: 'CANONICAL',
      outcome: 'LOADED',
      canonical_state: result.canonical_state,
    };
  }
  return result;
}

export async function startReferenceDecision(
  store: DecisionStore,
  expires_at: number,
): Promise<CanonicalLifecycleResult> {
  const result = await store.createDecision({
    decision_id: REFERENCE_DECISION_ID,
    initial_state: createReferenceSnapshot(),
    expires_at,
  });
  if (result.kind === 'CREATED' || result.kind === 'ALREADY_EXISTS') {
    return {
      kind: 'CANONICAL',
      outcome: result.kind,
      canonical_state: result.canonical_state,
    };
  }
  return result;
}

export async function selectCanonicalCandidate(
  store: DecisionStore,
  identity: MutationIdentity,
  candidate_id: CandidateOptionId,
): Promise<CanonicalLifecycleResult> {
  const loaded = await store.loadDecision(REFERENCE_DECISION_ID);
  if (loaded.kind !== 'FOUND') {
    return loaded;
  }
  const canonical = loaded.canonical_state;
  if (canonical.confirmed_plan !== null) {
    return {kind: 'REJECTED', reason: 'ALREADY_CONFIRMED', canonical_state: canonical};
  }
  if (findReferenceCandidate(candidate_id) === null) {
    return {kind: 'REJECTED', reason: 'CANDIDATE_UNKNOWN', canonical_state: canonical};
  }
  if (!isReferenceCandidateFeasible(candidate_id)) {
    return {kind: 'REJECTED', reason: 'CANDIDATE_INFEASIBLE', canonical_state: canonical};
  }
  if (
    canonical.version === identity.base_version &&
    canonical.selected_candidate_id === candidate_id
  ) {
    return {kind: 'CANONICAL', outcome: 'NO_CHANGE', canonical_state: canonical};
  }
  return fromMutation(
    await store.applyMutation({
      decision_id: REFERENCE_DECISION_ID,
      ...identity,
      mutation: {kind: 'SELECT_CANDIDATE', candidate_id},
      next_state: {
        selected_candidate_id: candidate_id,
        participant_responses: referencePendingResponses(),
        confirmed_plan: null,
        fixture_state: canonical.fixture_state,
      },
    }),
  );
}

export async function setCanonicalParticipantResponse(
  store: DecisionStore,
  identity: MutationIdentity,
  participant_id: ParticipantId,
  response_state: ParticipantResponseState,
): Promise<CanonicalLifecycleResult> {
  const loaded = await store.loadDecision(REFERENCE_DECISION_ID);
  if (loaded.kind !== 'FOUND') {
    return loaded;
  }
  const canonical = loaded.canonical_state;
  if (canonical.confirmed_plan !== null) {
    return {kind: 'REJECTED', reason: 'ALREADY_CONFIRMED', canonical_state: canonical};
  }
  if (canonical.selected_candidate_id === null) {
    return {kind: 'REJECTED', reason: 'CANDIDATE_REQUIRED', canonical_state: canonical};
  }
  if (response_state === 'pending') {
    return {kind: 'REJECTED', reason: 'PENDING_RESPONSE_NOT_ALLOWED', canonical_state: canonical};
  }
  if (!referenceParticipants.some(participant => participant.id === participant_id)) {
    return {kind: 'REJECTED', reason: 'PARTICIPANT_UNKNOWN', canonical_state: canonical};
  }
  const responses = recordParticipantResponse(
    canonical.participant_responses,
    participant_id,
    response_state,
  );
  if (responses === null) {
    return {kind: 'REJECTED', reason: 'PARTICIPANT_UNKNOWN', canonical_state: canonical};
  }
  const current = canonical.participant_responses.find(
    response => response.participant_id === participant_id,
  );
  if (
    canonical.version === identity.base_version &&
    current?.response_state === response_state
  ) {
    return {kind: 'CANONICAL', outcome: 'NO_CHANGE', canonical_state: canonical};
  }
  return fromMutation(
    await store.applyMutation({
      decision_id: REFERENCE_DECISION_ID,
      ...identity,
      mutation: {kind: 'SET_PARTICIPANT_RESPONSE', participant_id, response_state},
      next_state: {...snapshotOf(canonical), participant_responses: responses},
    }),
  );
}

export async function confirmCanonicalPlan(
  store: DecisionStore,
  identity: MutationIdentity,
): Promise<CanonicalLifecycleResult> {
  const loaded = await store.loadDecision(REFERENCE_DECISION_ID);
  if (loaded.kind !== 'FOUND') {
    return loaded;
  }
  const canonical = loaded.canonical_state;
  if (canonical.confirmed_plan !== null) {
    if (canonical.version === identity.base_version) {
      return {kind: 'CANONICAL', outcome: 'NO_CHANGE', canonical_state: canonical};
    }
    return fromMutation(
      await store.applyMutation({
        decision_id: REFERENCE_DECISION_ID,
        ...identity,
        mutation: {kind: 'CONFIRM_PLAN', plan_id: REFERENCE_PLAN_ID},
        next_state: snapshotOf(canonical),
      }),
    );
  }
  if (
    canonical.selected_candidate_id === null ||
    evaluateConsensus(canonical.participant_responses) !== 'approved'
  ) {
    return {kind: 'REJECTED', reason: 'CONFIRMATION_NOT_READY', canonical_state: canonical};
  }
  const plan = createReferenceConfirmedPlan(
    canonical.selected_candidate_id,
    canonical.participant_responses,
  );
  if (plan === null) {
    return {kind: 'REJECTED', reason: 'CONFIRMATION_NOT_READY', canonical_state: canonical};
  }
  return fromMutation(
    await store.applyMutation({
      decision_id: REFERENCE_DECISION_ID,
      ...identity,
      mutation: {kind: 'CONFIRM_PLAN', plan_id: REFERENCE_PLAN_ID},
      next_state: {...snapshotOf(canonical), confirmed_plan: plan},
    }),
  );
}
