import type {
  ConfirmedPlan,
  ParticipantId,
  ParticipantResponse,
  ParticipantResponseState,
} from './types';

export type ConsensusStatus = 'pending' | 'rejected' | 'approved';

export function recordParticipantResponse(
  participant_responses: readonly ParticipantResponse[],
  participant_id: ParticipantId,
  response_state: ParticipantResponseState,
): readonly ParticipantResponse[] | null {
  const target_index = participant_responses.findIndex(
    (response) => response.participant_id === participant_id,
  );
  if (target_index === -1) {
    return null;
  }
  return participant_responses.map((response, index) =>
    index === target_index
      ? {participant_id: response.participant_id, response_state}
      : response,
  );
}

export function evaluateConsensus(
  participant_responses: readonly ParticipantResponse[],
): ConsensusStatus {
  if (participant_responses.length === 0) {
    return 'pending';
  }
  if (
    participant_responses.some(
      (response) => response.response_state === 'rejected',
    )
  ) {
    return 'rejected';
  }
  return participant_responses.every(
    (response) => response.response_state === 'approved',
  )
    ? 'approved'
    : 'pending';
}

export function confirmPlan(
  participant_responses: readonly ParticipantResponse[],
  plan: Readonly<Omit<ConfirmedPlan, 'confirmation_state'>>,
): ConfirmedPlan | null {
  if (evaluateConsensus(participant_responses) !== 'approved') {
    return null;
  }
  return {...plan, confirmation_state: 'confirmed'};
}
