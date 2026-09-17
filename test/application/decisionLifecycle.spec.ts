import {confirmCanonicalPlan, openCanonicalDecision, selectCanonicalCandidate, setCanonicalParticipantResponse, startReferenceDecision} from '../../src/application/decisionLifecycle';
import {createStoreDecisionSession} from '../../src/application/decisionSession';
import {recordDurableScopedResponse, selectDurableScopedReplacement} from '../../src/application/replanningFlow';
import {referenceParticipants} from '../../src/domain/fixtures';
import {InMemoryDecisionStore} from '../../src/infrastructure/persistence/inMemoryDecisionStore';

function identity(base_version: number, operation_id: string) {
  return {base_version, operation_id};
}

describe('canonical decision lifecycle', () => {
  let store: InMemoryDecisionStore;
  beforeEach(() => {store = new InMemoryDecisionStore({now: () => 100});});

  it('opens without creating and offers explicit conditional creation', async () => {
    expect(await openCanonicalDecision(store)).toEqual({kind: 'NOT_FOUND', decision_id: 'decision-saturday-activity'});
    const created = await startReferenceDecision(store, 200);
    expect(created.kind).toBe('CANONICAL');
    if (created.kind === 'CANONICAL') expect(created.canonical_state.confirmed_plan).toBeNull();
    const existing = await startReferenceDecision(store, 200);
    expect(existing.kind === 'CANONICAL' && existing.outcome).toBe('ALREADY_EXISTS');
  });

  it('persists selection and four responses but commits only on Confirm', async () => {
    await startReferenceDecision(store, 200);
    await selectCanonicalCandidate(store, identity(1, 'op-select'), 'option-riverside-picnic');
    for (const [index, participant] of referenceParticipants.entries()) {
      const result = await setCanonicalParticipantResponse(store, identity(index + 2, `op-response-${index}`), participant.id, 'approved');
      expect(result.kind).toBe('CANONICAL');
    }
    const ready = await openCanonicalDecision(store);
    expect(ready.kind === 'CANONICAL' && ready.canonical_state.confirmed_plan).toBeNull();
    const confirmed = await confirmCanonicalPlan(store, identity(6, 'op-confirm'));
    expect(confirmed.kind).toBe('CANONICAL');
    if (confirmed.kind === 'CANONICAL') {
      expect(confirmed.committed_version).toBe(7);
      expect(confirmed.canonical_state.confirmed_plan?.version).toBe(1);
      expect(confirmed.canonical_state.confirmed_plan?.selected_components).toEqual([
        {component_id: 'component-activity', option_id: 'option-riverside-picnic'},
        {component_id: 'component-return-arrangement', option_id: 'option-riverside-picnic'},
      ]);
    }
  });

  it('rejects infeasible, unknown, pending, premature, and post-confirm actions', async () => {
    await startReferenceDecision(store, 200);
    expect((await selectCanonicalCandidate(store, identity(1, 'a'), 'option-forest-course')).kind).toBe('REJECTED');
    expect((await selectCanonicalCandidate(store, identity(1, 'b'), 'option-unknown')).kind).toBe('REJECTED');
    expect((await setCanonicalParticipantResponse(store, identity(1, 'c'), 'participant-alex', 'pending')).kind).toBe('REJECTED');
    expect((await confirmCanonicalPlan(store, identity(1, 'd'))).kind).toBe('REJECTED');
  });

  it('preserves replay and stale canonical outcomes without retry', async () => {
    await startReferenceDecision(store, 200);
    const first = await selectCanonicalCandidate(store, identity(1, 'stable-op'), 'option-riverside-picnic');
    const replay = await selectCanonicalCandidate(store, identity(1, 'stable-op'), 'option-riverside-picnic');
    const stale = await selectCanonicalCandidate(store, identity(1, 'other-op'), 'option-museum-workshop');
    expect(first.kind === 'CANONICAL' && first.outcome).toBe('APPLIED');
    expect(replay.kind === 'CANONICAL' && replay.outcome).toBe('REPLAYED');
    expect(stale.kind === 'CANONICAL' && stale.outcome).toBe('STALE');
  });

  it('loads on a fresh client and applies scoped replan over that same plan', async () => {
    const session = createStoreDecisionSession({store, expires_at: 200});
    await session.startFixture();
    await session.selectCandidate(identity(1, 's'), 'option-riverside-picnic');
    for (const [index, participant] of referenceParticipants.entries()) await session.setParticipantResponse(identity(index + 2, `r${index}`), participant.id, 'approved');
    await session.confirmPlan(identity(6, 'c'));
    const fresh = createStoreDecisionSession({store, expires_at: 200});
    const opened = await fresh.open();
    expect(opened.kind === 'CANONICAL' && opened.canonical_state.confirmed_plan?.version).toBe(1);
    const begun = await fresh.beginScopedReplan();
    expect(begun.kind).toBe('REPLAN_READY');
    if (begun.kind !== 'REPLAN_READY') return;
    const selected = selectDurableScopedReplacement(begun.flow, 'component-activity', 'option-museum-workshop');
    expect(selected.kind).toBe('REPLACEMENT_SELECTED');
    if (selected.kind !== 'REPLACEMENT_SELECTED') return;
    let flow = selected.flow;
    for (const participant of referenceParticipants) {
      const recorded = recordDurableScopedResponse(flow, participant.id, 'approved');
      expect(recorded.kind).toBe('RESPONSE_RECORDED');
      if (recorded.kind === 'RESPONSE_RECORDED') flow = recorded.flow;
    }
    const tampered = {
      ...flow,
      replan: {...flow.replan, preserved_components: []},
    };
    expect(await fresh.confirmScopedReplan('tampered-op', tampered)).toEqual({
      kind: 'REPLAN_REJECTED',
      reason: 'INVALID_DRAFT',
    });
    const applied = await fresh.confirmScopedReplan('replan-op', flow);
    expect(applied.kind).toBe('CANONICAL');
    const reopened = await createStoreDecisionSession({store, expires_at: 200}).open();
    if (reopened.kind === 'CANONICAL') {
      expect(reopened.canonical_state.confirmed_plan?.version).toBe(2);
      expect(reopened.canonical_state.confirmed_plan?.selected_components).toEqual([
        {component_id: 'component-activity', option_id: 'option-museum-workshop'},
        {component_id: 'component-return-arrangement', option_id: 'option-riverside-picnic'},
      ]);
    }
  });
});
