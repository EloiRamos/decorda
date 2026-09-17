import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {createStoreDecisionSession} from '../../application/decisionSession';
import {DynamoDbDecisionStore} from '../persistence/dynamoDbDecisionStore';
import type {DynamoDbDecisionClient} from '../persistence/dynamoDbDecisionStore';
import {createDecisionHandler} from './decisionHandler';

export type DecisionBackendConfig = Readonly<{
  tableName: string;
  expiresAtEpochSeconds: number;
  client?: DynamoDbDecisionClient;
  now?: () => number;
}>;

export function createDynamoDecisionHandler(config: DecisionBackendConfig) {
  if (
    config.tableName.length === 0 ||
    !Number.isSafeInteger(config.expiresAtEpochSeconds) ||
    config.expiresAtEpochSeconds <= 0
  ) {
    throw new Error('Invalid decision backend configuration');
  }
  const client = config.client ?? new DynamoDBClient({maxAttempts: 1});
  const store = new DynamoDbDecisionStore({client, tableName: config.tableName});
  const session = createStoreDecisionSession({
    store,
    expires_at: config.expiresAtEpochSeconds,
    mode: 'durable_https',
    modeLabel: 'Durable HTTPS session · canonical server-side state',
    now: config.now ?? (() => Math.floor(Date.now() / 1000)),
  });
  return createDecisionHandler(session);
}
