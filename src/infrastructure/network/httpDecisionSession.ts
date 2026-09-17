import type {
  DecisionSession,
  ScopedReplanResult,
} from '../../application/decisionSession';
import type {CanonicalLifecycleResult, MutationIdentity} from '../../application/decisionLifecycle';
import type {DurableScopedReplanFlow} from '../../application/replanningFlow';
import type {
  CandidateOptionId,
  ParticipantId,
  ParticipantResponseState,
} from '../../domain/types';

export const MAX_HTTP_DECISION_BODY_BYTES = 32 * 1024;

export type DecisionHttpResponse = Readonly<{
  status: number;
  text(): Promise<string>;
}>;

export type DecisionHttpTransport = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
  }>,
) => Promise<DecisionHttpResponse>;

type HttpCommand =
  | Readonly<{kind: 'OPEN'}>
  | Readonly<{kind: 'START_FIXTURE'}>
  | Readonly<{kind: 'SELECT_CANDIDATE'; identity: MutationIdentity; candidate_id: CandidateOptionId}>
  | Readonly<{kind: 'SET_PARTICIPANT_RESPONSE'; identity: MutationIdentity; participant_id: ParticipantId; response_state: ParticipantResponseState}>
  | Readonly<{kind: 'CONFIRM_PLAN'; identity: MutationIdentity}>
  | Readonly<{kind: 'BEGIN_SCOPED_REPLAN'}>
  | Readonly<{kind: 'CONFIRM_SCOPED_REPLAN'; operation_id: string; flow: DurableScopedReplanFlow}>;

function byteLength(value: string): number {
  return unescape(encodeURIComponent(value)).length;
}

function transportFailure(): CanonicalLifecycleResult {
  return {
    kind: 'INFRASTRUCTURE_ERROR',
    retryable: false,
    safe_code: 'DECISION_SERVICE_UNAVAILABLE',
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLifecycleResult(value: unknown): value is CanonicalLifecycleResult {
  if (!isObject(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'EXPIRED') return true;
  if (value.kind === 'NOT_FOUND') return typeof value.decision_id === 'string';
  if (value.kind === 'LIMIT_EXCEEDED') {
    return ['ITEM_SIZE', 'OPERATION_COUNT', 'INPUT_BOUNDS'].includes(value.reason as string);
  }
  if (value.kind === 'INFRASTRUCTURE_ERROR') {
    return typeof value.retryable === 'boolean' && typeof value.safe_code === 'string';
  }
  if (!isCanonicalState(value.canonical_state)) return false;
  if (value.kind === 'OPERATION_ID_CONFLICT') return true;
  if (value.kind === 'REJECTED') return typeof value.reason === 'string';
  return (
    value.kind === 'CANONICAL' &&
    ['CREATED', 'ALREADY_EXISTS', 'LOADED', 'APPLIED', 'REPLAYED', 'STALE', 'NO_CHANGE'].includes(value.outcome as string) &&
    (value.committed_version === undefined || Number.isSafeInteger(value.committed_version))
  );
}

function isScopedResult(value: unknown): value is ScopedReplanResult {
  if (!isObject(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'CANONICAL') return isLifecycleResult(value.result);
  if (value.kind === 'REPLAN_REJECTED') return typeof value.reason === 'string';
  return value.kind === 'REPLAN_READY' && isFlow(value.flow);
}

function isCanonicalState(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.decision_id === 'string' &&
    Number.isSafeInteger(value.version) &&
    (value.version as number) > 0 &&
    (value.selected_candidate_id === null || typeof value.selected_candidate_id === 'string') &&
    Array.isArray(value.participant_responses) &&
    value.participant_responses.length <= 4 &&
    value.participant_responses.every(response =>
      isObject(response) &&
      typeof response.participant_id === 'string' &&
      ['pending', 'approved', 'rejected'].includes(response.response_state as string),
    ) &&
    (value.confirmed_plan === null || isObject(value.confirmed_plan)) &&
    isObject(value.fixture_state)
  );
}

function isFlow(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.replan)) return false;
  const replan = value.replan;
  return (
    typeof value.decision_id === 'string' &&
    Number.isSafeInteger(value.base_version) &&
    isCanonicalState(value.canonical_state) &&
    Array.isArray(replan.selected_replacements) &&
    Array.isArray(replan.renewed_responses) &&
    Array.isArray(replan.affected_components) &&
    Array.isArray(replan.preserved_components) &&
    Array.isArray(replan.eligible_replacements) &&
    Array.isArray(replan.participant_ids)
  );
}

export function createHttpDecisionSession(options: Readonly<{
  endpoint: string;
  transport: DecisionHttpTransport;
}>): DecisionSession {
  const request = async (command: HttpCommand): Promise<unknown> => {
    const body = JSON.stringify(command);
    if (byteLength(body) > MAX_HTTP_DECISION_BODY_BYTES) {
      return null;
    }
    try {
      const response = await options.transport(options.endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body,
      });
      const text = await response.text();
      if (response.status !== 200 || byteLength(text) > MAX_HTTP_DECISION_BODY_BYTES) {
        return null;
      }
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  };
  const lifecycle = async (command: HttpCommand): Promise<CanonicalLifecycleResult> => {
    const value = await request(command);
    return isLifecycleResult(value) ? value : transportFailure();
  };
  const scoped = async (command: HttpCommand): Promise<ScopedReplanResult> => {
    const value = await request(command);
    return isScopedResult(value)
      ? value
      : {kind: 'REPLAN_REJECTED', reason: 'LOAD_FAILED'};
  };
  return {
    mode: 'durable_https',
    modeLabel: 'Durable HTTPS session · canonical server-side state',
    open: () => lifecycle({kind: 'OPEN'}),
    startFixture: () => lifecycle({kind: 'START_FIXTURE'}),
    selectCandidate: (identity, candidate_id) =>
      lifecycle({kind: 'SELECT_CANDIDATE', identity, candidate_id}),
    setParticipantResponse: (identity, participant_id, response_state) =>
      lifecycle({kind: 'SET_PARTICIPANT_RESPONSE', identity, participant_id, response_state}),
    confirmPlan: identity => lifecycle({kind: 'CONFIRM_PLAN', identity}),
    beginScopedReplan: () => scoped({kind: 'BEGIN_SCOPED_REPLAN'}),
    confirmScopedReplan: (operation_id, flow) =>
      scoped({kind: 'CONFIRM_SCOPED_REPLAN', operation_id, flow}),
  };
}
