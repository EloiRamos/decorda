import type {
  ApplyDecisionMutationInput,
  ApplyDecisionMutationResult,
  CanonicalDecisionState,
  DecisionSnapshot,
  DecisionStore,
  OperationId,
  PersistenceFailure,
} from './decisionStore';
import type {
  CandidateOption,
  CandidateOptionId,
  ConfirmedPlan,
  Constraint,
  ContextChange,
  DecisionId,
  ParticipantId,
  ParticipantResponseState,
  PlanComponentId,
} from '../domain/types';
import type {ScopedReplanState} from '../domain/replanning';
import {
  classifyContextImpact,
  finalizeScopedReplan,
  prepareScopedReplan,
  recordScopedResponse,
  selectAffectedReplacement,
} from '../domain/replanning';

export type DurableScopedReplanInputs = Readonly<{
  context_change: ContextChange;
  candidates: readonly CandidateOption[];
  constraints: readonly Constraint[];
  participant_ids: readonly ParticipantId[];
}>;

// Transient application flow state. It carries only what the flow needs:
// the decision identity, the captured persistence base version, the canonical
// source snapshot, and the delegated domain replan state. Progress here is
// never persisted; leaving or restarting discards it.
export type DurableScopedReplanFlow = Readonly<{
  decision_id: DecisionId;
  base_version: number;
  canonical_state: CanonicalDecisionState;
  replan: ScopedReplanState;
}>;

export type BeginDurableScopedReplanOutcome =
  | Readonly<{kind: 'REPLAN_REQUIRED'; flow: DurableScopedReplanFlow}>
  | Readonly<{
      kind: 'NO_REPLAN_REQUIRED';
      decision_id: DecisionId;
      canonical_state: CanonicalDecisionState;
      replan: ScopedReplanState;
    }>
  | Readonly<{kind: 'DECISION_NOT_FOUND'; decision_id: DecisionId}>
  | Readonly<{kind: 'NO_CONFIRMED_PLAN'; decision_id: DecisionId}>
  | Readonly<{kind: 'LOAD_FAILED'; failure: PersistenceFailure}>;

export type SelectDurableScopedReplacementOutcome =
  | Readonly<{kind: 'REPLACEMENT_SELECTED'; flow: DurableScopedReplanFlow}>
  | Readonly<{kind: 'SELECTION_REJECTED'; flow: DurableScopedReplanFlow}>;

export type RecordDurableScopedResponseOutcome =
  | Readonly<{kind: 'RESPONSE_RECORDED'; flow: DurableScopedReplanFlow}>
  | Readonly<{kind: 'RESPONSE_REJECTED'; flow: DurableScopedReplanFlow}>;

export type FinalizeDurableScopedReplanOutcome =
  | Readonly<{
      kind: 'APPLIED';
      operation_id: OperationId;
      committed_version: number;
      canonical_state: CanonicalDecisionState;
      next_plan: ConfirmedPlan;
    }>
  | Readonly<{kind: 'REPLAN_NOT_READY'; replan: ScopedReplanState}>
  | Readonly<{kind: 'SNAPSHOT_MAPPING_AMBIGUOUS'; replan: ScopedReplanState}>
  | Readonly<{
      kind: 'MUTATION_NOT_APPLIED';
      result: ApplyDecisionMutationResult;
    }>;

// Loads the canonical decision exactly once and prepares the transient flow.
// The captured base_version is the store's CAS version at load time and is
// the only version this flow ever writes against.
export async function beginDurableScopedReplan(
  store: DecisionStore,
  decision_id: DecisionId,
  inputs: DurableScopedReplanInputs,
): Promise<BeginDurableScopedReplanOutcome> {
  const load = await store.loadDecision(decision_id);
  if (load.kind === 'NOT_FOUND') {
    return {kind: 'DECISION_NOT_FOUND', decision_id: load.decision_id};
  }
  if (load.kind === 'LIMIT_EXCEEDED' || load.kind === 'INFRASTRUCTURE_ERROR') {
    return {kind: 'LOAD_FAILED', failure: load};
  }
  const canonical_state = load.canonical_state;
  const confirmed_plan = canonical_state.confirmed_plan;
  if (!confirmed_plan) {
    return {kind: 'NO_CONFIRMED_PLAN', decision_id};
  }
  const base_version = canonical_state.version;
  const impact = classifyContextImpact(confirmed_plan, inputs.context_change);
  const replan = prepareScopedReplan(
    confirmed_plan,
    impact,
    inputs.candidates,
    inputs.constraints,
    inputs.participant_ids,
  );
  if (!replan.replan_required) {
    return {kind: 'NO_REPLAN_REQUIRED', decision_id, canonical_state, replan};
  }
  return {
    kind: 'REPLAN_REQUIRED',
    flow: {decision_id, base_version, canonical_state, replan},
  };
}

// Delegates eligibility and reset semantics to the domain; nothing here
// touches the store, so selection is always write-free.
export function selectDurableScopedReplacement(
  flow: DurableScopedReplanFlow,
  component_id: PlanComponentId,
  replacement_option_id: CandidateOptionId,
): SelectDurableScopedReplacementOutcome {
  const replan = selectAffectedReplacement(
    flow.replan,
    component_id,
    replacement_option_id,
  );
  if (!replan) {
    return {kind: 'SELECTION_REJECTED', flow};
  }
  return {kind: 'REPLACEMENT_SELECTED', flow: {...flow, replan}};
}

// Delegates scoped response semantics to the domain; pending, rejected, and
// unknown-participant outcomes never reach the store.
export function recordDurableScopedResponse(
  flow: DurableScopedReplanFlow,
  participant_id: ParticipantId,
  response_state: ParticipantResponseState,
): RecordDurableScopedResponseOutcome {
  const replan = recordScopedResponse(
    flow.replan,
    participant_id,
    response_state,
  );
  if (!replan) {
    return {kind: 'RESPONSE_REJECTED', flow};
  }
  return {kind: 'RESPONSE_RECORDED', flow: {...flow, replan}};
}

// One context change affects a single component id, so every confirmed
// replacement selection carries one option id; anything else fails closed
// instead of inventing a mapping onto the snapshot's single selected id.
function soleSelectedReplacementOptionId(
  replan: ScopedReplanState,
): CandidateOptionId | null {
  const selections = replan.selected_replacements;
  if (selections.length === 0) {
    return null;
  }
  const option_id = selections[0].option_id;
  return selections.every(
    (selection) => selection.option_id === option_id,
  )
    ? option_id
    : null;
}

// Finalizes through the domain and performs the flow's single durable
// mutation: one CONFIRM_PLAN over the captured base version. Store outcomes
// are surfaced exactly as returned, with no retry and no second mutation.
export async function finalizeAndPersistDurableScopedReplan(
  store: DecisionStore,
  flow: DurableScopedReplanFlow,
  operation_id: OperationId,
): Promise<FinalizeDurableScopedReplanOutcome> {
  const replan = finalizeScopedReplan(flow.replan);
  const next_plan = replan.next_plan;
  if (!next_plan) {
    return {kind: 'REPLAN_NOT_READY', replan};
  }
  const replacement_option_id = soleSelectedReplacementOptionId(replan);
  if (!replacement_option_id) {
    return {kind: 'SNAPSHOT_MAPPING_AMBIGUOUS', replan};
  }
  const next_state: DecisionSnapshot = {
    selected_candidate_id: replacement_option_id,
    participant_responses: replan.renewed_responses,
    confirmed_plan: next_plan,
    fixture_state: flow.canonical_state.fixture_state,
  };
  const input: ApplyDecisionMutationInput = {
    decision_id: flow.decision_id,
    operation_id,
    base_version: flow.base_version,
    mutation: {kind: 'CONFIRM_PLAN', plan_id: next_plan.plan_id},
    next_state,
  };
  const result = await store.applyMutation(input);
  if (result.kind === 'APPLIED') {
    return {
      kind: 'APPLIED',
      operation_id: result.operation_id,
      committed_version: result.committed_version,
      canonical_state: result.canonical_state,
      next_plan,
    };
  }
  return {kind: 'MUTATION_NOT_APPLIED', result};
}
