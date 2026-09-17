import type {CandidateOption} from '../../src/domain/types';
import {
  evaluateCandidate,
  evaluateCandidates,
} from '../../src/domain/feasibility';
import {
  referenceCandidateOptions,
  referenceConstraints,
} from '../../src/domain/fixtures';

const budgetConstraint = referenceConstraints.filter(
  (constraint) =>
    constraint.kind === 'hard' && constraint.category === 'budget',
);
const returnTimeConstraint = referenceConstraints.filter(
  (constraint) =>
    constraint.kind === 'hard' && constraint.category === 'return_time',
);
const outdoorPreference = referenceConstraints.filter(
  (constraint) => constraint.kind === 'soft',
);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const bothViolationsCandidate: CandidateOption = {
  id: 'option-both-violations',
  title: 'Late Expensive Gathering',
  cost_eur: 72,
  return_time: {
    format: 'minutes_after_midnight',
    value: 18 * 60 + 30,
    display: '18:30',
  },
  setting: 'indoor',
  description: 'Synthetic candidate that violates both hard constraints.',
};

describe('Decorda F2 deterministic feasibility core', () => {
  it('rejects an over-budget candidate as infeasible', () => {
    const forestCourse = referenceCandidateOptions[2];

    const result = evaluateCandidate(forestCourse, referenceConstraints);

    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons.map((reason) => reason.code)).toEqual([
      'over_budget',
    ]);
    expect(
      result.rejection_reasons.every((reason) => reason.message.length > 0),
    ).toBe(true);
    expect(result.soft_tradeoff_notes).toEqual([]);
  });

  it('rejects a late-return candidate as infeasible', () => {
    const communityGarden = referenceCandidateOptions[3];

    const result = evaluateCandidate(communityGarden, referenceConstraints);

    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons.map((reason) => reason.code)).toEqual([
      'returns_too_late',
    ]);
    expect(
      result.rejection_reasons.every((reason) => reason.message.length > 0),
    ).toBe(true);
  });

  it('returns both rejection reasons in deterministic order when both hard constraints are violated', () => {
    const result = evaluateCandidate(
      bothViolationsCandidate,
      referenceConstraints,
    );

    expect(result.feasible).toBe(false);
    expect(
      result.rejection_reasons.map((reason) => [
        reason.code,
        reason.constraint_id,
      ]),
    ).toEqual([
      ['over_budget', 'constraint-budget'],
      ['returns_too_late', 'constraint-return-time'],
    ]);
  });

  it('accepts a candidate that satisfies both hard constraints', () => {
    const riversidePicnic = referenceCandidateOptions[0];

    const result = evaluateCandidate(riversidePicnic, referenceConstraints);

    expect(result.feasible).toBe(true);
    expect(result.rejection_reasons).toEqual([]);
  });

  it('does not let the outdoor preference reject an otherwise-feasible indoor candidate', () => {
    const museumWorkshop = referenceCandidateOptions[1];

    const result = evaluateCandidate(museumWorkshop, referenceConstraints);

    expect(result.feasible).toBe(true);
    expect(result.rejection_reasons).toEqual([]);

    const softOnlyResult = evaluateCandidate(museumWorkshop, outdoorPreference);

    expect(softOnlyResult.feasible).toBe(true);
    expect(softOnlyResult.rejection_reasons).toEqual([]);
  });

  it('gives a feasible indoor candidate a soft-preference tradeoff note', () => {
    const museumWorkshop = referenceCandidateOptions[1];

    const result = evaluateCandidate(museumWorkshop, referenceConstraints);

    expect(result.soft_tradeoff_notes).toEqual([
      {
        code: 'does_not_match_outdoor_preference',
        constraint_id: 'constraint-outdoor-preference',
        note: 'Does not match the outdoor preference.',
      },
    ]);
  });

  it('gives a feasible outdoor candidate no outdoor-preference penalty', () => {
    const riversidePicnic = referenceCandidateOptions[0];

    const result = evaluateCandidate(riversidePicnic, referenceConstraints);

    expect(
      result.soft_tradeoff_notes.some(
        (note) => note.code === 'does_not_match_outdoor_preference',
      ),
    ).toBe(false);
    expect(result.soft_tradeoff_notes).toEqual([
      {
        code: 'matches_outdoor_preference',
        constraint_id: 'constraint-outdoor-preference',
        note: 'Matches the outdoor preference.',
      },
    ]);
  });

  it('keeps rejection-reason ordering deterministic across repeated evaluation', () => {
    const first = evaluateCandidate(
      bothViolationsCandidate,
      referenceConstraints,
    );
    const second = evaluateCandidate(
      bothViolationsCandidate,
      referenceConstraints,
    );

    expect(first).toEqual(second);
    expect(first.rejection_reasons.map((reason) => reason.code)).toEqual([
      'over_budget',
      'returns_too_late',
    ]);
  });

  it('produces identical results across repeated calls', () => {
    for (const candidate of referenceCandidateOptions) {
      const first = evaluateCandidate(candidate, referenceConstraints);
      const second = evaluateCandidate(candidate, referenceConstraints);

      expect(first).toEqual(second);
    }

    expect(
      evaluateCandidates(referenceCandidateOptions, referenceConstraints),
    ).toEqual(
      evaluateCandidates(referenceCandidateOptions, referenceConstraints),
    );
  });

  it('does not mutate the candidate or constraint inputs', () => {
    const candidate = referenceCandidateOptions[1];
    const candidateSnapshot = clone(candidate);
    const constraintsSnapshot = clone(referenceConstraints);

    evaluateCandidate(candidate, referenceConstraints);
    evaluateCandidates([candidate], referenceConstraints);

    expect(candidate).toEqual(candidateSnapshot);
    expect(referenceConstraints).toEqual(constraintsSnapshot);
  });

  it('preserves input candidate order when evaluating multiple candidates', () => {
    const reordered = [
      referenceCandidateOptions[3],
      referenceCandidateOptions[1],
      referenceCandidateOptions[0],
      referenceCandidateOptions[2],
    ];

    const results = evaluateCandidates(reordered, referenceConstraints);

    expect(results.map((result) => result.feasible)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(results).toEqual(
      reordered.map((candidate) =>
        evaluateCandidate(candidate, referenceConstraints),
      ),
    );
  });

  it('rejects the frozen known over-budget fixture by its budget constraint', () => {
    const forestCourse = referenceCandidateOptions[2];

    const result = evaluateCandidate(forestCourse, budgetConstraint);

    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toEqual([
      {
        code: 'over_budget',
        constraint_id: 'constraint-budget',
        message: 'Costs 72 EUR, above the 60 EUR limit.',
      },
    ]);
  });

  it('finds at least two frozen reference candidates feasible', () => {
    const feasibleCandidates = referenceCandidateOptions.filter(
      (candidate) =>
        evaluateCandidate(candidate, referenceConstraints).feasible,
    );

    expect(feasibleCandidates.map((candidate) => candidate.id)).toEqual([
      'option-riverside-picnic',
      'option-museum-workshop',
    ]);
  });

  it('evaluates candidates against individual hard constraints as expected', () => {
    const riversidePicnic = referenceCandidateOptions[0];

    expect(evaluateCandidate(riversidePicnic, budgetConstraint).feasible).toBe(
      true,
    );
    expect(
      evaluateCandidate(riversidePicnic, returnTimeConstraint).feasible,
    ).toBe(true);
    expect(
      evaluateCandidate(bothViolationsCandidate, budgetConstraint)
        .rejection_reasons,
    ).toEqual([
      {
        code: 'over_budget',
        constraint_id: 'constraint-budget',
        message: 'Costs 72 EUR, above the 60 EUR limit.',
      },
    ]);
    expect(
      evaluateCandidate(bothViolationsCandidate, returnTimeConstraint)
        .rejection_reasons,
    ).toEqual([
      {
        code: 'returns_too_late',
        constraint_id: 'constraint-return-time',
        message: 'Returns at 18:30, after the 18:00 return time.',
      },
    ]);
  });
});
