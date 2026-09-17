import {createReferenceConfirmedPlan, isReferenceCandidateFeasible, referenceComponentLabel, referencePendingResponses} from '../../src/domain/decisionScenario';

describe('reference decision scenario', () => {
  it('labels affected and preserved scope with fixture meaning', () => {
    expect(referenceComponentLabel('component-activity')).toBe('Saturday activity');
    expect(referenceComponentLabel('component-return-arrangement')).toBe('Return-by-18:00 arrangement');
  });

  it('keeps the bounded feasibility result', () => {
    expect(isReferenceCandidateFeasible('option-riverside-picnic')).toBe(true);
    expect(isReferenceCandidateFeasible('option-forest-course')).toBe(false);
  });

  it.each([
    ['option-riverside-picnic', true],
    ['option-museum-workshop', true],
    ['option-forest-course', false],
    ['option-community-garden', false],
  ] as const)('reports the frozen feasibility for %s', (candidate, expected) => {
    expect(isReferenceCandidateFeasible(candidate)).toBe(expected);
  });

  it('builds a two-component plan only for unanimous approval', () => {
    const pending = referencePendingResponses();
    expect(createReferenceConfirmedPlan('option-riverside-picnic', pending)).toBeNull();
    const approved = pending.map(response => ({...response, response_state: 'approved' as const}));
    expect(createReferenceConfirmedPlan('option-riverside-picnic', approved)?.selected_components).toHaveLength(2);
  });
});
