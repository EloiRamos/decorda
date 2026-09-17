import {createDecisionSession} from '../../../src/infrastructure/runtime/createDecisionSession';
import {readDecisionRuntimeConfig} from '../../../src/infrastructure/runtime/decisionRuntimeConfig';

describe('decision runtime composition', () => {
  it('selects deterministic local mode with zero HTTP requests', async () => {
    const transport = jest.fn();
    const composition = createDecisionSession({config: {mode: 'local_fixture', expiresAtEpochSeconds: 100, clientId: 'local'}, transport, now: () => 1});
    expect(composition.kind).toBe('READY');
    if (composition.kind === 'READY') {
      expect(composition.session.mode).toBe('local_fixture');
      await composition.session.open();
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('selects HTTPS mode only with valid explicit configuration and transport', () => {
    const config = readDecisionRuntimeConfig({mode: 'durable_https', endpoint: 'https://example.invalid/decision', expiresAtEpochSeconds: 100, clientId: 'tv'});
    const ready = createDecisionSession({config, transport: jest.fn()});
    expect(ready.kind === 'READY' && ready.session.mode).toBe('durable_https');
    expect(createDecisionSession({config}).kind).toBe('INVALID_CONFIGURATION');
  });

  it('fails visibly at the authorized local session expiry', async () => {
    const composition = createDecisionSession({
      config: {
        mode: 'local_fixture',
        expiresAtEpochSeconds: 100,
        clientId: 'local',
      },
      now: () => 100,
    });
    expect(composition.kind).toBe('READY');
    if (composition.kind === 'READY') {
      expect(await composition.session.open()).toEqual({kind: 'EXPIRED'});
    }
  });

  it('rejects invalid durable endpoints instead of silently using memory', () => {
    expect(readDecisionRuntimeConfig({mode: 'durable_https', endpoint: 'http://insecure.invalid', expiresAtEpochSeconds: 100, clientId: 'tv'})).toBeNull();
    expect(createDecisionSession({config: null}).kind).toBe('INVALID_CONFIGURATION');
  });

  it.each([
    undefined,
    {},
    {mode: 'local_fixture', expiresAtEpochSeconds: 0, clientId: 'tv'},
    {mode: 'local_fixture', expiresAtEpochSeconds: 100, clientId: ''},
    {mode: 'durable_https', endpoint: 'ws://example.invalid', expiresAtEpochSeconds: 100, clientId: 'tv'},
    {mode: 'durable_https', endpoint: 'https://example.invalid', expiresAtEpochSeconds: 100, clientId: 'tv', awsSecret: 'forbidden'},
  ])('fails closed for malformed or expanded launch configuration', value => {
    expect(readDecisionRuntimeConfig(value)).toBeNull();
  });
});
