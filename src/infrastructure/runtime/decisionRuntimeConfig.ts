/* global globalThis */
export type LocalDecisionRuntimeConfig = Readonly<{
  mode: 'local_fixture';
  expiresAtEpochSeconds: number;
  clientId: string;
}>;

export type DurableDecisionRuntimeConfig = Readonly<{
  mode: 'durable_https';
  endpoint: string;
  expiresAtEpochSeconds: number;
  clientId: string;
}>;

export type DecisionRuntimeConfig =
  | LocalDecisionRuntimeConfig
  | DurableDecisionRuntimeConfig;

declare global {
  // A public, launch-time TV configuration object. It must contain no AWS
  // credentials, table names, account identifiers, or private endpoint data
  // in tracked source. A launcher may inject the HTTPS URL at runtime.
  var __DECORDA_RUNTIME_CONFIG__: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validCommon(value: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(value.expiresAtEpochSeconds) &&
    (value.expiresAtEpochSeconds as number) > 0 &&
    typeof value.clientId === 'string' &&
    value.clientId.length > 0 &&
    value.clientId.length <= 32
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export function readDecisionRuntimeConfig(
  injected: unknown = globalThis.__DECORDA_RUNTIME_CONFIG__,
): DecisionRuntimeConfig | null {
  if (!isRecord(injected) || !validCommon(injected)) {
    return null;
  }
  if (
    injected.mode === 'local_fixture' &&
    hasOnlyKeys(injected, ['mode', 'expiresAtEpochSeconds', 'clientId'])
  ) {
    return injected as LocalDecisionRuntimeConfig;
  }
  if (
    injected.mode === 'durable_https' &&
    typeof injected.endpoint === 'string' &&
    /^https:\/\//.test(injected.endpoint) &&
    injected.endpoint.length <= 2048 &&
    hasOnlyKeys(injected, [
      'mode',
      'endpoint',
      'expiresAtEpochSeconds',
      'clientId',
    ])
  ) {
    return injected as DurableDecisionRuntimeConfig;
  }
  return null;
}

export function defaultLocalDecisionRuntimeConfig(
  nowEpochSeconds: number,
): LocalDecisionRuntimeConfig {
  return {
    mode: 'local_fixture',
    expiresAtEpochSeconds: nowEpochSeconds + 10 * 60,
    clientId: 'tv-local',
  };
}
