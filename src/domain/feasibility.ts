import type {
  CandidateOption,
  Constraint,
  FeasibilityResult,
  RejectionReason,
  SoftTradeoffNote,
} from './types';

export function evaluateCandidate(
  candidate: CandidateOption,
  constraints: readonly Constraint[],
): FeasibilityResult {
  const rejection_reasons: RejectionReason[] = [];

  for (const constraint of constraints) {
    if (constraint.kind !== 'hard') {
      continue;
    }
    if (
      constraint.category === 'budget' &&
      candidate.cost_eur > constraint.value.maximum
    ) {
      rejection_reasons.push({
        code: 'over_budget',
        constraint_id: constraint.id,
        message: `Costs ${candidate.cost_eur} EUR, above the ${constraint.value.maximum} EUR limit.`,
      });
    } else if (
      constraint.category === 'return_time' &&
      candidate.return_time.value > constraint.value.latest
    ) {
      rejection_reasons.push({
        code: 'returns_too_late',
        constraint_id: constraint.id,
        message: `Returns at ${candidate.return_time.display}, after the ${constraint.value.display} return time.`,
      });
    }
  }

  const soft_tradeoff_notes: SoftTradeoffNote[] = [];
  if (rejection_reasons.length === 0) {
    for (const constraint of constraints) {
      if (constraint.kind !== 'soft') {
        continue;
      }
      soft_tradeoff_notes.push(
        candidate.setting === constraint.value.preference
          ? {
              code: 'matches_outdoor_preference',
              constraint_id: constraint.id,
              note: 'Matches the outdoor preference.',
            }
          : {
              code: 'does_not_match_outdoor_preference',
              constraint_id: constraint.id,
              note: 'Does not match the outdoor preference.',
            },
      );
    }
  }

  return {
    feasible: rejection_reasons.length === 0,
    rejection_reasons,
    soft_tradeoff_notes,
  };
}

export function evaluateCandidates(
  candidates: readonly CandidateOption[],
  constraints: readonly Constraint[],
): readonly FeasibilityResult[] {
  return candidates.map((candidate) =>
    evaluateCandidate(candidate, constraints),
  );
}
