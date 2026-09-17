import type {
  CandidateOption,
  ConfirmedPlan,
  ParticipantId,
  ParticipantResponse,
  ParticipantResponseState,
} from '../domain/types';
import type {ConsensusStatus} from '../domain/consensus';
import {evaluateConsensus, recordParticipantResponse} from '../domain/consensus';
import {initialDecisionState} from '../domain/fixtures';
import {createReferenceConfirmedPlan} from '../domain/decisionScenario';

export type DecisionState = Readonly<{
  selected_candidate: CandidateOption | null;
  participant_responses: readonly ParticipantResponse[];
  consensus_status: ConsensusStatus;
  confirmed_plan: ConfirmedPlan | null;
}>;

function pendingParticipantResponses(): readonly ParticipantResponse[] {
  return initialDecisionState.participant_responses.map(response => ({
    ...response,
  }));
}

export function createInitialDecisionState(): DecisionState {
  const participant_responses = pendingParticipantResponses();
  return {
    selected_candidate: null,
    participant_responses,
    consensus_status: evaluateConsensus(participant_responses),
    confirmed_plan: null,
  };
}

export function selectCandidate(
  state: DecisionState,
  candidate: CandidateOption,
): DecisionState {
  // Re-selecting the active candidate is a no-op so an accidental repeated
  // D-pad press cannot wipe already-recorded responses.
  if (state.selected_candidate?.id === candidate.id) {
    return state;
  }
  const participant_responses = pendingParticipantResponses();
  return {
    selected_candidate: candidate,
    participant_responses,
    consensus_status: evaluateConsensus(participant_responses),
    confirmed_plan: null,
  };
}

export function setParticipantResponse(
  state: DecisionState,
  participant_id: ParticipantId,
  response_state: ParticipantResponseState,
): DecisionState {
  const participant_responses = recordParticipantResponse(
    state.participant_responses,
    participant_id,
    response_state,
  );
  if (!participant_responses) {
    return state;
  }
  const consensus_status = evaluateConsensus(participant_responses);
  return {
    selected_candidate: state.selected_candidate,
    participant_responses,
    consensus_status,
    // Unanimity means ready to confirm. Commitment is a separate operation.
    confirmed_plan: state.confirmed_plan,
  };
}

export function confirmDecision(state: DecisionState): DecisionState {
  if (
    state.selected_candidate === null ||
    state.confirmed_plan !== null ||
    state.consensus_status !== 'approved'
  ) {
    return state;
  }
  const confirmed_plan = createReferenceConfirmedPlan(
    state.selected_candidate.id,
    state.participant_responses,
  );
  return confirmed_plan === null ? state : {...state, confirmed_plan};
}
