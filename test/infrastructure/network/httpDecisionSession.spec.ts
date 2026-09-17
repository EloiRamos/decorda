import {createHttpDecisionSession, MAX_HTTP_DECISION_BODY_BYTES} from '../../../src/infrastructure/network/httpDecisionSession';
import {createDecisionHandler} from '../../../src/infrastructure/server/decisionHandler';
import {createStoreDecisionSession} from '../../../src/application/decisionSession';
import {InMemoryDecisionStore} from '../../../src/infrastructure/persistence/inMemoryDecisionStore';

describe('HTTP decision session', () => {
  it('sends bounded POST JSON and returns canonical results', async () => {
    const transport = jest.fn().mockResolvedValue({status: 200, text: async () => JSON.stringify({kind: 'NOT_FOUND', decision_id: 'decision-saturday-activity'})});
    const session = createHttpDecisionSession({endpoint: 'https://example.invalid/decision', transport});
    expect(await session.open()).toEqual({kind: 'NOT_FOUND', decision_id: 'decision-saturday-activity'});
    expect(transport).toHaveBeenCalledWith('https://example.invalid/decision', expect.objectContaining({method: 'POST', body: '{"kind":"OPEN"}'}));
    expect(MAX_HTTP_DECISION_BODY_BYTES).toBe(32768);
  });

  it.each([
    {status: 500, text: async () => '{}'},
    {status: 200, text: async () => 'not-json'},
    {status: 200, text: async () => '{}'},
  ])('fails safely for malformed or failed responses', async response => {
    const session = createHttpDecisionSession({endpoint: 'https://example.invalid', transport: async () => response});
    expect(await session.open()).toEqual({kind: 'INFRASTRUCTURE_ERROR', retryable: false, safe_code: 'DECISION_SERVICE_UNAVAILABLE'});
  });

  it('does not retry a transport failure', async () => {
    const transport = jest.fn().mockRejectedValue(new Error('lost'));
    const session = createHttpDecisionSession({endpoint: 'https://example.invalid', transport});
    await session.confirmPlan({base_version: 1, operation_id: 'stable'});
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('traverses fresh HTTP clients and handlers over the same canonical store', async () => {
    const store = new InMemoryDecisionStore({now: () => 1});
    const transportFor = () => async (_url: string, init: {body: string}) => {
      const route = createDecisionHandler(createStoreDecisionSession({store, expires_at: 100}));
      const result = await route({body: init.body});
      return {status: result.statusCode, text: async () => result.body};
    };
    const first = createHttpDecisionSession({endpoint: 'https://example.invalid', transport: transportFor()});
    const second = createHttpDecisionSession({endpoint: 'https://example.invalid', transport: transportFor()});
    expect((await first.startFixture()).kind).toBe('CANONICAL');
    const selected = await first.selectCandidate({base_version: 1, operation_id: 'shared-select'}, 'option-riverside-picnic');
    expect(selected.kind === 'CANONICAL' && selected.outcome).toBe('APPLIED');
    const opened = await second.open();
    expect(opened.kind === 'CANONICAL' && opened.canonical_state.selected_candidate_id).toBe('option-riverside-picnic');
  });

  it('recovers a lost response by replaying the exact identity after recreation', async () => {
    const store = new InMemoryDecisionStore({now: () => 1});
    await createStoreDecisionSession({store, expires_at: 100}).startFixture();
    const lostTransport = async (_url: string, init: {body: string}) => {
      const route = createDecisionHandler(createStoreDecisionSession({store, expires_at: 100}));
      await route({body: init.body});
      throw new Error('response lost after commit');
    };
    const first = createHttpDecisionSession({endpoint: 'https://example.invalid', transport: lostTransport});
    expect((await first.selectCandidate({base_version: 1, operation_id: 'lost-op'}, 'option-riverside-picnic')).kind).toBe('INFRASTRUCTURE_ERROR');
    const replayTransport = async (_url: string, init: {body: string}) => {
      const route = createDecisionHandler(createStoreDecisionSession({store, expires_at: 100}));
      const result = await route({body: init.body});
      return {status: result.statusCode, text: async () => result.body};
    };
    const recreated = createHttpDecisionSession({endpoint: 'https://example.invalid', transport: replayTransport});
    const replay = await recreated.selectCandidate({base_version: 1, operation_id: 'lost-op'}, 'option-riverside-picnic');
    expect(replay.kind === 'CANONICAL' && replay.outcome).toBe('REPLAYED');
  });
});
