import type {
  ApplyDecisionMutationInput,
  ApplyDecisionMutationResult,
  CanonicalDecisionState,
  CreateDecisionInput,
  CreateDecisionResult,
  DecisionStore,
  LoadDecisionResult,
  OperationId,
  OperationReceipt,
  PersistenceFailure,
} from '../../application/decisionStore';
import type {DecisionId} from '../../domain/types';
import {
  MAX_OPERATION_ID_UTF8_BYTES,
  MAX_OPERATION_RECEIPTS,
} from '../../application/decisionStore';
import {computeMutationFingerprint} from './mutationFingerprint';

export type InMemoryDecisionStoreOptions = Readonly<{
  // Deterministic epoch-seconds clock; defaults to the wall clock. Tests must
  // inject this so expiry never depends on uncontrolled time.
  now?: () => number;
}>;

type DecisionRecord = {
  canonical_state: CanonicalDecisionState;
  receipts: OperationReceipt[];
  expires_at: number;
};

function wallClockSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// The frozen contract data is plain JSON-safe data, so a JSON round-trip is a
// sufficient deep copy; it keeps inputs, results, and internals independent.
function plainCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code_point = char.codePointAt(0);
    if (code_point === undefined) {
      continue;
    }
    if (code_point <= 0x7f) {
      bytes += 1;
    } else if (code_point <= 0x7ff) {
      bytes += 2;
    } else if (code_point <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

function inputBoundsFailure(
  operation_id: OperationId,
  base_version: number,
): PersistenceFailure | null {
  if (operation_id.length === 0) {
    return {kind: 'LIMIT_EXCEEDED', reason: 'INPUT_BOUNDS'};
  }
  if (utf8ByteLength(operation_id) > MAX_OPERATION_ID_UTF8_BYTES) {
    return {kind: 'LIMIT_EXCEEDED', reason: 'INPUT_BOUNDS'};
  }
  if (!Number.isSafeInteger(base_version) || base_version <= 0) {
    return {kind: 'LIMIT_EXCEEDED', reason: 'INPUT_BOUNDS'};
  }
  return null;
}

// Local test fake implementing the exact DecisionStore port. Expiry is
// evaluated lazily per operation from the injected clock (no background
// timers) and no internal reference is ever handed out.
export class InMemoryDecisionStore implements DecisionStore {
  private readonly records = new Map<DecisionId, DecisionRecord>();
  private readonly now: () => number;

  constructor(options: InMemoryDecisionStoreOptions = {}) {
    this.now = options.now ?? wallClockSeconds;
  }

  createDecision(input: CreateDecisionInput): Promise<CreateDecisionResult> {
    const current_time = this.now();
    if (!Number.isSafeInteger(input.expires_at)) {
      return Promise.resolve({kind: 'LIMIT_EXCEEDED', reason: 'INPUT_BOUNDS'});
    }
    const existing = this.records.get(input.decision_id);
    if (existing && current_time < existing.expires_at) {
      return Promise.resolve({
        kind: 'ALREADY_EXISTS',
        canonical_state: plainCopy(existing.canonical_state),
      });
    }
    const canonical_state: CanonicalDecisionState = {
      ...plainCopy(input.initial_state),
      decision_id: input.decision_id,
      version: 1,
    };
    this.records.set(input.decision_id, {
      canonical_state,
      receipts: [],
      expires_at: input.expires_at,
    });
    return Promise.resolve({
      kind: 'CREATED',
      canonical_state: plainCopy(canonical_state),
    });
  }

  loadDecision(decision_id: DecisionId): Promise<LoadDecisionResult> {
    const current_time = this.now();
    const record = this.records.get(decision_id);
    if (!record || current_time >= record.expires_at) {
      return Promise.resolve({kind: 'NOT_FOUND', decision_id});
    }
    return Promise.resolve({
      kind: 'FOUND',
      canonical_state: plainCopy(record.canonical_state),
    });
  }

  applyMutation(
    input: ApplyDecisionMutationInput,
  ): Promise<ApplyDecisionMutationResult> {
    const current_time = this.now();
    const bounds_failure = inputBoundsFailure(
      input.operation_id,
      input.base_version,
    );
    if (bounds_failure) {
      return Promise.resolve(bounds_failure);
    }
    const record = this.records.get(input.decision_id);
    if (!record || current_time >= record.expires_at) {
      return Promise.resolve({
        kind: 'NOT_FOUND',
        decision_id: input.decision_id,
      });
    }
    const fingerprint = computeMutationFingerprint({
      base_version: input.base_version,
      mutation: input.mutation,
      next_state: input.next_state,
    });
    const existing_receipt = record.receipts.find(
      receipt => receipt.operation_id === input.operation_id,
    );
    if (existing_receipt) {
      if (existing_receipt.mutation_fingerprint === fingerprint) {
        return Promise.resolve({
          kind: 'IDEMPOTENT_REPLAY',
          applied: false,
          reason: 'IDEMPOTENT_REPLAY',
          operation_id: input.operation_id,
          committed_version: existing_receipt.committed_version,
          canonical_state: plainCopy(record.canonical_state),
        });
      }
      return Promise.resolve({
        kind: 'OPERATION_ID_CONFLICT',
        applied: false,
        reason: 'OPERATION_ID_CONFLICT',
        operation_id: input.operation_id,
        current_version: record.canonical_state.version,
        canonical_state: plainCopy(record.canonical_state),
      });
    }
    if (input.base_version !== record.canonical_state.version) {
      return Promise.resolve({
        kind: 'STALE_VERSION',
        applied: false,
        reason: 'STALE_VERSION',
        current_version: record.canonical_state.version,
        canonical_state: plainCopy(record.canonical_state),
      });
    }
    if (record.receipts.length >= MAX_OPERATION_RECEIPTS) {
      return Promise.resolve({
        kind: 'LIMIT_EXCEEDED',
        reason: 'OPERATION_COUNT',
      });
    }
    const committed_version = input.base_version + 1;
    record.canonical_state = {
      ...plainCopy(input.next_state),
      decision_id: input.decision_id,
      version: committed_version,
    };
    record.receipts.push({
      operation_id: input.operation_id,
      mutation_fingerprint: fingerprint,
      committed_version,
    });
    return Promise.resolve({
      kind: 'APPLIED',
      applied: true,
      operation_id: input.operation_id,
      committed_version,
      canonical_state: plainCopy(record.canonical_state),
    });
  }
}
