import type {
  AffectedComponentReference,
  CandidateOption,
  CandidateOptionId,
  ConfirmedPlan,
  Constraint,
  ContextChange,
  ContextChangeId,
  ParticipantId,
  ParticipantResponse,
  ParticipantResponseState,
  PlanComponentId,
  PlanComponentReference,
  PlanId,
  PreservedComponentReference,
} from './types';
import {evaluateCandidates} from './feasibility';
import {evaluateConsensus, recordParticipantResponse} from './consensus';

export type ContextImpactClassification = Readonly<{
  context_change_id: ContextChangeId;
  reason: string;
  affected_components: readonly AffectedComponentReference[];
  preserved_components: readonly PreservedComponentReference[];
}>;

export function classifyContextImpact(
  plan: ConfirmedPlan,
  context_change: ContextChange,
): ContextImpactClassification {
  const affected_components: AffectedComponentReference[] = [];
  const preserved_components: PreservedComponentReference[] = [];

  // Classification derives from the supplied plan, not from the context
  // change's pre-declared fixture fields, so a changed component that is not
  // selected in this plan leaves the affected collection empty.
  for (const component of plan.selected_components) {
    if (component.component_id === context_change.changed_component_id) {
      affected_components.push({
        classification: 'affected',
        component_id: component.component_id,
      });
    } else {
      preserved_components.push({
        classification: 'preserved',
        component_id: component.component_id,
      });
    }
  }

  return {
    context_change_id: context_change.id,
    reason: context_change.reason,
    affected_components,
    preserved_components,
  };
}

export type ScopedReplanState = Readonly<{
  original_plan_id: PlanId;
  original_version: number;
  original_components: readonly PlanComponentReference[];
  impact: ContextImpactClassification;
  replan_required: boolean;
  preserved_components: readonly PlanComponentReference[];
  affected_components: readonly PlanComponentReference[];
  eligible_replacements: readonly CandidateOptionId[];
  participant_ids: readonly ParticipantId[];
  selected_replacements: readonly PlanComponentReference[];
  renewed_responses: readonly ParticipantResponse[];
  next_plan: ConfirmedPlan | null;
}>;

export function prepareScopedReplan(
  plan: ConfirmedPlan,
  impact: ContextImpactClassification,
  candidates: readonly CandidateOption[],
  constraints: readonly Constraint[],
  participant_ids: readonly ParticipantId[],
): ScopedReplanState {
  const affected_ids = impact.affected_components.map(
    (component) => component.component_id,
  );
  const preserved_ids = impact.preserved_components.map(
    (component) => component.component_id,
  );
  const original_components = plan.selected_components.map((component) => ({
    ...component,
  }));
  const preserved_components = original_components.filter((component) =>
    preserved_ids.includes(component.component_id),
  );
  const affected_components = original_components.filter((component) =>
    affected_ids.includes(component.component_id),
  );
  const replan_required = affected_components.length > 0;
  // Eligibility reuses the F2 deterministic feasibility core: only candidates
  // without hard-constraint rejections enter the bounded replacement set, in
  // candidate input order. The frozen fixtures do not rank feasible
  // candidates, so the concrete replacement is an explicit later selection.
  const feasibility_results = evaluateCandidates(candidates, constraints);
  const eligible_replacements = candidates
    .map((candidate, index) =>
      feasibility_results[index].feasible ? candidate.id : null,
    )
    .filter((candidate_id): candidate_id is CandidateOptionId =>
      Boolean(candidate_id),
    );

  return {
    original_plan_id: plan.plan_id,
    original_version: plan.version,
    original_components,
    impact,
    replan_required,
    preserved_components,
    affected_components,
    eligible_replacements: replan_required ? eligible_replacements : [],
    participant_ids: [...participant_ids],
    selected_replacements: [],
    renewed_responses: [],
    next_plan: null,
  };
}

export function selectAffectedReplacement(
  state: ScopedReplanState,
  component_id: PlanComponentId,
  replacement_option_id: CandidateOptionId,
): ScopedReplanState | null {
  if (!state.replan_required) {
    return null;
  }
  if (
    !state.affected_components.some(
      (component) => component.component_id === component_id,
    )
  ) {
    return null;
  }
  if (!state.eligible_replacements.includes(replacement_option_id)) {
    return null;
  }
  const existing = state.selected_replacements.find(
    (replacement) => replacement.component_id === component_id,
  );
  if (existing && existing.option_id === replacement_option_id) {
    return state;
  }
  const selected_replacements = state.affected_components
    .map((component) => {
      if (component.component_id === component_id) {
        return {component_id, option_id: replacement_option_id};
      }
      const prior = state.selected_replacements.find(
        (replacement) => replacement.component_id === component.component_id,
      );
      return prior ? {...prior} : null;
    })
    .filter((entry): entry is PlanComponentReference => entry !== null);

  // Any changed selection restarts the scoped reapproval from pending and
  // discards a not-yet-confirmed next plan.
  return {
    ...state,
    selected_replacements,
    renewed_responses: state.participant_ids.map((participant_id) => ({
      participant_id,
      response_state: 'pending',
    })),
    next_plan: null,
  };
}

export function recordScopedResponse(
  state: ScopedReplanState,
  participant_id: ParticipantId,
  response_state: ParticipantResponseState,
): ScopedReplanState | null {
  const renewed_responses = recordParticipantResponse(
    state.renewed_responses,
    participant_id,
    response_state,
  );
  if (!renewed_responses) {
    return null;
  }
  // A renewed response change invalidates a not-yet-confirmed next plan.
  return {...state, renewed_responses, next_plan: null};
}

export function finalizeScopedReplan(
  state: ScopedReplanState,
): ScopedReplanState {
  if (
    !state.replan_required ||
    evaluateConsensus(state.renewed_responses) !== 'approved'
  ) {
    return state;
  }
  const selection_by_component = new Map(
    state.selected_replacements.map(
      (replacement) =>
        [replacement.component_id, replacement.option_id] as const,
    ),
  );
  const fully_selected = state.affected_components.every((component) =>
    selection_by_component.has(component.component_id),
  );
  if (!fully_selected) {
    return state;
  }
  const selected_components = state.original_components.map((component) => {
    const replacement = selection_by_component.get(component.component_id);
    return replacement
      ? {component_id: component.component_id, option_id: replacement}
      : {...component};
  });

  // Plan versioning is domain-level: exactly one increment after unanimous
  // scoped reapproval, distinct from any persistence write versioning.
  return {
    ...state,
    next_plan: {
      plan_id: state.original_plan_id,
      version: state.original_version + 1,
      selected_components,
      confirmation_state: 'confirmed',
    },
  };
}
