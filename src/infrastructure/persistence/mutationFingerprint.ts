import type {
  DecisionMutationIntent,
  DecisionSnapshot,
} from '../../application/decisionStore';
import {sha256HexUtf8} from './sha256';

export type MutationFingerprintInput = Readonly<{
  base_version: number;
  mutation: DecisionMutationIntent;
  next_state: DecisionSnapshot;
}>;

// Fixed-field serialization frozen by PERSISTENCE-001: explicit labels and
// array counts in a fixed order, explicit nulls, stable participant order,
// and no generic property iteration. Any contract-relevant difference changes
// the serialized bytes and therefore the digest.
function serializeMutationRequest(input: MutationFingerprintInput): string {
  const lines: string[] = [];

  lines.push(`base_version=${input.base_version}`);

  const mutation: DecisionMutationIntent = input.mutation;
  lines.push(`mutation.kind=${mutation.kind}`);
  switch (mutation.kind) {
    case 'SELECT_CANDIDATE':
      lines.push(`mutation.candidate_id=${mutation.candidate_id}`);
      break;
    case 'SET_PARTICIPANT_RESPONSE':
      lines.push(`mutation.participant_id=${mutation.participant_id}`);
      lines.push(`mutation.response_state=${mutation.response_state}`);
      break;
    case 'CONFIRM_PLAN':
      lines.push(`mutation.plan_id=${mutation.plan_id}`);
      break;
  }

  const next_state: DecisionSnapshot = input.next_state;
  lines.push(
    `next_state.selected_candidate_id=${next_state.selected_candidate_id ?? 'null'}`,
  );
  lines.push(
    `next_state.participant_responses=${next_state.participant_responses.length}`,
  );
  next_state.participant_responses.forEach((response, index) => {
    lines.push(
      `next_state.participant_responses[${index}].participant_id=${response.participant_id}`,
    );
    lines.push(
      `next_state.participant_responses[${index}].response_state=${response.response_state}`,
    );
  });

  const plan = next_state.confirmed_plan;
  if (plan === null) {
    lines.push('next_state.confirmed_plan=null');
  } else {
    lines.push(`next_state.confirmed_plan.plan_id=${plan.plan_id}`);
    lines.push(`next_state.confirmed_plan.version=${plan.version}`);
    lines.push(
      `next_state.confirmed_plan.confirmation_state=${plan.confirmation_state}`,
    );
    lines.push(
      `next_state.confirmed_plan.selected_components=${plan.selected_components.length}`,
    );
    plan.selected_components.forEach((component, index) => {
      lines.push(
        `next_state.confirmed_plan.selected_components[${index}].component_id=${component.component_id}`,
      );
      lines.push(
        `next_state.confirmed_plan.selected_components[${index}].option_id=${component.option_id}`,
      );
    });
  }

  const fixture_state = next_state.fixture_state;
  lines.push(`next_state.fixture_state.source=${fixture_state.source}`);
  lines.push(`next_state.fixture_state.scenario=${fixture_state.scenario}`);
  lines.push(
    `next_state.fixture_state.constraint_ids=${fixture_state.constraint_ids.length}`,
  );
  fixture_state.constraint_ids.forEach((constraint_id, index) => {
    lines.push(`next_state.fixture_state.constraint_ids[${index}]=${constraint_id}`);
  });
  lines.push(
    `next_state.fixture_state.candidate_option_ids=${fixture_state.candidate_option_ids.length}`,
  );
  fixture_state.candidate_option_ids.forEach((option_id, index) => {
    lines.push(
      `next_state.fixture_state.candidate_option_ids[${index}]=${option_id}`,
    );
  });
  lines.push(
    `next_state.fixture_state.context_change_ids=${fixture_state.context_change_ids.length}`,
  );
  fixture_state.context_change_ids.forEach((context_change_id, index) => {
    lines.push(
      `next_state.fixture_state.context_change_ids[${index}]=${context_change_id}`,
    );
  });

  return lines.join('\n');
}

// Lowercase hex SHA-256 per the frozen receipt contract. Integrity metadata
// only; never authentication.
export function computeMutationFingerprint(
  input: MutationFingerprintInput,
): string {
  return sha256HexUtf8(serializeMutationRequest(input));
}
