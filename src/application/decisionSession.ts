import type {
  CandidateOptionId,
  ParticipantId,
  ParticipantResponseState,
} from '../domain/types';
import type {DurableScopedReplanFlow} from './replanningFlow';
import type {CanonicalLifecycleResult, MutationIdentity} from './decisionLifecycle';
import type {DecisionStore} from './decisionStore';
import {
  confirmCanonicalPlan,
  openCanonicalDecision,
  selectCanonicalCandidate,
  setCanonicalParticipantResponse,
  startReferenceDecision,
} from './decisionLifecycle';
import {
  beginDurableScopedReplan,
  finalizeAndPersistDurableScopedReplan,
  recordDurableScopedResponse,
  selectDurableScopedReplacement,
} from './replanningFlow';
import {
  referenceCandidateOptions,
  referenceConstraints,
  referenceParticipants,
  syntheticContextChange,
} from '../domain/fixtures';
import {REFERENCE_DECISION_ID} from '../domain/decisionScenario';

export type DecisionSessionMode = 'local_fixture' | 'durable_https';

export type ScopedReplanResult =
  | Readonly<{kind: 'REPLAN_READY'; flow: DurableScopedReplanFlow}>
  | Readonly<{kind: 'CANONICAL'; result: CanonicalLifecycleResult}>
  | Readonly<{
      kind: 'REPLAN_REJECTED';
      reason: 'NOT_FOUND' | 'NO_CONFIRMED_PLAN' | 'NO_REPLAN_REQUIRED' | 'LOAD_FAILED' | 'INVALID_DRAFT' | 'SESSION_EXPIRED';
    }>;

export interface DecisionSession {
  readonly mode: DecisionSessionMode;
  readonly modeLabel: string;
  open(): Promise<CanonicalLifecycleResult>;
  startFixture(): Promise<CanonicalLifecycleResult>;
  selectCandidate(
    identity: MutationIdentity,
    candidate_id: CandidateOptionId,
  ): Promise<CanonicalLifecycleResult>;
  setParticipantResponse(
    identity: MutationIdentity,
    participant_id: ParticipantId,
    response_state: ParticipantResponseState,
  ): Promise<CanonicalLifecycleResult>;
  confirmPlan(identity: MutationIdentity): Promise<CanonicalLifecycleResult>;
  beginScopedReplan(): Promise<ScopedReplanResult>;
  confirmScopedReplan(
    operation_id: string,
    flow: DurableScopedReplanFlow,
  ): Promise<ScopedReplanResult>;
}

export function createVersionScopedOperationId(
  client_id: string,
  base_version: number,
  action: string,
  payload: string,
): string {
  const safe = `${client_id}:v${base_version}:${action}:${payload}`;
  if (safe.length > 128) {
    throw new Error('Operation identity exceeds the bounded envelope');
  }
  return safe;
}

export function createStoreDecisionSession(options: Readonly<{
  store: DecisionStore;
  expires_at: number;
  mode?: DecisionSessionMode;
  modeLabel?: string;
  now?: () => number;
}>): DecisionSession {
  const {store, expires_at} = options;
  const expired = (): boolean =>
    options.now !== undefined && options.now() >= expires_at;
  const lifecycle = <T extends unknown[]>(
    action: (...args: T) => Promise<CanonicalLifecycleResult>,
  ) => (...args: T): Promise<CanonicalLifecycleResult> =>
    expired() ? Promise.resolve({kind: 'EXPIRED'}) : action(...args);
  return {
    mode: options.mode ?? 'local_fixture',
    modeLabel:
      options.modeLabel ??
      'Local fixture · process-lifetime persistence · zero network requests',
    open: lifecycle(() => openCanonicalDecision(store)),
    startFixture: lifecycle(() => startReferenceDecision(store, expires_at)),
    selectCandidate: lifecycle((identity, candidate_id) =>
      selectCanonicalCandidate(store, identity, candidate_id),
    ),
    setParticipantResponse: lifecycle((identity, participant_id, response_state) =>
      setCanonicalParticipantResponse(
        store,
        identity,
        participant_id,
        response_state,
      ),
    ),
    confirmPlan: lifecycle(identity => confirmCanonicalPlan(store, identity)),
    beginScopedReplan: async () => {
      if (expired()) {
        return {kind: 'REPLAN_REJECTED', reason: 'SESSION_EXPIRED'};
      }
      const outcome = await beginDurableScopedReplan(
        store,
        REFERENCE_DECISION_ID,
        {
          context_change: syntheticContextChange,
          candidates: referenceCandidateOptions,
          constraints: referenceConstraints,
          participant_ids: referenceParticipants.map(participant => participant.id),
        },
      );
      if (outcome.kind === 'REPLAN_REQUIRED') {
        return {kind: 'REPLAN_READY', flow: outcome.flow};
      }
      if (outcome.kind === 'NO_REPLAN_REQUIRED') {
        return {kind: 'REPLAN_REJECTED', reason: 'NO_REPLAN_REQUIRED'};
      }
      if (outcome.kind === 'DECISION_NOT_FOUND') {
        return {kind: 'REPLAN_REJECTED', reason: 'NOT_FOUND'};
      }
      if (outcome.kind === 'NO_CONFIRMED_PLAN') {
        return {kind: 'REPLAN_REJECTED', reason: 'NO_CONFIRMED_PLAN'};
      }
      return {kind: 'REPLAN_REJECTED', reason: 'LOAD_FAILED'};
    },
    confirmScopedReplan: async (operation_id, flow) => {
      if (expired()) {
        return {kind: 'REPLAN_REJECTED', reason: 'SESSION_EXPIRED'};
      }
      const begun = await beginDurableScopedReplan(
        store,
        REFERENCE_DECISION_ID,
        {
          context_change: syntheticContextChange,
          candidates: referenceCandidateOptions,
          constraints: referenceConstraints,
          participant_ids: referenceParticipants.map(participant => participant.id),
        },
      );
      const same = (left: unknown, right: unknown): boolean =>
        JSON.stringify(left) === JSON.stringify(right);
      if (
        begun.kind !== 'REPLAN_REQUIRED' ||
        begun.flow.base_version !== flow.base_version ||
        flow.decision_id !== begun.flow.decision_id ||
        !same(flow.canonical_state, begun.flow.canonical_state) ||
        flow.replan.original_plan_id !== begun.flow.replan.original_plan_id ||
        flow.replan.original_version !== begun.flow.replan.original_version ||
        !same(flow.replan.original_components, begun.flow.replan.original_components) ||
        !same(flow.replan.impact, begun.flow.replan.impact) ||
        !same(flow.replan.preserved_components, begun.flow.replan.preserved_components) ||
        !same(flow.replan.affected_components, begun.flow.replan.affected_components) ||
        !same(flow.replan.eligible_replacements, begun.flow.replan.eligible_replacements) ||
        !same(flow.replan.participant_ids, begun.flow.replan.participant_ids) ||
        flow.replan.selected_replacements.length !== 1 ||
        flow.replan.renewed_responses.length !== referenceParticipants.length
      ) {
        return {kind: 'REPLAN_REJECTED', reason: 'INVALID_DRAFT'};
      }
      const selection = flow.replan.selected_replacements[0];
      const selected = selectDurableScopedReplacement(
        begun.flow,
        selection.component_id,
        selection.option_id,
      );
      if (selected.kind !== 'REPLACEMENT_SELECTED') {
        return {kind: 'REPLAN_REJECTED', reason: 'INVALID_DRAFT'};
      }
      let validated = selected.flow;
      const participant_ids = new Set<string>();
      for (const participant of flow.replan.renewed_responses) {
        if (
          participant.response_state !== 'approved' ||
          participant_ids.has(participant.participant_id)
        ) {
          return {kind: 'REPLAN_REJECTED', reason: 'INVALID_DRAFT'};
        }
        participant_ids.add(participant.participant_id);
        const recorded = recordDurableScopedResponse(
          validated,
          participant.participant_id,
          participant.response_state,
        );
        if (recorded.kind !== 'RESPONSE_RECORDED') {
          return {kind: 'REPLAN_REJECTED', reason: 'INVALID_DRAFT'};
        }
        validated = recorded.flow;
      }
      const outcome = await finalizeAndPersistDurableScopedReplan(
        store,
        validated,
        operation_id,
      );
      if (outcome.kind === 'APPLIED') {
        return {
          kind: 'CANONICAL',
          result: {
            kind: 'CANONICAL',
            outcome: 'APPLIED',
            canonical_state: outcome.canonical_state,
            committed_version: outcome.committed_version,
          },
        };
      }
      if (outcome.kind === 'MUTATION_NOT_APPLIED') {
        const result = outcome.result;
        if (
          result.kind === 'STALE_VERSION' ||
          result.kind === 'IDEMPOTENT_REPLAY' ||
          result.kind === 'OPERATION_ID_CONFLICT'
        ) {
          return {
            kind: 'CANONICAL',
            result: {
              kind:
                result.kind === 'OPERATION_ID_CONFLICT'
                  ? 'OPERATION_ID_CONFLICT'
                  : 'CANONICAL',
              ...(result.kind === 'OPERATION_ID_CONFLICT'
                ? {canonical_state: result.canonical_state}
                : {
                    outcome:
                      result.kind === 'STALE_VERSION' ? 'STALE' : 'REPLAYED',
                    canonical_state: result.canonical_state,
                    ...(result.kind === 'IDEMPOTENT_REPLAY'
                      ? {committed_version: result.committed_version}
                      : {}),
                  }),
            } as CanonicalLifecycleResult,
          };
        }
      }
      return {kind: 'REPLAN_REJECTED', reason: 'INVALID_DRAFT'};
    },
  };
}
