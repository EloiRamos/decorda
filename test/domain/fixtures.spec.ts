import {
  initialDecisionState,
  referenceCandidateOptions,
  referenceConstraints,
  referenceParticipants,
  syntheticContextChange,
} from '../../src/domain/fixtures';

describe('Decorda F1 synthetic fixtures', () => {
  const budgetConstraint = referenceConstraints.find(
    constraint => constraint.category === 'budget',
  );
  const returnTimeConstraint = referenceConstraints.find(
    constraint => constraint.category === 'return_time',
  );

  it('contains exactly four participants', () => {
    expect(referenceParticipants).toHaveLength(4);
  });

  it('uses unique participant IDs', () => {
    const ids = referenceParticipants.map(participant => participant.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts every participant response as pending', () => {
    expect(
      initialDecisionState.participant_responses.every(
        response => response.response_state === 'pending',
      ),
    ).toBe(true);
  });

  it('sets the hard budget to 60 EUR', () => {
    expect(budgetConstraint).toMatchObject({
      kind: 'hard',
      value: {unit: 'EUR', maximum: 60},
    });
  });

  it('represents the hard return time as 18:00', () => {
    expect(returnTimeConstraint).toMatchObject({
      kind: 'hard',
      value: {
        format: 'minutes_after_midnight',
        latest: 1080,
        display: '18:00',
      },
    });
  });

  it('includes an outdoor soft preference', () => {
    expect(referenceConstraints).toContainEqual(
      expect.objectContaining({
        kind: 'soft',
        category: 'setting_preference',
        value: {preference: 'outdoor'},
      }),
    );
  });

  it('contains at least one candidate over budget', () => {
    expect(
      referenceCandidateOptions.some(option => option.cost_eur > 60),
    ).toBe(true);
  });

  it('contains at least two candidates within both hard fixture bounds', () => {
    const withinHardBounds = referenceCandidateOptions.filter(
      option => option.cost_eur <= 60 && option.return_time.value <= 1080,
    );

    expect(withinHardBounds.length).toBeGreaterThanOrEqual(2);
  });

  it('uses unique candidate IDs', () => {
    const ids = referenceCandidateOptions.map(option => option.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts at a positive integer decision version', () => {
    expect(Number.isInteger(initialDecisionState.version)).toBe(true);
    expect(initialDecisionState.version).toBeGreaterThan(0);
  });

  it('starts without a confirmed plan', () => {
    expect(initialDecisionState.current_plan).toBeNull();
  });

  it('labels the context change as synthetic and deterministic', () => {
    expect(syntheticContextChange).toMatchObject({
      source: 'synthetic_fixture',
      deterministic: true,
      later_classification_value: 'outdoor_activity_disrupted',
    });
  });

  it('contains no prohibited contribution or weather-claim fields', () => {
    const fieldNames = JSON.stringify({
      referenceParticipants,
      referenceConstraints,
      referenceCandidateOptions,
      syntheticContextChange,
      initialDecisionState,
    })
      .match(/"([^"]+)":/g)
      ?.map(field => field.toLowerCase())
      .join(' ');

    expect(fieldNames).not.toMatch(
      /qr|phone|second.?screen|live.?weather/,
    );
  });
});
