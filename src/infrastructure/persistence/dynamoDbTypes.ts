import type {
  OperationId,
  OperationReceipt,
} from '../../application/decisionStore';
import type {
  CandidateOptionId,
  ConfirmedPlan,
  DecisionFixtureState,
  DecisionId,
  ParticipantResponse,
} from '../../domain/types';

// Canonical persisted item shape with the stable snake-case attribute names.
// `null` encodes the DynamoDB NULL of absent selected/confirmed state, never
// `undefined`. Public-safe only: no UI/focus/feasibility/consensus state,
// credentials, or table configuration.
export type DynamoDbDecisionItem = Readonly<{
  decision_id: DecisionId;
  schema_version: number;
  version: number;
  selected_candidate_id: CandidateOptionId | null;
  participant_responses: readonly ParticipantResponse[];
  confirmed_plan: ConfirmedPlan | null;
  fixture_state: DecisionFixtureState;
  operation_ids: readonly OperationId[];
  operation_receipts: readonly OperationReceipt[];
  expires_at: number;
}>;
