import {createDecisionHandler} from '../../../src/infrastructure/server/decisionHandler';
import {createStoreDecisionSession} from '../../../src/application/decisionSession';
import {InMemoryDecisionStore} from '../../../src/infrastructure/persistence/inMemoryDecisionStore';

function handler() {
  return createDecisionHandler(createStoreDecisionSession({store: new InMemoryDecisionStore({now: () => 1}), expires_at: 100}));
}

describe('Lambda-compatible decision handler', () => {
  it('rejects missing, base64, malformed, oversized, and unknown requests', async () => {
    const route = handler();
    for (const event of [{}, {body: '{}', isBase64Encoded: true}, {body: '{'}, {body: 'x'.repeat(32769)}, {body: '{"kind":"UNKNOWN"}'}]) {
      expect((await route(event)).statusCode).toBe(400);
    }
  });

  it.each([
    {},
    {body: '{}', isBase64Encoded: true},
    {body: '{'},
    {body: 'x'.repeat(32769)},
    {body: '{"kind":"UNKNOWN"}'},
  ])('rejects one malformed request shape without dispatch', async event => {
    expect((await handler()(event)).statusCode).toBe(400);
  });

  it.each([
    {kind: 'SELECT_CANDIDATE', identity: {}, candidate_id: 'option-riverside-picnic'},
    {kind: 'SELECT_CANDIDATE', identity: {base_version: 0, operation_id: 'x'}, candidate_id: 'option-riverside-picnic'},
    {kind: 'SET_PARTICIPANT_RESPONSE', identity: {base_version: 1, operation_id: 'x'}, participant_id: 'participant-alex', response_state: 'pending'},
    {kind: 'CONFIRM_PLAN', identity: {base_version: 1, operation_id: ''}},
    {kind: 'CONFIRM_SCOPED_REPLAN', operation_id: 'x'.repeat(129), flow: {}},
  ])('rejects malformed command fields', async command => {
    expect((await handler()({body: JSON.stringify(command)})).statusCode).toBe(400);
  });

  it('dispatches validated commands through application state', async () => {
    const route = handler();
    const call = async (body: unknown) => JSON.parse((await route({body: JSON.stringify(body)})).body);
    expect((await call({kind: 'OPEN'})).kind).toBe('NOT_FOUND');
    expect((await call({kind: 'START_FIXTURE'})).outcome).toBe('CREATED');
    expect((await call({kind: 'SELECT_CANDIDATE', identity: {base_version: 1, operation_id: 'select'}, candidate_id: 'option-riverside-picnic'})).outcome).toBe('APPLIED');
    expect((await call({kind: 'SET_PARTICIPANT_RESPONSE', identity: {base_version: 2, operation_id: 'bad'}, participant_id: 'participant-alex', response_state: 'pending'})).kind).toBe('INVALID_REQUEST');
  });

  it('does not depend on handler memory across fresh instances over one store', async () => {
    const store = new InMemoryDecisionStore({now: () => 1});
    const first = createDecisionHandler(createStoreDecisionSession({store, expires_at: 100}));
    const second = createDecisionHandler(createStoreDecisionSession({store, expires_at: 100}));
    await first({body: '{"kind":"START_FIXTURE"}'});
    const loaded = JSON.parse((await second({body: '{"kind":"OPEN"}'})).body);
    expect(loaded.outcome).toBe('LOADED');
  });
});
