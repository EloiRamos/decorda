import type {CanonicalDecisionState} from './decisionStore';
import type {DecisionSession} from './decisionSession';

export const DECISION_REFRESH_INTERVAL_MS = 2000;

export type DecisionRefreshScheduler = Readonly<{
  setInterval(callback: () => void, delay_ms: number): unknown;
  clearInterval(handle: unknown): void;
}>;

export type DecisionRefreshOptions = Readonly<{
  session: DecisionSession;
  scheduler: DecisionRefreshScheduler;
  now: () => number;
  expires_at_ms: number;
  maximum_reads: number;
  initial_version: number;
  canRead: () => boolean;
  onCanonical: (state: CanonicalDecisionState) => void;
  onStop: (reason: 'ERROR' | 'EXPIRED' | 'READ_LIMIT') => void;
}>;

export type DecisionRefreshController = Readonly<{
  start(): void;
  stop(): void;
  getReadCount(): number;
}>;

export function createDecisionRefreshController(
  options: DecisionRefreshOptions,
): DecisionRefreshController {
  let handle: unknown = null;
  let in_flight = false;
  let read_count = 0;
  let last_seen_version = options.initial_version;

  const stop = (): void => {
    if (handle !== null) {
      options.scheduler.clearInterval(handle);
      handle = null;
    }
  };

  const tick = async (): Promise<void> => {
    if (in_flight || !options.canRead()) {
      return;
    }
    if (options.now() >= options.expires_at_ms) {
      stop();
      options.onStop('EXPIRED');
      return;
    }
    if (read_count >= options.maximum_reads) {
      stop();
      options.onStop('READ_LIMIT');
      return;
    }
    in_flight = true;
    read_count += 1;
    try {
      const result = await options.session.open();
      if (result.kind !== 'CANONICAL') {
        stop();
        options.onStop('ERROR');
        return;
      }
      if (result.canonical_state.version > last_seen_version) {
        last_seen_version = result.canonical_state.version;
        options.onCanonical(result.canonical_state);
      }
    } catch {
      stop();
      options.onStop('ERROR');
    } finally {
      in_flight = false;
    }
  };

  return {
    start: () => {
      if (handle === null) {
        handle = options.scheduler.setInterval(
          () => {
            tick().catch(() => undefined);
          },
          DECISION_REFRESH_INTERVAL_MS,
        );
      }
    },
    stop,
    getReadCount: () => read_count,
  };
}
