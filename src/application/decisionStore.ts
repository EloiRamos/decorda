import type {
  CandidateOptionId,
  ConfirmedPlan,
  DecisionFixtureState,
  DecisionId,
  ParticipantId,
  ParticipantResponse,
  ParticipantResponseState,
  PlanId,
} from '../domain/types';

// Frozen PERSISTENCE-001 envelope bounds; enforcement arrives with the
// persistence adapters, not in this module.
export const MAX_OPERATION_RECEIPTS = 40;
export const MAX_ITEM_SIZE_BYTES = 32 * 1024;
export const MAX_OPERATION_ID_UTF8_BYTES = 128;

// Opaque, non-empty, client-generated; at most 128 UTF-8 bytes.
export type OperationId = string;

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

export type OperationReceipt = Readonly<{
  operation_id: OperationId;
  mutation_fingerprint: string;
  committed_version: number;
}>;

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

export interface DecisionStore {
  createDecision(input: CreateDecisionInput): Promise<CreateDecisionResult>;
  loadDecision(decision_id: DecisionId): Promise<LoadDecisionResult>;
  applyMutation(
    input: ApplyDecisionMutationInput,
  ): Promise<ApplyDecisionMutationResult>;
}
