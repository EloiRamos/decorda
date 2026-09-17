import {confirmDecision, createInitialDecisionState, selectCandidate, setParticipantResponse} from '../../src/application/decisionState';
import {referenceCandidateOptions, referenceParticipants} from '../../src/domain/fixtures';

describe('decisionState explicit commitment', () => {
  it('starts with four pending participants and no commitment', () => {
    const state = createInitialDecisionState();
    expect(state.selected_candidate).toBeNull();
    expect(state.consensus_status).toBe('pending');
    expect(state.participant_responses).toHaveLength(4);
    expect(state.confirmed_plan).toBeNull();
  });

  it('selects a candidate and preserves same-selection responses', () => {
    const selected = selectCandidate(createInitialDecisionState(), referenceCandidateOptions[0]);
    const responded = setParticipantResponse(selected, referenceParticipants[0].id, 'approved');
    expect(selectCandidate(responded, referenceCandidateOptions[0])).toBe(responded);
    const changed = selectCandidate(responded, referenceCandidateOptions[1]);
    expect(changed.participant_responses.every(response => response.response_state === 'pending')).toBe(true);
  });

  it('does not confirm after four approvals until explicit confirmation', () => {
    let state = selectCandidate(createInitialDecisionState(), referenceCandidateOptions[0]);
    for (const participant of referenceParticipants) {
      state = setParticipantResponse(state, participant.id, 'approved');
    }
    expect(state.consensus_status).toBe('approved');
    expect(state.confirmed_plan).toBeNull();
    const confirmed = confirmDecision(state);
    expect(confirmed.confirmed_plan?.version).toBe(1);
    expect(confirmed.confirmed_plan?.selected_components).toEqual([
      {component_id: 'component-activity', option_id: 'option-riverside-picnic'},
      {component_id: 'component-return-arrangement', option_id: 'option-riverside-picnic'},
    ]);
  });

  it('rejects confirmation with pending or rejected responses', () => {
    const selected = selectCandidate(createInitialDecisionState(), referenceCandidateOptions[0]);
    expect(confirmDecision(selected)).toBe(selected);
    const rejected = setParticipantResponse(selected, referenceParticipants[0].id, 'rejected');
    expect(confirmDecision(rejected)).toBe(rejected);
  });

  it('ignores unknown participants and preserves fixtures', () => {
    const selected = selectCandidate(createInitialDecisionState(), referenceCandidateOptions[0]);
    expect(setParticipantResponse(selected, 'participant-unknown', 'approved')).toBe(selected);
    expect(referenceParticipants.every(participant => participant.response_state === 'pending')).toBe(true);
  });
});
