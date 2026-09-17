import {createDecisionRefreshController, DECISION_REFRESH_INTERVAL_MS} from '../../src/application/decisionRefresh';
import type {DecisionSession} from '../../src/application/decisionSession';

function session(open: jest.Mock): DecisionSession {
  return {mode: 'local_fixture', modeLabel: 'test', open, startFixture: jest.fn(), selectCandidate: jest.fn(), setParticipantResponse: jest.fn(), confirmPlan: jest.fn(), beginScopedReplan: jest.fn(), confirmScopedReplan: jest.fn()};
}

describe('bounded decision refresh', () => {
  const canonical = (version: number) => ({
    kind: 'CANONICAL' as const,
    outcome: 'LOADED' as const,
    canonical_state: {
      decision_id: 'decision-x' as const,
      version,
      selected_candidate_id: null,
      participant_responses: [],
      confirmed_plan: null,
      fixture_state: {
        source: 'synthetic_fixture' as const,
        scenario: 'saturday_activity' as const,
        constraint_ids: [],
        candidate_option_ids: [],
        context_change_ids: [],
      },
    },
  });
  it('uses exactly 2000 ms, single flight, last-seen updates, and cleanup', async () => {
    let callback: (() => void) | null = null;
    let resolve!: (value: unknown) => void;
    const open = jest.fn(() => new Promise(value => {resolve = value;}));
    const scheduler = {setInterval: jest.fn((next: () => void, delay: number) => {callback = next; expect(delay).toBe(DECISION_REFRESH_INTERVAL_MS); return 1;}), clearInterval: jest.fn()};
    const onCanonical = jest.fn();
    const controller = createDecisionRefreshController({session: session(open), scheduler, now: () => 0, expires_at_ms: 10000, maximum_reads: 3, initial_version: 1, canRead: () => true, onCanonical, onStop: jest.fn()});
    controller.start();
    callback!(); callback!();
    expect(open).toHaveBeenCalledTimes(1);
    resolve({kind: 'CANONICAL', outcome: 'LOADED', canonical_state: {decision_id: 'decision-x', version: 2, selected_candidate_id: null, participant_responses: [], confirmed_plan: null, fixture_state: {source: 'synthetic_fixture', scenario: 'saturday_activity', constraint_ids: [], candidate_option_ids: [], context_change_ids: []}}});
    await Promise.resolve();
    expect(onCanonical).toHaveBeenCalledTimes(1);
    controller.stop();
    expect(scheduler.clearInterval).toHaveBeenCalledWith(1);
  });

  it('skips blocked ticks and stops at expiry, errors, and read ceiling', async () => {
    let callback = () => {};
    const onStop = jest.fn();
    let allowed = false;
    const open = jest.fn().mockResolvedValue({kind: 'NOT_FOUND', decision_id: 'decision-saturday-activity'});
    const controller = createDecisionRefreshController({session: session(open), scheduler: {setInterval: next => {callback = next; return 1;}, clearInterval: jest.fn()}, now: () => 0, expires_at_ms: 10, maximum_reads: 1, initial_version: 1, canRead: () => allowed, onCanonical: jest.fn(), onStop});
    controller.start(); callback(); expect(open).not.toHaveBeenCalled();
    allowed = true; callback(); await Promise.resolve(); await Promise.resolve();
    expect(onStop).toHaveBeenCalledWith('ERROR');
  });

  it('does not announce an unchanged canonical version', async () => {
    let callback = () => {};
    const onCanonical = jest.fn();
    const controller = createDecisionRefreshController({session: session(jest.fn().mockResolvedValue(canonical(3))), scheduler: {setInterval: next => {callback = next; return 1;}, clearInterval: jest.fn()}, now: () => 0, expires_at_ms: 10, maximum_reads: 2, initial_version: 3, canRead: () => true, onCanonical, onStop: jest.fn()});
    controller.start(); callback(); await Promise.resolve(); await Promise.resolve();
    expect(onCanonical).not.toHaveBeenCalled();
  });

  it('stops before an expired session performs a read', () => {
    let callback = () => {};
    const open = jest.fn();
    const onStop = jest.fn();
    const controller = createDecisionRefreshController({session: session(open), scheduler: {setInterval: next => {callback = next; return 1;}, clearInterval: jest.fn()}, now: () => 10, expires_at_ms: 10, maximum_reads: 2, initial_version: 1, canRead: () => true, onCanonical: jest.fn(), onStop});
    controller.start(); callback();
    expect(open).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledWith('EXPIRED');
  });

  it('never exceeds the hard read ceiling', async () => {
    let callback = () => {};
    const open = jest.fn().mockResolvedValue(canonical(1));
    const onStop = jest.fn();
    const controller = createDecisionRefreshController({session: session(open), scheduler: {setInterval: next => {callback = next; return 1;}, clearInterval: jest.fn()}, now: () => 0, expires_at_ms: 10, maximum_reads: 1, initial_version: 1, canRead: () => true, onCanonical: jest.fn(), onStop});
    controller.start(); callback(); await Promise.resolve(); await Promise.resolve(); callback();
    expect(open).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith('READ_LIMIT');
  });

  it('normalizes a thrown read as a terminal refresh error', async () => {
    let callback = () => {};
    const onStop = jest.fn();
    const controller = createDecisionRefreshController({session: session(jest.fn().mockRejectedValue(new Error('offline'))), scheduler: {setInterval: next => {callback = next; return 1;}, clearInterval: jest.fn()}, now: () => 0, expires_at_ms: 10, maximum_reads: 2, initial_version: 1, canRead: () => true, onCanonical: jest.fn(), onStop});
    controller.start(); callback(); await Promise.resolve(); await Promise.resolve();
    expect(onStop).toHaveBeenCalledWith('ERROR');
  });
});
