import type {DecisionSession} from '../../application/decisionSession';
import {createStoreDecisionSession} from '../../application/decisionSession';
import {InMemoryDecisionStore} from '../persistence/inMemoryDecisionStore';
import {
  createHttpDecisionSession,
  type DecisionHttpTransport,
} from '../network/httpDecisionSession';
import type {DecisionRuntimeConfig} from './decisionRuntimeConfig';

export type DecisionSessionComposition =
  | Readonly<{kind: 'READY'; session: DecisionSession; clientId: string; expiresAtEpochSeconds: number}>
  | Readonly<{kind: 'INVALID_CONFIGURATION'; message: string}>;

export function createDecisionSession(options: Readonly<{
  config: DecisionRuntimeConfig | null;
  transport?: DecisionHttpTransport;
  now?: () => number;
}>): DecisionSessionComposition {
  const config = options.config;
  if (config === null) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Decision runtime configuration is missing or invalid.',
    };
  }
  if (config.mode === 'local_fixture') {
    const now = options.now ?? (() => Math.floor(Date.now() / 1000));
    return {
      kind: 'READY',
      session: createStoreDecisionSession({
        store: new InMemoryDecisionStore({now}),
        expires_at: config.expiresAtEpochSeconds,
        now,
      }),
      clientId: config.clientId,
      expiresAtEpochSeconds: config.expiresAtEpochSeconds,
    };
  }
  if (options.transport === undefined) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Durable HTTPS mode requires an available transport.',
    };
  }
  return {
    kind: 'READY',
    session: createHttpDecisionSession({
      endpoint: config.endpoint,
      transport: options.transport,
    }),
    clientId: config.clientId,
    expiresAtEpochSeconds: config.expiresAtEpochSeconds,
  };
}
