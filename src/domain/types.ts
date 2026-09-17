export type ParticipantId = `participant-${string}`;
export type ConstraintId = `constraint-${string}`;
export type CandidateOptionId = `option-${string}`;
export type PlanId = `plan-${string}`;
export type PlanComponentId = `component-${string}`;
export type DecisionId = `decision-${string}`;
export type ContextChangeId = `context-change-${string}`;

export type ParticipantResponseState = 'pending' | 'approved' | 'rejected';

export type Participant = Readonly<{
  id: ParticipantId;
  display_name: string;
  response_state: ParticipantResponseState;
}>;

export type HardConstraint =
  | Readonly<{
      id: ConstraintId;
      kind: 'hard';
      category: 'budget';
      label: string;
      value: Readonly<{
        unit: 'EUR';
        maximum: number;
      }>;
    }>
  | Readonly<{
      id: ConstraintId;
      kind: 'hard';
      category: 'return_time';
      label: string;
      value: Readonly<{
        format: 'minutes_after_midnight';
        latest: number;
        display: string;
      }>;
    }>;

export type SoftConstraint = Readonly<{
  id: ConstraintId;
  kind: 'soft';
  category: 'setting_preference';
  label: string;
  value: Readonly<{
    preference: 'outdoor';
  }>;
}>;

export type Constraint = HardConstraint | SoftConstraint;

export type CandidateOption = Readonly<{
  id: CandidateOptionId;
  title: string;
  cost_eur: number;
  return_time: Readonly<{
    format: 'minutes_after_midnight';
    value: number;
    display: string;
  }>;
  setting: 'indoor' | 'outdoor';
  description: string;
}>;

export type RejectionReasonCode = 'over_budget' | 'returns_too_late';

export type RejectionReason = Readonly<{
  code: RejectionReasonCode;
  constraint_id: ConstraintId;
  message: string;
}>;

export type SoftTradeoffCode =
  | 'matches_outdoor_preference'
  | 'does_not_match_outdoor_preference';

export type SoftTradeoffNote = Readonly<{
  code: SoftTradeoffCode;
  constraint_id: ConstraintId;
  note: string;
}>;

export type FeasibilityResult = Readonly<{
  feasible: boolean;
  rejection_reasons: readonly RejectionReason[];
  soft_tradeoff_notes: readonly SoftTradeoffNote[];
}>;

export type PlanComponentReference = Readonly<{
  component_id: PlanComponentId;
  option_id: CandidateOptionId;
}>;

export type ConfirmedPlan = Readonly<{
  plan_id: PlanId;
  version: number;
  selected_components: readonly PlanComponentReference[];
  confirmation_state: 'confirmed';
}>;

export type AffectedComponentReference = Readonly<{
  classification: 'affected';
  component_id: PlanComponentId;
}>;

export type PreservedComponentReference = Readonly<{
  classification: 'preserved';
  component_id: PlanComponentId;
}>;

export type ContextChange = Readonly<{
  id: ContextChangeId;
  changed_component_id: PlanComponentId;
  changed_category: 'activity_conditions';
  reason: string;
  source: 'synthetic_fixture';
  deterministic: true;
  later_classification_value: 'outdoor_activity_disrupted';
  affected_component: AffectedComponentReference;
  preserved_components: readonly PreservedComponentReference[];
}>;

export type ParticipantResponse = Readonly<{
  participant_id: ParticipantId;
  response_state: ParticipantResponseState;
}>;

export type DecisionFixtureState = Readonly<{
  source: 'synthetic_fixture';
  scenario: 'saturday_activity';
  constraint_ids: readonly ConstraintId[];
  candidate_option_ids: readonly CandidateOptionId[];
  context_change_ids: readonly ContextChangeId[];
}>;

export type VersionedDecisionState = Readonly<{
  decision_id: DecisionId;
  version: number;
  participant_responses: readonly ParticipantResponse[];
  current_plan: ConfirmedPlan | null;
  fixture_state: DecisionFixtureState;
}>;
