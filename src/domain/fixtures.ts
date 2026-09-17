import type {
  CandidateOption,
  Constraint,
  ContextChange,
  Participant,
  VersionedDecisionState,
} from './types';

export const referenceParticipants = [
  {
    id: 'participant-alex',
    display_name: 'Alex',
    response_state: 'pending',
  },
  {
    id: 'participant-blair',
    display_name: 'Blair',
    response_state: 'pending',
  },
  {
    id: 'participant-casey',
    display_name: 'Casey',
    response_state: 'pending',
  },
  {
    id: 'participant-devon',
    display_name: 'Devon',
    response_state: 'pending',
  },
] as const satisfies readonly Participant[];

export const referenceConstraints = [
  {
    id: 'constraint-budget',
    kind: 'hard',
    category: 'budget',
    label: 'Total activity budget is at most 60 EUR',
    value: {
      unit: 'EUR',
      maximum: 60,
    },
  },
  {
    id: 'constraint-return-time',
    kind: 'hard',
    category: 'return_time',
    label: 'Return by 18:00',
    value: {
      format: 'minutes_after_midnight',
      latest: 18 * 60,
      display: '18:00',
    },
  },
  {
    id: 'constraint-outdoor-preference',
    kind: 'soft',
    category: 'setting_preference',
    label: 'Prefer an outdoor activity',
    value: {
      preference: 'outdoor',
    },
  },
] as const satisfies readonly Constraint[];

export const referenceCandidateOptions = [
  {
    id: 'option-riverside-picnic',
    title: 'Riverside Picnic',
    cost_eur: 42,
    return_time: {
      format: 'minutes_after_midnight',
      value: 17 * 60,
      display: '17:00',
    },
    setting: 'outdoor',
    description: 'A relaxed picnic beside the river with shared games.',
  },
  {
    id: 'option-museum-workshop',
    title: 'Museum Workshop',
    cost_eur: 55,
    return_time: {
      format: 'minutes_after_midnight',
      value: 17 * 60 + 30,
      display: '17:30',
    },
    setting: 'indoor',
    description: 'A hands-on museum session followed by an early return.',
  },
  {
    id: 'option-forest-course',
    title: 'Forest Activity Course',
    cost_eur: 72,
    return_time: {
      format: 'minutes_after_midnight',
      value: 17 * 60 + 45,
      display: '17:45',
    },
    setting: 'outdoor',
    description: 'A guided woodland challenge with provided equipment.',
  },
  {
    id: 'option-community-garden',
    title: 'Community Garden Visit',
    cost_eur: 38,
    return_time: {
      format: 'minutes_after_midnight',
      value: 18 * 60 + 30,
      display: '18:30',
    },
    setting: 'outdoor',
    description: 'A garden tour and planting session ending after 18:00.',
  },
] as const satisfies readonly CandidateOption[];

export const syntheticContextChange = {
  id: 'context-change-rain-fixture',
  changed_component_id: 'component-activity',
  changed_category: 'activity_conditions',
  reason: 'Synthetic rain conditions make the outdoor activity unsuitable.',
  source: 'synthetic_fixture',
  deterministic: true,
  later_classification_value: 'outdoor_activity_disrupted',
  affected_component: {
    classification: 'affected',
    component_id: 'component-activity',
  },
  preserved_components: [
    {
      classification: 'preserved',
      component_id: 'component-return-arrangement',
    },
  ],
} as const satisfies ContextChange;

export const initialDecisionState = {
  decision_id: 'decision-saturday-activity',
  version: 1,
  participant_responses: referenceParticipants.map(participant => ({
    participant_id: participant.id,
    response_state: participant.response_state,
  })),
  current_plan: null,
  fixture_state: {
    source: 'synthetic_fixture',
    scenario: 'saturday_activity',
    constraint_ids: referenceConstraints.map(constraint => constraint.id),
    candidate_option_ids: referenceCandidateOptions.map(option => option.id),
    context_change_ids: [syntheticContextChange.id],
  },
} as const satisfies VersionedDecisionState;
