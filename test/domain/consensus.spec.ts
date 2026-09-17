import type {
  ParticipantId,
  ParticipantResponse,
  ParticipantResponseState,
} from '../../src/domain/types';
import {
  confirmPlan,
  evaluateConsensus,
  recordParticipantResponse,
} from '../../src/domain/consensus';
import {initialDecisionState} from '../../src/domain/fixtures';

const participantIds = [
  'participant-alex',
  'participant-blair',
  'participant-casey',
  'participant-devon',
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withResponses(
  updates: ReadonlyArray<readonly [ParticipantId, ParticipantResponseState]>,
): readonly ParticipantResponse[] {
  let current: readonly ParticipantResponse[] =
    initialDecisionState.participant_responses;
  for (const [participant_id, response_state] of updates) {
    const next = recordParticipantResponse(
      current,
      participant_id,
      response_state,
    );
    if (!next) {
      throw new Error(
        `Test setup used an unknown participant: ${participant_id}`,
      );
    }
    current = next;
  }
  return current;
}

const allApproved = (): readonly ParticipantResponse[] =>
  participantIds.map((participant_id) => ({
    participant_id,
    response_state: 'approved',
  }));

const planDraft = {
  plan_id: 'plan-saturday-activity',
  version: 1,
  selected_components: [
    {
      component_id: 'component-activity',
      option_id: 'option-riverside-picnic',
    },
  ],
} as const;

describe('Decorda F3 participant response and consensus state', () => {
  it('evaluates the initial F1 participant responses as pending', () => {
    expect(
      initialDecisionState.participant_responses.every(
        (response) => response.response_state === 'pending',
      ),
    ).toBe(true);
    expect(evaluateConsensus(initialDecisionState.participant_responses)).toBe(
      'pending',
    );
  });

  it('recording one approval changes only the targeted participant', () => {
    const next = recordParticipantResponse(
      initialDecisionState.participant_responses,
      'participant-blair',
      'approved',
    );

    expect(next).toEqual([
      {
        participant_id: 'participant-alex',
        response_state: 'pending',
      },
      {
        participant_id: 'participant-blair',
        response_state: 'approved',
      },
      {
        participant_id: 'participant-casey',
        response_state: 'pending',
      },
      {
        participant_id: 'participant-devon',
        response_state: 'pending',
      },
    ]);
  });

  it('recording a response preserves deterministic participant ordering', () => {
    const next = recordParticipantResponse(
      initialDecisionState.participant_responses,
      'participant-casey',
      'rejected',
    );

    expect(next?.map((response) => response.participant_id)).toEqual([
      'participant-alex',
      'participant-blair',
      'participant-casey',
      'participant-devon',
    ]);
  });

  it('recording a response does not mutate the input collection', () => {
    const snapshot = clone(initialDecisionState.participant_responses);

    recordParticipantResponse(
      initialDecisionState.participant_responses,
      'participant-alex',
      'approved',
    );

    expect(initialDecisionState.participant_responses).toEqual(snapshot);
  });

  it('fails explicitly for an unknown participant and adds no participant', () => {
    const snapshot = clone(initialDecisionState.participant_responses);

    const result = recordParticipantResponse(
      initialDecisionState.participant_responses,
      'participant-nobody',
      'approved',
    );

    expect(result).toBeNull();
    expect(initialDecisionState.participant_responses).toEqual(snapshot);
    expect(initialDecisionState.participant_responses).toHaveLength(4);
  });

  it('produces consensus rejected when one participant rejects', () => {
    const responses = withResponses([['participant-blair', 'rejected']]);

    expect(evaluateConsensus(responses)).toBe('rejected');
  });

  it('produces consensus rejected when a rejection coexists with pending responses', () => {
    const responses = withResponses([['participant-devon', 'rejected']]);

    expect(evaluateConsensus(responses)).toBe('rejected');
    expect(
      responses.some((response) => response.response_state === 'pending'),
    ).toBe(true);
  });

  it('produces consensus approved when every participant approves', () => {
    expect(evaluateConsensus(allApproved())).toBe('approved');
  });

  it('remains pending with three approvals and one pending response', () => {
    const responses = withResponses([
      ['participant-alex', 'approved'],
      ['participant-blair', 'approved'],
      ['participant-casey', 'approved'],
    ]);

    expect(evaluateConsensus(responses)).toBe('pending');
  });

  it('is rejected with three approvals and one rejection', () => {
    const responses = withResponses([
      ['participant-alex', 'approved'],
      ['participant-blair', 'approved'],
      ['participant-casey', 'approved'],
      ['participant-devon', 'rejected'],
    ]);

    expect(evaluateConsensus(responses)).toBe('rejected');
  });

  it('never approves an empty participant collection', () => {
    expect(evaluateConsensus([])).toBe('pending');
    expect(confirmPlan([], planDraft)).toBeNull();
  });

  it('denies confirmation while any participant is pending', () => {
    const responses = withResponses([
      ['participant-alex', 'approved'],
      ['participant-blair', 'approved'],
      ['participant-casey', 'approved'],
    ]);

    expect(confirmPlan(responses, planDraft)).toBeNull();
  });

  it('denies confirmation while any participant is rejected', () => {
    const responses = withResponses([
      ['participant-alex', 'approved'],
      ['participant-blair', 'approved'],
      ['participant-casey', 'approved'],
      ['participant-devon', 'rejected'],
    ]);

    expect(confirmPlan(responses, planDraft)).toBeNull();
  });

  it('confirms the plan only under unanimous approval', () => {
    const result = confirmPlan(allApproved(), planDraft);

    expect(result).toEqual({
      plan_id: 'plan-saturday-activity',
      version: 1,
      selected_components: [
        {
          component_id: 'component-activity',
          option_id: 'option-riverside-picnic',
        },
      ],
      confirmation_state: 'confirmed',
    });
    expect(result).not.toBe(planDraft);
  });

  it('does not mutate the plan passed to confirmation', () => {
    const snapshot = clone(planDraft);

    confirmPlan(allApproved(), planDraft);
    confirmPlan(initialDecisionState.participant_responses, planDraft);

    expect(planDraft).toEqual(snapshot);
  });

  it('is deterministic across repeated identical evaluations', () => {
    const responses = withResponses([
      ['participant-alex', 'approved'],
      ['participant-devon', 'rejected'],
    ]);

    expect(evaluateConsensus(responses)).toBe(evaluateConsensus(responses));
    expect(
      recordParticipantResponse(responses, 'participant-blair', 'approved'),
    ).toEqual(
      recordParticipantResponse(responses, 'participant-blair', 'approved'),
    );
    expect(confirmPlan(responses, planDraft)).toEqual(
      confirmPlan(responses, planDraft),
    );
    expect(confirmPlan(allApproved(), planDraft)).toEqual(
      confirmPlan(allApproved(), planDraft),
    );
  });

  it('leaves the F1 initial fixture unchanged after F3 operations', () => {
    const snapshot = clone(initialDecisionState);

    recordParticipantResponse(
      initialDecisionState.participant_responses,
      'participant-alex',
      'approved',
    );
    evaluateConsensus(initialDecisionState.participant_responses);
    confirmPlan(initialDecisionState.participant_responses, planDraft);

    expect(initialDecisionState).toEqual(snapshot);
  });
});
