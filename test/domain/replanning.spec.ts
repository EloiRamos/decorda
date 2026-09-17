import {readFileSync} from 'fs';
import {join} from 'path';
import {
  classifyContextImpact,
  finalizeScopedReplan,
  prepareScopedReplan,
  recordScopedResponse,
  selectAffectedReplacement,
} from '../../src/domain/replanning';
import type {ScopedReplanState} from '../../src/domain/replanning';
import {
  referenceCandidateOptions,
  referenceConstraints,
  referenceParticipants,
  syntheticContextChange,
} from '../../src/domain/fixtures';
import type {
  AffectedComponentReference,
  CandidateOptionId,
  ConfirmedPlan,
  ContextChange,
  ParticipantId,
  ParticipantResponseState,
  PlanComponentId,
  PreservedComponentReference,
} from '../../src/domain/types';

// The replanning module stays a pure domain module: the throwing factories
// below fail this suite if any replanning transition ever pulls persistence
// or an AWS client into its import graph while exercised here.
jest.mock('../../src/infrastructure/persistence/dynamoDbDecisionStore', () => {
  throw new Error('F6B must not import persistence adapters');
});

jest.mock('../../src/infrastructure/persistence/inMemoryDecisionStore', () => {
  throw new Error('F6B must not import persistence adapters');
});

jest.mock('@aws-sdk/client-dynamodb', () => {
  throw new Error('F6B must not import AWS clients');
});

const referenceConfirmedPlan: ConfirmedPlan = {
  plan_id: 'plan-saturday-activity',
  version: 1,
  confirmation_state: 'confirmed',
  selected_components: [
    {
      component_id: 'component-activity',
      option_id: 'option-riverside-picnic',
    },
    {
      component_id: 'component-return-arrangement',
      option_id: 'option-museum-workshop',
    },
  ],
};

const threeComponentPlan: ConfirmedPlan = {
  plan_id: 'plan-saturday-extended',
  version: 1,
  confirmation_state: 'confirmed',
  selected_components: [
    {
      component_id: 'component-return-arrangement',
      option_id: 'option-museum-workshop',
    },
    {
      component_id: 'component-activity',
      option_id: 'option-riverside-picnic',
    },
    {
      component_id: 'component-meeting-point',
      option_id: 'option-community-garden',
    },
  ],
};

const duplicateActivityPlan: ConfirmedPlan = {
  plan_id: 'plan-duplicate-activity-components',
  version: 1,
  confirmation_state: 'confirmed',
  selected_components: [
    {
      component_id: 'component-return-arrangement',
      option_id: 'option-museum-workshop',
    },
    {
      component_id: 'component-activity',
      option_id: 'option-riverside-picnic',
    },
    {
      component_id: 'component-activity',
      option_id: 'option-forest-course',
    },
  ],
};

const emptyPlan: ConfirmedPlan = {
  plan_id: 'plan-no-components',
  version: 1,
  confirmation_state: 'confirmed',
  selected_components: [],
};

const absentComponentContextChange: ContextChange = {
  ...syntheticContextChange,
  id: 'context-change-absent-component',
  changed_component_id: 'component-not-in-plan',
};

const referenceReason =
  'Synthetic rain conditions make the outdoor activity unsuitable.';

const referenceClassification = {
  context_change_id: 'context-change-rain-fixture',
  reason: referenceReason,
  affected_components: [
    {classification: 'affected', component_id: 'component-activity'},
  ],
  preserved_components: [
    {
      classification: 'preserved',
      component_id: 'component-return-arrangement',
    },
  ],
} as const;

const replanningSource = readFileSync(
  join(__dirname, '..', '..', 'src', 'domain', 'replanning.ts'),
  'utf8',
);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const referenceParticipantIds: readonly ParticipantId[] =
  referenceParticipants.map((participant) => participant.id);

const prepareReferenceReplan = (): ScopedReplanState =>
  prepareScopedReplan(
    referenceConfirmedPlan,
    classifyContextImpact(referenceConfirmedPlan, syntheticContextChange),
    referenceCandidateOptions,
    referenceConstraints,
    referenceParticipantIds,
  );

function selectRequired(
  state: ScopedReplanState,
  component_id: PlanComponentId,
  replacement_option_id: CandidateOptionId,
): ScopedReplanState {
  const selected = selectAffectedReplacement(
    state,
    component_id,
    replacement_option_id,
  );
  if (!selected) {
    throw new Error('Test setup used an ineligible replacement selection');
  }
  return selected;
}

function recordRequired(
  state: ScopedReplanState,
  participant_id: ParticipantId,
  response_state: ParticipantResponseState,
): ScopedReplanState {
  const recorded = recordScopedResponse(state, participant_id, response_state);
  if (!recorded) {
    throw new Error('Test setup used an unknown scoped participant');
  }
  return recorded;
}

const approveAllScopedParticipants = (
  initial: ScopedReplanState,
): ScopedReplanState => {
  let state = initial;
  for (const participant_id of referenceParticipantIds) {
    state = recordRequired(state, participant_id, 'approved');
  }
  return state;
};

const finalizeAfterUnanimousApproval = (): ScopedReplanState =>
  finalizeScopedReplan(
    approveAllScopedParticipants(
      selectRequired(
        prepareReferenceReplan(),
        'component-activity',
        'option-museum-workshop',
      ),
    ),
  );

const finalizeThreeComponentReplan = (): ScopedReplanState =>
  finalizeScopedReplan(
    approveAllScopedParticipants(
      selectRequired(
        prepareScopedReplan(
          threeComponentPlan,
          classifyContextImpact(threeComponentPlan, syntheticContextChange),
          referenceCandidateOptions,
          referenceConstraints,
          referenceParticipantIds,
        ),
        'component-activity',
        'option-museum-workshop',
      ),
    ),
  );

describe('Decorda F6A deterministic context impact classification', () => {
  it('classifies the reference confirmed plan with the synthetic context change', () => {
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );

    expect(result).toEqual(referenceClassification);
  });

  it('classifies exactly the changed component as affected', () => {
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );

    expect(result.affected_components).toEqual([
      {classification: 'affected', component_id: 'component-activity'},
    ]);
    expect(result.affected_components).toHaveLength(1);
  });

  it('classifies every other selected component as preserved', () => {
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );

    expect(result.preserved_components).toEqual([
      {
        classification: 'preserved',
        component_id: 'component-return-arrangement',
      },
    ]);
    expect(result.preserved_components).toHaveLength(1);
  });

  it('keeps the affected and preserved component sets disjoint', () => {
    const result = classifyContextImpact(
      threeComponentPlan,
      syntheticContextChange,
    );
    const affectedIds = result.affected_components.map(
      (component) => component.component_id,
    );
    const preservedIds = result.preserved_components.map(
      (component) => component.component_id,
    );

    expect(affectedIds.filter((id) => preservedIds.includes(id))).toEqual([]);
  });

  it('exhausts all selected plan components across affected and preserved', () => {
    const result = classifyContextImpact(
      threeComponentPlan,
      syntheticContextChange,
    );
    const classifiedIds = [
      ...result.affected_components,
      ...result.preserved_components,
    ]
      .map((component) => component.component_id)
      .sort();
    const selectedIds = threeComponentPlan.selected_components
      .map((component) => component.component_id)
      .sort();

    expect(classifiedIds).toEqual(selectedIds);
  });

  it('classifies affected components in input order without deduplication', () => {
    const duplicated = classifyContextImpact(
      duplicateActivityPlan,
      syntheticContextChange,
    );

    expect(duplicated.affected_components).toEqual([
      {classification: 'affected', component_id: 'component-activity'},
      {classification: 'affected', component_id: 'component-activity'},
    ]);
    expect(duplicated.preserved_components).toEqual([
      {
        classification: 'preserved',
        component_id: 'component-return-arrangement',
      },
    ]);

    const middle = classifyContextImpact(
      threeComponentPlan,
      syntheticContextChange,
    );

    expect(middle.affected_components).toEqual([
      {classification: 'affected', component_id: 'component-activity'},
    ]);
  });

  it('preserves input component order in the preserved collection', () => {
    const result = classifyContextImpact(
      threeComponentPlan,
      syntheticContextChange,
    );

    expect(result.preserved_components).toEqual([
      {
        classification: 'preserved',
        component_id: 'component-return-arrangement',
      },
      {classification: 'preserved', component_id: 'component-meeting-point'},
    ]);
  });

  it('retains the context-change id exactly', () => {
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );

    expect(result.context_change_id).toBe('context-change-rain-fixture');
    expect(result.context_change_id).toBe(syntheticContextChange.id);
  });

  it('retains the synthetic reason exactly without rewriting it', () => {
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );

    expect(result.reason).toBe(
      'Synthetic rain conditions make the outdoor activity unsuitable.',
    );
    expect(result.reason).toBe(syntheticContextChange.reason);
  });

  it('produces deeply equal output across repeated identical calls', () => {
    const first = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );
    const second = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );

    expect(first).toEqual(second);

    const emptyFirst = classifyContextImpact(emptyPlan, syntheticContextChange);
    const emptySecond = classifyContextImpact(
      emptyPlan,
      syntheticContextChange,
    );

    expect(emptyFirst).toEqual(emptySecond);
  });

  it('does not mutate the confirmed plan or the context change', () => {
    const planSnapshot = clone(referenceConfirmedPlan);
    const contextChangeSnapshot = clone(syntheticContextChange);

    classifyContextImpact(referenceConfirmedPlan, syntheticContextChange);
    classifyContextImpact(threeComponentPlan, syntheticContextChange);
    classifyContextImpact(referenceConfirmedPlan, absentComponentContextChange);

    expect(referenceConfirmedPlan).toEqual(planSnapshot);
    expect(syntheticContextChange).toEqual(contextChangeSnapshot);
  });

  it('cannot leak mutations through the returned collections into the plan', () => {
    const planSnapshot = clone(referenceConfirmedPlan);
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      syntheticContextChange,
    );

    (result.affected_components as AffectedComponentReference[]).push({
      classification: 'affected',
      component_id: 'component-extra',
    });
    const preserved =
      result.preserved_components as PreservedComponentReference[];
    preserved.shift();
    if (preserved[0]) {
      preserved[0] = {
        classification: 'preserved',
        component_id: 'component-tampered',
      };
    }
    (result as {reason: string}).reason = 'Tampered reason.';

    expect(referenceConfirmedPlan).toEqual(planSnapshot);
    expect(
      classifyContextImpact(referenceConfirmedPlan, syntheticContextChange),
    ).toEqual(referenceClassification);
  });

  it('returns an empty affected collection when the changed component is absent', () => {
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      absentComponentContextChange,
    );

    expect(result.affected_components).toEqual([]);
  });

  it('preserves every plan component when the changed component is absent', () => {
    const result = classifyContextImpact(
      referenceConfirmedPlan,
      absentComponentContextChange,
    );

    expect(result.preserved_components).toEqual([
      {classification: 'preserved', component_id: 'component-activity'},
      {
        classification: 'preserved',
        component_id: 'component-return-arrangement',
      },
    ]);
    expect(result.context_change_id).toBe('context-change-absent-component');
    expect(result.reason).toBe(referenceReason);
  });

  it('produces deterministic empty outputs for a plan without selected components', () => {
    const result = classifyContextImpact(emptyPlan, syntheticContextChange);

    expect(result).toEqual({
      context_change_id: 'context-change-rain-fixture',
      reason: referenceReason,
      affected_components: [],
      preserved_components: [],
    });
    expect(classifyContextImpact(emptyPlan, syntheticContextChange)).toEqual(
      result,
    );
  });

  it('imports only domain modules and exposes a minimal API surface', () => {
    const importStatements = replanningSource.match(/^import[^;]*;/gm) ?? [];

    expect(importStatements.length).toBeGreaterThan(0);
    for (const statement of importStatements) {
      expect(
        ["from './types'", "from './feasibility'", "from './consensus'"].some(
          (source) => statement.includes(source),
        ),
      ).toBe(true);
    }

    const exportNames = Object.keys(
      jest.requireActual('../../src/domain/replanning') as Record<
        string,
        unknown
      >,
    )
      .filter((name) => name !== '__esModule')
      .sort();

    expect(exportNames).toEqual([
      'classifyContextImpact',
      'finalizeScopedReplan',
      'prepareScopedReplan',
      'recordScopedResponse',
      'selectAffectedReplacement',
    ]);
  });

  it('requires no persistence or AWS modules to classify or replan', () => {
    expect(
      classifyContextImpact(threeComponentPlan, syntheticContextChange),
    ).toEqual({
      context_change_id: 'context-change-rain-fixture',
      reason: referenceReason,
      affected_components: [
        {classification: 'affected', component_id: 'component-activity'},
      ],
      preserved_components: [
        {
          classification: 'preserved',
          component_id: 'component-return-arrangement',
        },
        {classification: 'preserved', component_id: 'component-meeting-point'},
      ],
    });
    expect(prepareReferenceReplan().replan_required).toBe(true);
  });

  it('contains no AWS, Bedrock, network, or side-effecting behavior', () => {
    expect(replanningSource).not.toMatch(
      /aws|bedrock|fetch\(|xmlhttprequest|websocket|https?:\/\/|require\(|Math\.random|Date\.now/i,
    );
  });
});

describe('Decorda F6B deterministic scoped replanning and reapproval', () => {
  it('prepares an affected-only replan from the F6A classification', () => {
    const state = prepareReferenceReplan();

    expect(state.replan_required).toBe(true);
    expect(state.affected_components).toEqual([
      {
        component_id: 'component-activity',
        option_id: 'option-riverside-picnic',
      },
    ]);
    expect(state.original_plan_id).toBe('plan-saturday-activity');
    expect(state.original_version).toBe(1);
    expect(state.selected_replacements).toEqual([]);
    expect(state.renewed_responses).toEqual([]);
    expect(state.next_plan).toBeNull();
  });

  it('keeps preserved components exact in the prepared replan', () => {
    expect(prepareReferenceReplan().preserved_components).toEqual([
      {
        component_id: 'component-return-arrangement',
        option_id: 'option-museum-workshop',
      },
    ]);
  });

  it('requires no replan when the impact has no affected components', () => {
    const state = prepareScopedReplan(
      referenceConfirmedPlan,
      classifyContextImpact(
        referenceConfirmedPlan,
        absentComponentContextChange,
      ),
      referenceCandidateOptions,
      referenceConstraints,
      referenceParticipantIds,
    );

    expect(state.replan_required).toBe(false);
    expect(state.affected_components).toEqual([]);
    expect(state.eligible_replacements).toEqual([]);
    expect(state.preserved_components).toEqual([
      {
        component_id: 'component-activity',
        option_id: 'option-riverside-picnic',
      },
      {
        component_id: 'component-return-arrangement',
        option_id: 'option-museum-workshop',
      },
    ]);
    expect(
      selectAffectedReplacement(
        state,
        'component-activity',
        'option-riverside-picnic',
      ),
    ).toBeNull();
    expect(finalizeScopedReplan(state).next_plan).toBeNull();
    expect(state.original_version).toBe(1);
  });

  it('excludes hard-infeasible candidates from eligible replacements', () => {
    const state = prepareReferenceReplan();

    expect(state.eligible_replacements).not.toContain('option-forest-course');
    expect(state.eligible_replacements).not.toContain(
      'option-community-garden',
    );
  });

  it('orders eligible replacements deterministically', () => {
    expect(prepareReferenceReplan().eligible_replacements).toEqual([
      'option-riverside-picnic',
      'option-museum-workshop',
    ]);
    expect(prepareReferenceReplan()).toEqual(prepareReferenceReplan());
  });

  it('accepts an eligible replacement for the affected component', () => {
    const state = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );

    expect(state.selected_replacements).toEqual([
      {
        component_id: 'component-activity',
        option_id: 'option-museum-workshop',
      },
    ]);
  });

  it('rejects replacing a preserved component', () => {
    expect(
      selectAffectedReplacement(
        prepareReferenceReplan(),
        'component-return-arrangement',
        'option-riverside-picnic',
      ),
    ).toBeNull();
  });

  it('rejects replacing a component absent from the classification', () => {
    expect(
      selectAffectedReplacement(
        prepareReferenceReplan(),
        'component-not-in-plan',
        'option-riverside-picnic',
      ),
    ).toBeNull();
  });

  it('rejects an ineligible replacement option', () => {
    expect(
      selectAffectedReplacement(
        prepareReferenceReplan(),
        'component-activity',
        'option-forest-course',
      ),
    ).toBeNull();
    expect(
      selectAffectedReplacement(
        prepareReferenceReplan(),
        'component-activity',
        'option-not-a-candidate',
      ),
    ).toBeNull();
  });

  it('does not mutate the original plan when selecting a replacement', () => {
    const planSnapshot = clone(referenceConfirmedPlan);
    const state = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );

    expect(referenceConfirmedPlan).toEqual(planSnapshot);
    expect(state.original_components).not.toBe(
      referenceConfirmedPlan.selected_components,
    );
  });

  it('starts the scoped renewed responses pending on first selection', () => {
    const state = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );

    expect(state.renewed_responses).toEqual([
      {participant_id: 'participant-alex', response_state: 'pending'},
      {participant_id: 'participant-blair', response_state: 'pending'},
      {participant_id: 'participant-casey', response_state: 'pending'},
      {participant_id: 'participant-devon', response_state: 'pending'},
    ]);
    expect(state.next_plan).toBeNull();
  });

  it('resets scoped responses on a different replacement selection', () => {
    let state = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );
    state = recordRequired(state, 'participant-alex', 'approved');
    expect(state.renewed_responses[0]).toEqual({
      participant_id: 'participant-alex',
      response_state: 'approved',
    });

    state = selectRequired(
      state,
      'component-activity',
      'option-riverside-picnic',
    );

    expect(state.selected_replacements).toEqual([
      {
        component_id: 'component-activity',
        option_id: 'option-riverside-picnic',
      },
    ]);
    expect(
      state.renewed_responses.every(
        (response) => response.response_state === 'pending',
      ),
    ).toBe(true);
    expect(state.next_plan).toBeNull();
  });

  it('treats an identical re-selection as a no-op', () => {
    const state = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );

    expect(
      selectAffectedReplacement(
        state,
        'component-activity',
        'option-museum-workshop',
      ),
    ).toBe(state);
  });

  it('requires the four reference participants for scoped reapproval', () => {
    const state = prepareReferenceReplan();

    expect(state.participant_ids).toEqual(referenceParticipantIds);
    const selected = selectRequired(
      state,
      'component-activity',
      'option-museum-workshop',
    );

    expect(selected.renewed_responses).toHaveLength(4);
  });

  it('changes only the targeted participant on one scoped approval', () => {
    const state = recordRequired(
      selectRequired(
        prepareReferenceReplan(),
        'component-activity',
        'option-museum-workshop',
      ),
      'participant-blair',
      'approved',
    );

    expect(state.renewed_responses).toEqual([
      {participant_id: 'participant-alex', response_state: 'pending'},
      {participant_id: 'participant-blair', response_state: 'approved'},
      {participant_id: 'participant-casey', response_state: 'pending'},
      {participant_id: 'participant-devon', response_state: 'pending'},
    ]);
  });

  it('blocks scoped confirmation while a rejection exists', () => {
    let state = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );
    for (const participant_id of referenceParticipantIds) {
      state = recordRequired(
        state,
        participant_id,
        participant_id === 'participant-devon' ? 'rejected' : 'approved',
      );
    }

    expect(finalizeScopedReplan(state).next_plan).toBeNull();
  });

  it('blocks scoped confirmation while any response is pending', () => {
    let state = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );
    state = recordRequired(state, 'participant-alex', 'approved');
    state = recordRequired(state, 'participant-blair', 'approved');
    state = recordRequired(state, 'participant-casey', 'approved');

    expect(finalizeScopedReplan(state).next_plan).toBeNull();
    expect(state.renewed_responses[3]).toEqual({
      participant_id: 'participant-devon',
      response_state: 'pending',
    });
  });

  it('permits finalization after unanimous scoped approval', () => {
    expect(finalizeAfterUnanimousApproval().next_plan).not.toBeNull();
  });

  it('keeps scoped response transitions immutable', () => {
    const before = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );
    const responsesSnapshot = clone(before.renewed_responses);
    const after = recordRequired(before, 'participant-alex', 'approved');

    expect(before.renewed_responses).toEqual(responsesSnapshot);
    expect(after.renewed_responses).not.toBe(before.renewed_responses);
    expect(after).not.toBe(before);
  });

  it('rejects an unknown scoped participant deterministically', () => {
    const before = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );

    expect(
      recordScopedResponse(before, 'participant-nobody', 'approved'),
    ).toBeNull();
    expect(before.renewed_responses).toHaveLength(4);
  });

  it('produces no final plan before unanimous scoped approval', () => {
    const selected = selectRequired(
      prepareReferenceReplan(),
      'component-activity',
      'option-museum-workshop',
    );

    expect(selected.next_plan).toBeNull();
    expect(finalizeScopedReplan(selected).next_plan).toBeNull();
  });

  it('confirms the replanned plan at the original version + 1', () => {
    const state = finalizeAfterUnanimousApproval();
    const nextPlan = state.next_plan;
    if (!nextPlan) {
      throw new Error('Expected a confirmed next plan after unanimity');
    }

    expect(nextPlan.version).toBe(state.original_version + 1);
    expect(nextPlan.version).toBe(2);
    expect(nextPlan.plan_id).toBe('plan-saturday-activity');
    expect(nextPlan.confirmation_state).toBe('confirmed');
  });

  it('keeps preserved components exact in the final plan', () => {
    const state = finalizeAfterUnanimousApproval();

    expect(state.next_plan?.selected_components).toContainEqual({
      component_id: 'component-return-arrangement',
      option_id: 'option-museum-workshop',
    });
  });

  it('replaces only the affected component in the final plan', () => {
    const state = finalizeAfterUnanimousApproval();

    expect(state.next_plan?.selected_components).toContainEqual({
      component_id: 'component-activity',
      option_id: 'option-museum-workshop',
    });
    expect(state.next_plan?.selected_components).not.toContainEqual({
      component_id: 'component-activity',
      option_id: 'option-riverside-picnic',
    });
  });

  it('keeps original selected-component order in the final plan', () => {
    const referenceNext =
      finalizeAfterUnanimousApproval().next_plan?.selected_components;

    expect(referenceNext).toEqual([
      {
        component_id: 'component-activity',
        option_id: 'option-museum-workshop',
      },
      {
        component_id: 'component-return-arrangement',
        option_id: 'option-museum-workshop',
      },
    ]);

    const threeComponentNext =
      finalizeThreeComponentReplan().next_plan?.selected_components;

    expect(threeComponentNext).toEqual([
      {
        component_id: 'component-return-arrangement',
        option_id: 'option-museum-workshop',
      },
      {
        component_id: 'component-activity',
        option_id: 'option-museum-workshop',
      },
      {
        component_id: 'component-meeting-point',
        option_id: 'option-community-garden',
      },
    ]);
  });

  it('leaves the original plans unchanged after full scoped replans', () => {
    const referenceSnapshot = clone(referenceConfirmedPlan);
    const threeComponentSnapshot = clone(threeComponentPlan);

    finalizeAfterUnanimousApproval();
    finalizeThreeComponentReplan();

    expect(referenceConfirmedPlan).toEqual(referenceSnapshot);
    expect(threeComponentPlan).toEqual(threeComponentSnapshot);
  });

  it('produces deeply equal results across repeated sequences', () => {
    expect(finalizeAfterUnanimousApproval()).toEqual(
      finalizeAfterUnanimousApproval(),
    );
    expect(finalizeThreeComponentReplan()).toEqual(
      finalizeThreeComponentReplan(),
    );
  });

  it('keeps plan versioning separate from persistence CAS semantics', () => {
    const state = finalizeAfterUnanimousApproval();

    expect(JSON.stringify(state)).not.toMatch(
      /operation_id|base_version|applied|stale_version|current_version/i,
    );
    expect(state.next_plan?.version).toBe(state.original_version + 1);
    expect(state.original_version).toBe(1);
  });
});
