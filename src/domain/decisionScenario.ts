import {confirmPlan} from './consensus';
import {
  initialDecisionState,
  referenceCandidateOptions,
  referenceConstraints,
  referenceParticipants,
  syntheticContextChange,
} from './fixtures';
import {evaluateCandidates} from './feasibility';
import type {
  CandidateOption,
  CandidateOptionId,
  ConfirmedPlan,
  ParticipantResponse,
  PlanComponentId,
} from './types';

export const REFERENCE_DECISION_ID = initialDecisionState.decision_id;
export const REFERENCE_PLAN_ID: ConfirmedPlan['plan_id'] =
  'plan-saturday-activity';
export const ACTIVITY_COMPONENT_ID =
  syntheticContextChange.changed_component_id;
export const RETURN_ARRANGEMENT_COMPONENT_ID =
  syntheticContextChange.preserved_components[0].component_id;

export function referencePendingResponses(): readonly ParticipantResponse[] {
  return referenceParticipants.map(participant => ({
    participant_id: participant.id,
    response_state: 'pending',
  }));
}

export function findReferenceCandidate(
  candidate_id: CandidateOptionId,
): CandidateOption | null {
  return (
    referenceCandidateOptions.find(candidate => candidate.id === candidate_id) ??
    null
  );
}

export function isReferenceCandidateFeasible(
  candidate_id: CandidateOptionId,
): boolean {
  const index = referenceCandidateOptions.findIndex(
    candidate => candidate.id === candidate_id,
  );
  return (
    index >= 0 &&
    evaluateCandidates(referenceCandidateOptions, referenceConstraints)[index]
      .feasible
  );
}

export function createReferenceConfirmedPlan(
  candidate_id: CandidateOptionId,
  responses: readonly ParticipantResponse[],
): ConfirmedPlan | null {
  return confirmPlan(responses, {
    plan_id: REFERENCE_PLAN_ID,
    version: 1,
    selected_components: [
      {component_id: ACTIVITY_COMPONENT_ID, option_id: candidate_id},
      {
        component_id: RETURN_ARRANGEMENT_COMPONENT_ID,
        option_id: candidate_id,
      },
    ],
  });
}

export function referenceComponentLabel(
  component_id: PlanComponentId,
): string {
  if (component_id === ACTIVITY_COMPONENT_ID) {
    return 'Saturday activity';
  }
  if (component_id === RETURN_ARRANGEMENT_COMPONENT_ID) {
    return 'Return-by-18:00 arrangement';
  }
  return 'Unknown component';
}
