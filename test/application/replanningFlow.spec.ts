import {readFileSync} from 'fs';
import {join} from 'path';
import type {
  ApplyDecisionMutationInput,
  ApplyDecisionMutationResult,
  CanonicalDecisionState,
  DecisionSnapshot,
  DecisionStore,
  LoadDecisionResult,
} from '../../src/application/decisionStore';
import type {
  DurableScopedReplanFlow,
  DurableScopedReplanInputs,
  FinalizeDurableScopedReplanOutcome,
} from '../../src/application/replanningFlow';
import {
  beginDurableScopedReplan,
  finalizeAndPersistDurableScopedReplan,
  recordDurableScopedResponse,
  selectDurableScopedReplacement,
} from '../../src/application/replanningFlow';
import {InMemoryDecisionStore} from '../../src/infrastructure/persistence/inMemoryDecisionStore';
import {
  initialDecisionState,
  referenceCandidateOptions,
  referenceConstraints,
  referenceParticipants,
  syntheticContextChange,
} from '../../src/domain/fixtures';
import type {
  CandidateOptionId,
  ConfirmedPlan,
  DecisionId,
  ParticipantId,
  ParticipantResponseState,
  PlanComponentId,
} from '../../src/domain/types';
import {classifyContextImpact} from '../../src/domain/replanning';

// The flow under test stays application-layer only: the throwing factories
// below fail this suite if any flow transition ever pulls the DynamoDB
// adapter or an AWS client into its import graph while exercised here. The
// in-memory store is intentionally not mocked; it is the local fake this
// suite legitimately uses.
jest.mock('../../src/infrastructure/persistence/dynamoDbDecisionStore', () => {
  throw new Error('F6C must not import persistence adapters');
});

jest.mock('@aws-sdk/client-dynamodb', () => {
  throw new Error('F6C must not import AWS clients');
});

const DECISION_ID: DecisionId = initialDecisionState.decision_id;
const riversideOptionId = referenceCandidateOptions[0].id;
const museumOptionId = referenceCandidateOptions[1].id;
const AFFECTED_COMPONENT: PlanComponentId = 'component-activity';
const PRESERVED_COMPONENT: PlanComponentId = 'component-return-arrangement';
const OPERATION_ID = 'op-f6c-final-1';

// Deliberately different version spaces: the canonical CAS version is 7
// while the confirmed product plan version is 3, so any derivation of one
// from the other fails these tests.
const CAS_VERSION = 7;
const ORIGINAL_PLAN_VERSION = 3;

const referenceParticipantIds: readonly ParticipantId[] =
  referenceParticipants.map((participant) => participant.id);

const allApprovedResponses = () =>
  initialDecisionState.participant_responses.map((response) => ({
    ...response,
    response_state: 'approved' as const,
  }));

const referencePlan: ConfirmedPlan = {
  plan_id: 'plan-saturday-activity',
  version: ORIGINAL_PLAN_VERSION,
  confirmation_state: 'confirmed',
  selected_components: [
    {
      component_id: AFFECTED_COMPONENT,
      option_id: riversideOptionId,
    },
    {
      component_id: PRESERVED_COMPONENT,
      option_id: museumOptionId,
    },
  ],
};

function referenceCanonical(): CanonicalDecisionState {
  return {
    selected_candidate_id: riversideOptionId,
    participant_responses: allApprovedResponses(),
    confirmed_plan: referencePlan,
    fixture_state: initialDecisionState.fixture_state,
    decision_id: DECISION_ID,
    version: CAS_VERSION,
  };
}

function preservedOnlyCanonical(): CanonicalDecisionState {
  return {
    ...referenceCanonical(),
    version: 9,
    confirmed_plan: {
      ...referencePlan,
      version: 5,
      selected_components: [
        {
          component_id: PRESERVED_COMPONENT,
          option_id: museumOptionId,
        },
      ],
    },
  };
}

const referenceInputs: DurableScopedReplanInputs = {
  context_change: syntheticContextChange,
  candidates: referenceCandidateOptions,
  constraints: referenceConstraints,
  participant_ids: referenceParticipantIds,
};

// Minimal scripted store: records every call and resolves the configured
// results, defaulting to a FOUND reference load and a well-formed APPLIED
// mutation so each test scripts only the outcome under examination.
function scriptedStore(
  config: {
    load?: LoadDecisionResult;
    mutation?: ApplyDecisionMutationResult;
  } = {},
): {store: DecisionStore; loads: DecisionId[]; mutations: ApplyDecisionMutationInput[]} {
  const loads: DecisionId[] = [];
  const mutations: ApplyDecisionMutationInput[] = [];
  const store: DecisionStore = {
    createDecision() {
      return Promise.reject(new Error('F6C must not create decisions'));
    },
    loadDecision(decision_id: DecisionId): Promise<LoadDecisionResult> {
      loads.push(decision_id);
      return Promise.resolve(
        config.load ?? {kind: 'FOUND', canonical_state: referenceCanonical()},
      );
    },
    applyMutation(
      input: ApplyDecisionMutationInput,
    ): Promise<ApplyDecisionMutationResult> {
      mutations.push(input);
      return Promise.resolve(
        config.mutation ?? {
          kind: 'APPLIED',
          applied: true,
          operation_id: input.operation_id,
          committed_version: input.base_version + 1,
          canonical_state: {
            ...input.next_state,
            decision_id: input.decision_id,
            version: input.base_version + 1,
          },
        },
      );
    },
  };
  return {store, loads, mutations};
}

async function beginOrThrow(store: DecisionStore): Promise<DurableScopedReplanFlow> {
  const outcome = await beginDurableScopedReplan(
    store,
    DECISION_ID,
    referenceInputs,
  );
  if (outcome.kind !== 'REPLAN_REQUIRED') {
    throw new Error(`expected REPLAN_REQUIRED, received ${outcome.kind}`);
  }
  return outcome.flow;
}

function selectOrThrow(
  flow: DurableScopedReplanFlow,
  component_id: PlanComponentId,
  replacement_option_id: CandidateOptionId,
): DurableScopedReplanFlow {
  const outcome = selectDurableScopedReplacement(
    flow,
    component_id,
    replacement_option_id,
  );
  if (outcome.kind !== 'REPLACEMENT_SELECTED') {
    throw new Error(`expected REPLACEMENT_SELECTED, received ${outcome.kind}`);
  }
  return outcome.flow;
}

function respondOrThrow(
  flow: DurableScopedReplanFlow,
  participant_id: ParticipantId,
  response_state: ParticipantResponseState,
): DurableScopedReplanFlow {
  const outcome = recordDurableScopedResponse(
    flow,
    participant_id,
    response_state,
  );
  if (outcome.kind !== 'RESPONSE_RECORDED') {
    throw new Error(`expected RESPONSE_RECORDED, received ${outcome.kind}`);
  }
  return outcome.flow;
}

function fullyApprovedFlow(
  flow: DurableScopedReplanFlow,
): DurableScopedReplanFlow {
  let current = flow;
  for (const participant_id of referenceParticipantIds) {
    current = respondOrThrow(current, participant_id, 'approved');
  }
  return current;
}

// Runs the complete transient flow against a scripted store and finalizes
// with the reference operation id, returning the recorded calls and outcome.
async function finalizedMutationInput(
  scriptedMutation?: ApplyDecisionMutationResult,
): Promise<{
  loads: DecisionId[];
  mutations: ApplyDecisionMutationInput[];
  outcome: FinalizeDurableScopedReplanOutcome;
}> {
  const script = scriptedStore({mutation: scriptedMutation});
  const flow = await beginOrThrow(script.store);
  const approved = fullyApprovedFlow(
    selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
  );
  const outcome = await finalizeAndPersistDurableScopedReplan(
    script.store,
    approved,
    OPERATION_ID,
  );
  return {loads: script.loads, mutations: script.mutations, outcome};
}

async function expectMutationSurfacedOnce(
  scriptedMutation: ApplyDecisionMutationResult,
): Promise<ApplyDecisionMutationResult> {
  const {mutations, outcome} = await finalizedMutationInput(scriptedMutation);
  expect(outcome.kind).toBe('MUTATION_NOT_APPLIED');
  if (outcome.kind !== 'MUTATION_NOT_APPLIED') {
    throw new Error(`expected MUTATION_NOT_APPLIED, received ${outcome.kind}`);
  }
  expect(outcome.result).toEqual(scriptedMutation);
  expect(mutations).toHaveLength(1);
  return outcome.result;
}

function durableApprovedSnapshot(): DecisionSnapshot {
  return {
    selected_candidate_id: riversideOptionId,
    participant_responses: allApprovedResponses(),
    confirmed_plan: {
      plan_id: 'plan-saturday-activity',
      version: 1,
      confirmation_state: 'confirmed',
      selected_components: [
        {component_id: AFFECTED_COMPONENT, option_id: riversideOptionId},
        {component_id: PRESERVED_COMPONENT, option_id: museumOptionId},
      ],
    },
    fixture_state: initialDecisionState.fixture_state,
  };
}

async function createDurableDecision(): Promise<InMemoryDecisionStore> {
  const store = new InMemoryDecisionStore();
  const created = await store.createDecision({
    decision_id: DECISION_ID,
    initial_state: durableApprovedSnapshot(),
    expires_at: 1_800_000_000,
  });
  if (created.kind !== 'CREATED') {
    throw new Error(`expected CREATED, received ${created.kind}`);
  }
  return store;
}

const flowSource = readFileSync(
  join(__dirname, '..', '..', 'src', 'application', 'replanningFlow.ts'),
  'utf8',
);

describe('Decorda F6C flow module boundaries', () => {
  it('exports exactly the four flow operations', () => {
    const exportNames = Object.keys(
      jest.requireActual('../../src/application/replanningFlow') as Record<
        string,
        unknown
      >,
    )
      .filter((name) => name !== '__esModule')
      .sort();

    expect(exportNames).toEqual([
      'beginDurableScopedReplan',
      'finalizeAndPersistDurableScopedReplan',
      'recordDurableScopedResponse',
      'selectDurableScopedReplacement',
    ]);
  });

  it('imports only application store contracts and delegated domain APIs', () => {
    const importStatements = flowSource.match(/^import[^;]*;/gm) ?? [];

    expect(importStatements.length).toBeGreaterThan(0);
    for (const statement of importStatements) {
      expect(
        [
          "from './decisionStore'",
          "from '../domain/replanning'",
          "from '../domain/types'",
        ].some((source) => statement.includes(source)),
      ).toBe(true);
    }
  });

  it('imports no persistence adapter, AWS client, or UI module', () => {
    const importStatements = flowSource.match(/^import[^;]*;/gm) ?? [];

    expect(importStatements.length).toBeGreaterThan(0);
    expect(importStatements.join('\n')).not.toMatch(
      /infrastructure|dynamo|aws-sdk|react|screens|components/i,
    );
  });

  it('contains no network, model, randomness, or clock behavior', () => {
    expect(flowSource).not.toMatch(
      /fetch\(|xmlhttprequest|websocket|https?:\/\/|bedrock|require\(|Math\.random|Date\.now/i,
    );
  });

  it('produces deeply equal outcomes for repeated identical flows', async () => {
    const firstBegin = await beginDurableScopedReplan(
      scriptedStore().store,
      DECISION_ID,
      referenceInputs,
    );
    const secondBegin = await beginDurableScopedReplan(
      scriptedStore().store,
      DECISION_ID,
      referenceInputs,
    );
    expect(firstBegin).toEqual(secondBegin);

    const transientFlow = async () => {
      const flow = await beginOrThrow(scriptedStore().store);
      return fullyApprovedFlow(
        selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
      );
    };
    expect(await transientFlow()).toEqual(await transientFlow());
  });
});

describe('Decorda F6C begin: one durable load and transient flow', () => {
  it('begins a flow from a FOUND canonical decision with a confirmed plan', async () => {
    const outcome = await beginDurableScopedReplan(
      scriptedStore().store,
      DECISION_ID,
      referenceInputs,
    );

    expect(outcome.kind).toBe('REPLAN_REQUIRED');
    if (outcome.kind !== 'REPLAN_REQUIRED') {
      throw new Error(`expected REPLAN_REQUIRED, received ${outcome.kind}`);
    }
    expect(Object.keys(outcome)).toEqual(['kind', 'flow']);
    expect(Object.keys(outcome.flow)).toEqual([
      'decision_id',
      'base_version',
      'canonical_state',
      'replan',
    ]);
    expect(outcome.flow.decision_id).toBe(DECISION_ID);
    expect(outcome.flow.replan.replan_required).toBe(true);
  });

  it('captures the persistence base version from the canonical CAS version', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    expect(flow.base_version).toBe(CAS_VERSION);
    expect(flow.base_version).toBe(flow.canonical_state.version);
  });

  it('keeps the product plan version independently sourced', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    expect(flow.replan.original_version).toBe(ORIGINAL_PLAN_VERSION);
    expect(flow.base_version).not.toBe(flow.replan.original_version);
  });

  it('surfaces NOT_FOUND loads without mutation', async () => {
    const script = scriptedStore({
      load: {kind: 'NOT_FOUND', decision_id: DECISION_ID},
    });

    const outcome = await beginDurableScopedReplan(
      script.store,
      DECISION_ID,
      referenceInputs,
    );

    expect(outcome).toEqual({
      kind: 'DECISION_NOT_FOUND',
      decision_id: DECISION_ID,
    });
    expect(script.loads).toHaveLength(1);
    expect(script.mutations).toHaveLength(0);
  });

  it('surfaces load infrastructure failures', async () => {
    const infrastructureError = {
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: true,
      safe_code: 'THROTTLING',
    } as const;
    const errorScript = scriptedStore({load: infrastructureError});
    expect(
      await beginDurableScopedReplan(errorScript.store, DECISION_ID, referenceInputs),
    ).toEqual({kind: 'LOAD_FAILED', failure: infrastructureError});

    const limitScript = scriptedStore({
      load: {kind: 'LIMIT_EXCEEDED', reason: 'ITEM_SIZE'},
    });
    expect(
      await beginDurableScopedReplan(limitScript.store, DECISION_ID, referenceInputs),
    ).toEqual({kind: 'LOAD_FAILED', failure: {kind: 'LIMIT_EXCEEDED', reason: 'ITEM_SIZE'}});
    expect(limitScript.mutations).toHaveLength(0);
  });

  it('returns a deterministic non-ready outcome when no plan is confirmed', async () => {
    const script = scriptedStore({
      load: {
        kind: 'FOUND',
        canonical_state: {
          ...referenceCanonical(),
          version: 4,
          confirmed_plan: null,
        },
      },
    });

    const outcome = await beginDurableScopedReplan(
      script.store,
      DECISION_ID,
      referenceInputs,
    );

    expect(outcome).toEqual({kind: 'NO_CONFIRMED_PLAN', decision_id: DECISION_ID});
    expect(script.mutations).toHaveLength(0);
  });

  it('loads the decision exactly once', async () => {
    const script = scriptedStore();

    await beginDurableScopedReplan(script.store, DECISION_ID, referenceInputs);

    expect(script.loads).toEqual([DECISION_ID]);
  });
});

describe('Decorda F6C delegation to F6A and F6B', () => {
  it('reflects the F6A context impact classification in the flow', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    expect(flow.replan.impact).toEqual(
      classifyContextImpact(referencePlan, syntheticContextChange),
    );
    expect(flow.replan.impact.affected_components).toEqual([
      {classification: 'affected', component_id: AFFECTED_COMPONENT},
    ]);
    expect(flow.replan.impact.reason).toBe(
      'Synthetic rain conditions make the outdoor activity unsuitable.',
    );
  });

  it('retains the preserved scope from the classification', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    expect(flow.replan.preserved_components).toEqual([
      {component_id: PRESERVED_COMPONENT, option_id: museumOptionId},
    ]);
    expect(flow.replan.affected_components).toEqual([
      {component_id: AFFECTED_COMPONENT, option_id: riversideOptionId},
    ]);
  });

  it('exposes the eligible replacements deterministically', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    expect(flow.replan.eligible_replacements).toEqual([
      riversideOptionId,
      museumOptionId,
    ]);
  });

  it('returns NO_REPLAN_REQUIRED when no component is affected', async () => {
    const script = scriptedStore({
      load: {kind: 'FOUND', canonical_state: preservedOnlyCanonical()},
    });

    const outcome = await beginDurableScopedReplan(
      script.store,
      DECISION_ID,
      referenceInputs,
    );

    expect(outcome.kind).toBe('NO_REPLAN_REQUIRED');
    if (outcome.kind !== 'NO_REPLAN_REQUIRED') {
      throw new Error(`expected NO_REPLAN_REQUIRED, received ${outcome.kind}`);
    }
    expect(outcome.replan.replan_required).toBe(false);
    expect(outcome.replan.eligible_replacements).toEqual([]);
    expect(outcome.canonical_state).toEqual(preservedOnlyCanonical());
  });

  it('performs zero writes when no replan is required', async () => {
    const script = scriptedStore({
      load: {kind: 'FOUND', canonical_state: preservedOnlyCanonical()},
    });

    await beginDurableScopedReplan(script.store, DECISION_ID, referenceInputs);

    expect(script.loads).toHaveLength(1);
    expect(script.mutations).toHaveLength(0);
  });
});

describe('Decorda F6C replacement selection', () => {
  it('accepts an eligible replacement for the affected component', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    const selected = selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId);

    expect(selected.replan.selected_replacements).toEqual([
      {component_id: AFFECTED_COMPONENT, option_id: museumOptionId},
    ]);
  });

  it('surfaces ineligible or mis-targeted selections without change', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    const ineligible = selectDurableScopedReplacement(
      flow,
      AFFECTED_COMPONENT,
      'option-forest-course',
    );
    expect(ineligible.kind).toBe('SELECTION_REJECTED');
    if (ineligible.kind !== 'SELECTION_REJECTED') {
      throw new Error('expected SELECTION_REJECTED');
    }
    expect(ineligible.flow).toEqual(flow);

    const preserved = selectDurableScopedReplacement(
      flow,
      PRESERVED_COMPONENT,
      museumOptionId,
    );
    expect(preserved.kind).toBe('SELECTION_REJECTED');
    if (preserved.kind !== 'SELECTION_REJECTED') {
      throw new Error('expected SELECTION_REJECTED');
    }
    expect(preserved.flow).toEqual(flow);
  });

  it('performs zero writes when selecting replacements', async () => {
    const script = scriptedStore();
    const flow = await beginOrThrow(script.store);

    selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId);

    expect(script.mutations).toHaveLength(0);
    expect(script.loads).toHaveLength(1);
  });

  it('resets scoped responses when the selection changes', async () => {
    const flow = await beginOrThrow(scriptedStore().store);
    const responded = respondOrThrow(
      selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
      'participant-alex',
      'approved',
    );

    const reselected = selectOrThrow(
      responded,
      AFFECTED_COMPONENT,
      riversideOptionId,
    );

    expect(reselected.replan.selected_replacements).toEqual([
      {component_id: AFFECTED_COMPONENT, option_id: riversideOptionId},
    ]);
    expect(
      reselected.replan.renewed_responses.every(
        (response) => response.response_state === 'pending',
      ),
    ).toBe(true);
    expect(reselected.replan.next_plan).toBeNull();
  });
});

describe('Decorda F6C scoped responses', () => {
  it('delegates the targeted scoped response through F6B', async () => {
    const flow = await beginOrThrow(scriptedStore().store);

    const responded = respondOrThrow(
      selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
      'participant-blair',
      'approved',
    );

    expect(responded.replan.renewed_responses).toEqual([
      {participant_id: 'participant-alex', response_state: 'pending'},
      {participant_id: 'participant-blair', response_state: 'approved'},
      {participant_id: 'participant-casey', response_state: 'pending'},
      {participant_id: 'participant-devon', response_state: 'pending'},
    ]);
  });

  it('performs zero writes while responses stay pending', async () => {
    const script = scriptedStore();
    const flow = await beginOrThrow(script.store);
    const responded = respondOrThrow(
      selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
      'participant-alex',
      'approved',
    );

    const outcome = await finalizeAndPersistDurableScopedReplan(
      script.store,
      responded,
      OPERATION_ID,
    );

    expect(outcome.kind).toBe('REPLAN_NOT_READY');
    expect(script.mutations).toHaveLength(0);
  });

  it('performs zero writes when a response is rejected and blocks finalization', async () => {
    const script = scriptedStore();
    const flow = await beginOrThrow(script.store);
    let rejected = selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId);
    for (const participant_id of referenceParticipantIds) {
      rejected = respondOrThrow(
        rejected,
        participant_id,
        participant_id === 'participant-devon' ? 'rejected' : 'approved',
      );
    }

    const outcome = await finalizeAndPersistDurableScopedReplan(
      script.store,
      rejected,
      OPERATION_ID,
    );

    expect(outcome.kind).toBe('REPLAN_NOT_READY');
    if (outcome.kind !== 'REPLAN_NOT_READY') {
      throw new Error(`expected REPLAN_NOT_READY, received ${outcome.kind}`);
    }
    expect(outcome.replan.next_plan).toBeNull();
    expect(script.mutations).toHaveLength(0);
  });

  it('permits finalization after unanimous scoped approval', async () => {
    const {outcome} = await finalizedMutationInput();

    expect(outcome.kind).toBe('APPLIED');
  });

  it('surfaces unknown participants without change', async () => {
    const flow = await beginOrThrow(scriptedStore().store);
    const selected = selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId);

    const outcome = recordDurableScopedResponse(
      selected,
      'participant-nobody',
      'approved',
    );

    expect(outcome.kind).toBe('RESPONSE_REJECTED');
    if (outcome.kind !== 'RESPONSE_REJECTED') {
      throw new Error('expected RESPONSE_REJECTED');
    }
    expect(outcome.flow).toEqual(selected);
  });

  it('performs zero writes for response actions', async () => {
    const script = scriptedStore();
    const flow = await beginOrThrow(script.store);

    fullyApprovedFlow(selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId));

    expect(script.mutations).toHaveLength(0);
    expect(script.loads).toHaveLength(1);
  });
});

describe('Decorda F6C final durable snapshot', () => {
  it('persists the next confirmed plan at original product version + 1', async () => {
    const {mutations} = await finalizedMutationInput();
    const next_plan = mutations[0].next_state.confirmed_plan;

    expect(next_plan).toEqual({
      plan_id: 'plan-saturday-activity',
      version: ORIGINAL_PLAN_VERSION + 1,
      confirmation_state: 'confirmed',
      selected_components: [
        {component_id: AFFECTED_COMPONENT, option_id: museumOptionId},
        {component_id: PRESERVED_COMPONENT, option_id: museumOptionId},
      ],
    });
  });

  it('keeps preserved components unchanged in the persisted plan', async () => {
    const {mutations} = await finalizedMutationInput();
    const components =
      mutations[0].next_state.confirmed_plan?.selected_components ?? [];

    expect(components).toContainEqual({
      component_id: PRESERVED_COMPONENT,
      option_id: museumOptionId,
    });
  });

  it('persists the selected affected replacement as the selected candidate', async () => {
    const {mutations} = await finalizedMutationInput();
    const next_state = mutations[0].next_state;

    expect(next_state.confirmed_plan?.selected_components).toContainEqual({
      component_id: AFFECTED_COMPONENT,
      option_id: museumOptionId,
    });
    expect(next_state.confirmed_plan?.selected_components).not.toContainEqual({
      component_id: AFFECTED_COMPONENT,
      option_id: riversideOptionId,
    });
    expect(next_state.selected_candidate_id).toBe(museumOptionId);
  });

  it('persists the renewed scoped responses', async () => {
    const {mutations} = await finalizedMutationInput();

    expect(mutations[0].next_state.participant_responses).toEqual(
      allApprovedResponses(),
    );
  });

  it('carries the canonical fixture state through unchanged', async () => {
    const {mutations} = await finalizedMutationInput();

    expect(mutations[0].next_state.fixture_state).toEqual(
      initialDecisionState.fixture_state,
    );
  });

  it('persists none of the transient impact, eligibility, or flow data', async () => {
    const {mutations} = await finalizedMutationInput();
    const next_state = mutations[0].next_state;

    expect(Object.keys(next_state)).toEqual([
      'selected_candidate_id',
      'participant_responses',
      'confirmed_plan',
      'fixture_state',
    ]);
    expect(JSON.stringify(next_state)).not.toMatch(
      /impact|eligible|replan_required|next_plan|changed_component|base_version|operation_id|classification/i,
    );
  });
});

describe('Decorda F6C single CONFIRM_PLAN mutation over the captured CAS version', () => {
  it('sends the captured canonical CAS version as base_version, not the plan version', async () => {
    const {mutations} = await finalizedMutationInput();

    expect(mutations).toHaveLength(1);
    expect(mutations[0].base_version).toBe(CAS_VERSION);
    expect(mutations[0].base_version).not.toBe(ORIGINAL_PLAN_VERSION);
  });

  it('uses the caller-supplied operation id exactly', async () => {
    const {mutations} = await finalizedMutationInput();

    expect(mutations[0].operation_id).toBe(OPERATION_ID);
    expect(mutations[0].decision_id).toBe(DECISION_ID);
  });

  it('declares CONFIRM_PLAN for the finalized plan id', async () => {
    const {mutations} = await finalizedMutationInput();

    expect(mutations[0].mutation).toEqual({
      kind: 'CONFIRM_PLAN',
      plan_id: 'plan-saturday-activity',
    });
  });

  it('calls applyMutation exactly once on unanimous completion', async () => {
    const {mutations} = await finalizedMutationInput();

    expect(mutations).toHaveLength(1);
  });

  it('surfaces APPLIED', async () => {
    const {outcome} = await finalizedMutationInput();

    expect(outcome.kind).toBe('APPLIED');
  });

  it('surfaces the committed CAS version separately from the product plan version', async () => {
    const {outcome} = await finalizedMutationInput();
    if (outcome.kind !== 'APPLIED') {
      throw new Error(`expected APPLIED, received ${outcome.kind}`);
    }

    expect(outcome.committed_version).toBe(CAS_VERSION + 1);
    expect(outcome.canonical_state.version).toBe(CAS_VERSION + 1);
    expect(outcome.next_plan.version).toBe(ORIGINAL_PLAN_VERSION + 1);
    expect(outcome.committed_version).not.toBe(outcome.next_plan.version);
    expect(outcome.canonical_state.confirmed_plan).toEqual(outcome.next_plan);
    expect(outcome.canonical_state.confirmed_plan?.version).toBe(
      ORIGINAL_PLAN_VERSION + 1,
    );
    expect(outcome.operation_id).toBe(OPERATION_ID);
  });
});

describe('Decorda F6C exceptional store outcomes surfaced without retry', () => {
  it('surfaces STALE_VERSION unchanged and performs no retry', async () => {
    const result = await expectMutationSurfacedOnce({
      kind: 'STALE_VERSION',
      applied: false,
      reason: 'STALE_VERSION',
      current_version: 9,
      canonical_state: {...referenceCanonical(), version: 9},
    });

    expect(result.kind).toBe('STALE_VERSION');
  });

  it('surfaces IDEMPOTENT_REPLAY distinctly from a newly applied mutation', async () => {
    const result = await expectMutationSurfacedOnce({
      kind: 'IDEMPOTENT_REPLAY',
      applied: false,
      reason: 'IDEMPOTENT_REPLAY',
      operation_id: OPERATION_ID,
      committed_version: 4,
      canonical_state: {...referenceCanonical(), version: 6},
    });

    expect(result.kind).toBe('IDEMPOTENT_REPLAY');
  });

  it('surfaces OPERATION_ID_CONFLICT without generating a replacement id', async () => {
    const result = await expectMutationSurfacedOnce({
      kind: 'OPERATION_ID_CONFLICT',
      applied: false,
      reason: 'OPERATION_ID_CONFLICT',
      operation_id: OPERATION_ID,
      current_version: 9,
      canonical_state: {...referenceCanonical(), version: 9},
    });

    expect(result.kind).toBe('OPERATION_ID_CONFLICT');
  });

  it('surfaces a NOT_FOUND mutation outcome', async () => {
    const result = await expectMutationSurfacedOnce({
      kind: 'NOT_FOUND',
      decision_id: DECISION_ID,
    });

    expect(result.kind).toBe('NOT_FOUND');
  });

  it('surfaces LIMIT_EXCEEDED', async () => {
    const result = await expectMutationSurfacedOnce({
      kind: 'LIMIT_EXCEEDED',
      reason: 'OPERATION_COUNT',
    });

    expect(result.kind).toBe('LIMIT_EXCEEDED');
  });

  it('surfaces INFRASTRUCTURE_ERROR as a safe typed result', async () => {
    const result = await expectMutationSurfacedOnce({
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: false,
      safe_code: 'SCHEMA_VERSION_UNSUPPORTED',
    });

    expect(result.kind).toBe('INFRASTRUCTURE_ERROR');
  });

  it('performs no automatic retry for any non-applied outcome', async () => {
    const outcomes: ApplyDecisionMutationResult[] = [
      {
        kind: 'STALE_VERSION',
        applied: false,
        reason: 'STALE_VERSION',
        current_version: 9,
        canonical_state: referenceCanonical(),
      },
      {
        kind: 'IDEMPOTENT_REPLAY',
        applied: false,
        reason: 'IDEMPOTENT_REPLAY',
        operation_id: OPERATION_ID,
        committed_version: 4,
        canonical_state: referenceCanonical(),
      },
      {
        kind: 'OPERATION_ID_CONFLICT',
        applied: false,
        reason: 'OPERATION_ID_CONFLICT',
        operation_id: OPERATION_ID,
        current_version: 9,
        canonical_state: referenceCanonical(),
      },
      {kind: 'NOT_FOUND', decision_id: DECISION_ID},
      {kind: 'LIMIT_EXCEEDED', reason: 'OPERATION_COUNT'},
      {
        kind: 'INFRASTRUCTURE_ERROR',
        retryable: true,
        safe_code: 'THROTTLING',
      },
    ];

    for (const scripted of outcomes) {
      const {mutations} = await finalizedMutationInput(scripted);
      expect(mutations).toHaveLength(1);
    }
  });
});

describe('Decorda F6C end-to-end with the in-memory store', () => {
  it('persists exactly one confirmed replan and reloads it durably', async () => {
    const store = await createDurableDecision();
    const flow = await beginOrThrow(store);
    expect(flow.base_version).toBe(1);
    const approved = fullyApprovedFlow(
      selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
    );

    const outcome = await finalizeAndPersistDurableScopedReplan(
      store,
      approved,
      'op-f6c-e2e-1',
    );

    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind !== 'APPLIED') {
      throw new Error(`expected APPLIED, received ${outcome.kind}`);
    }
    expect(outcome.committed_version).toBe(2);
    expect(outcome.next_plan.version).toBe(2);

    const reloaded = await store.loadDecision(DECISION_ID);
    if (reloaded.kind !== 'FOUND') {
      throw new Error(`expected FOUND, received ${reloaded.kind}`);
    }
    expect(reloaded.canonical_state.version).toBe(2);
    expect(reloaded.canonical_state.selected_candidate_id).toBe(museumOptionId);
    expect(reloaded.canonical_state.confirmed_plan).toEqual({
      plan_id: 'plan-saturday-activity',
      version: 2,
      confirmation_state: 'confirmed',
      selected_components: [
        {component_id: AFFECTED_COMPONENT, option_id: museumOptionId},
        {component_id: PRESERVED_COMPONENT, option_id: museumOptionId},
      ],
    });
    expect(reloaded.canonical_state.participant_responses).toEqual(
      allApprovedResponses(),
    );
    expect(reloaded.canonical_state.fixture_state).toEqual(
      initialDecisionState.fixture_state,
    );
  });

  it('replays the same finalized operation as IDEMPOTENT_REPLAY, not a new write', async () => {
    const store = await createDurableDecision();
    const flow = await beginOrThrow(store);
    const approved = fullyApprovedFlow(
      selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
    );
    const first = await finalizeAndPersistDurableScopedReplan(
      store,
      approved,
      'op-f6c-e2e-replay',
    );
    expect(first.kind).toBe('APPLIED');

    const replay = await finalizeAndPersistDurableScopedReplan(
      store,
      approved,
      'op-f6c-e2e-replay',
    );

    expect(replay.kind).toBe('MUTATION_NOT_APPLIED');
    if (replay.kind !== 'MUTATION_NOT_APPLIED') {
      throw new Error(`expected MUTATION_NOT_APPLIED, received ${replay.kind}`);
    }
    expect(replay.result).toEqual({
      kind: 'IDEMPOTENT_REPLAY',
      applied: false,
      reason: 'IDEMPOTENT_REPLAY',
      operation_id: 'op-f6c-e2e-replay',
      committed_version: 2,
      canonical_state: {
        ...durableApprovedSnapshot(),
        selected_candidate_id: museumOptionId,
        confirmed_plan: {
          plan_id: 'plan-saturday-activity',
          version: 2,
          confirmation_state: 'confirmed',
          selected_components: [
            {component_id: AFFECTED_COMPONENT, option_id: museumOptionId},
            {component_id: PRESERVED_COMPONENT, option_id: museumOptionId},
          ],
        },
        decision_id: DECISION_ID,
        version: 2,
      },
    });
  });

  it('surfaces STALE_VERSION when the canonical version moved on, writing nothing', async () => {
    const store = await createDurableDecision();
    const flow = await beginOrThrow(store);
    const bumped = await store.applyMutation({
      decision_id: DECISION_ID,
      operation_id: 'op-external-bump',
      base_version: 1,
      mutation: {kind: 'SELECT_CANDIDATE', candidate_id: museumOptionId},
      next_state: durableApprovedSnapshot(),
    });
    expect(bumped.kind).toBe('APPLIED');
    const approved = fullyApprovedFlow(
      selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
    );

    const outcome = await finalizeAndPersistDurableScopedReplan(
      store,
      approved,
      'op-f6c-e2e-stale',
    );

    expect(outcome.kind).toBe('MUTATION_NOT_APPLIED');
    if (outcome.kind !== 'MUTATION_NOT_APPLIED') {
      throw new Error(`expected MUTATION_NOT_APPLIED, received ${outcome.kind}`);
    }
    expect(outcome.result.kind).toBe('STALE_VERSION');
    if (outcome.result.kind !== 'STALE_VERSION') {
      throw new Error('expected STALE_VERSION');
    }
    expect(outcome.result.current_version).toBe(2);

    const reloaded = await store.loadDecision(DECISION_ID);
    if (reloaded.kind !== 'FOUND') {
      throw new Error(`expected FOUND, received ${reloaded.kind}`);
    }
    expect(reloaded.canonical_state.version).toBe(2);
    expect(reloaded.canonical_state.confirmed_plan?.version).toBe(1);
  });

  it('surfaces OPERATION_ID_CONFLICT for a reused operation id without inventing one', async () => {
    const store = await createDurableDecision();
    const bumped = await store.applyMutation({
      decision_id: DECISION_ID,
      operation_id: 'op-f6c-e2e-conflict',
      base_version: 1,
      mutation: {kind: 'SELECT_CANDIDATE', candidate_id: museumOptionId},
      next_state: durableApprovedSnapshot(),
    });
    expect(bumped.kind).toBe('APPLIED');
    const flow = await beginOrThrow(store);
    const approved = fullyApprovedFlow(
      selectOrThrow(flow, AFFECTED_COMPONENT, museumOptionId),
    );

    const outcome = await finalizeAndPersistDurableScopedReplan(
      store,
      approved,
      'op-f6c-e2e-conflict',
    );

    expect(outcome.kind).toBe('MUTATION_NOT_APPLIED');
    if (outcome.kind !== 'MUTATION_NOT_APPLIED') {
      throw new Error(`expected MUTATION_NOT_APPLIED, received ${outcome.kind}`);
    }
    expect(outcome.result.kind).toBe('OPERATION_ID_CONFLICT');
    if (outcome.result.kind !== 'OPERATION_ID_CONFLICT') {
      throw new Error('expected OPERATION_ID_CONFLICT');
    }
    expect(outcome.result.operation_id).toBe('op-f6c-e2e-conflict');
  });

  it('returns the non-ready outcome for a durable decision without a confirmed plan', async () => {
    const store = new InMemoryDecisionStore();
    const created = await store.createDecision({
      decision_id: DECISION_ID,
      initial_state: {
        selected_candidate_id: null,
        participant_responses: initialDecisionState.participant_responses.map(
          (response) => ({...response}),
        ),
        confirmed_plan: null,
        fixture_state: initialDecisionState.fixture_state,
      },
      expires_at: 1_800_000_000,
    });
    expect(created.kind).toBe('CREATED');

    const outcome = await beginDurableScopedReplan(
      store,
      DECISION_ID,
      referenceInputs,
    );

    expect(outcome).toEqual({
      kind: 'NO_CONFIRMED_PLAN',
      decision_id: DECISION_ID,
    });
    const reloaded = await store.loadDecision(DECISION_ID);
    expect(reloaded.kind === 'FOUND' && reloaded.canonical_state.version).toBe(1);
  });

  it('surfaces NOT_FOUND for an unknown durable decision', async () => {
    const store = new InMemoryDecisionStore();

    const outcome = await beginDurableScopedReplan(
      store,
      'decision-never-created',
      referenceInputs,
    );

    expect(outcome).toEqual({
      kind: 'DECISION_NOT_FOUND',
      decision_id: 'decision-never-created',
    });
  });
});
