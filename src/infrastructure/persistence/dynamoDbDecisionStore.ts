import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type {
  AttributeValue,
  DynamoDBClient,
  GetItemCommandInput,
  GetItemCommandOutput,
  PutItemCommandInput,
  UpdateItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import type {
  ApplyDecisionMutationInput,
  ApplyDecisionMutationResult,
  CanonicalDecisionState,
  CreateDecisionInput,
  CreateDecisionResult,
  DecisionStore,
  LoadDecisionResult,
  OperationReceipt,
  PersistenceFailure,
} from '../../application/decisionStore';
import {
  MAX_OPERATION_ID_UTF8_BYTES,
  MAX_OPERATION_RECEIPTS,
} from '../../application/decisionStore';
import type {DecisionId} from '../../domain/types';
import type {DynamoDbDecisionItem} from './dynamoDbTypes';
import {
  buildGetDecisionItemRequest,
  buildPutDecisionItemRequest,
  buildUpdateDecisionItemRequest,
} from './dynamoDbRequests';
import type {
  DynamoAttributeValue,
  DynamoItemMap,
} from './dynamoDbSerialization';
import {
  deserializeDecisionItem,
  DynamoDbSerializationError,
  enforceDecisionItemEnvelope,
} from './dynamoDbSerialization';
import {computeMutationFingerprint} from './mutationFingerprint';

export type DynamoDbDecisionClient = Pick<DynamoDBClient, 'send'>;

export type DynamoDbDecisionStoreOptions = Readonly<{
  client: DynamoDbDecisionClient;
  tableName: string;
}>;

type ReadItemResult =
  | Readonly<{kind: 'FOUND'; item: DynamoDbDecisionItem}>
  | Readonly<{kind: 'NOT_FOUND'}>
  | Readonly<{kind: 'FAILURE'; failure: PersistenceFailure}>;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code_point = character.codePointAt(0);
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
  operation_id: string,
  base_version: number,
): PersistenceFailure | null {
  if (
    operation_id.length === 0 ||
    utf8ByteLength(operation_id) > MAX_OPERATION_ID_UTF8_BYTES ||
    !Number.isSafeInteger(base_version) ||
    base_version <= 0
  ) {
    return {kind: 'LIMIT_EXCEEDED', reason: 'INPUT_BOUNDS'};
  }
  return null;
}

function toSdkAttributeValue(value: DynamoAttributeValue): AttributeValue {
  if ('S' in value) {
    return {S: value.S};
  }
  if ('N' in value) {
    return {N: value.N};
  }
  if ('BOOL' in value) {
    return {BOOL: value.BOOL};
  }
  if ('NULL' in value) {
    return {NULL: value.NULL};
  }
  if ('L' in value) {
    return {L: value.L.map(toSdkAttributeValue)};
  }
  return {M: toSdkItem(value.M)};
}

function toSdkItem(item: DynamoItemMap): Record<string, AttributeValue> {
  return Object.fromEntries(
    Object.entries(item).map(([name, value]) => [
      name,
      toSdkAttributeValue(value),
    ]),
  );
}

function toCanonicalState(item: DynamoDbDecisionItem): CanonicalDecisionState {
  return {
    decision_id: item.decision_id,
    version: item.version,
    selected_candidate_id: item.selected_candidate_id,
    participant_responses: item.participant_responses,
    confirmed_plan: item.confirmed_plan,
    fixture_state: item.fixture_state,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAwsError(error: unknown): PersistenceFailure {
  const name =
    isRecord(error) && typeof error.name === 'string' ? error.name : '';
  const metadata =
    isRecord(error) && isRecord(error.$metadata) ? error.$metadata : {};
  const status =
    typeof metadata.httpStatusCode === 'number'
      ? metadata.httpStatusCode
      : undefined;
  const retryable =
    (isRecord(error) && isRecord(error.$retryable)) ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    [
      'InternalServerError',
      'ProvisionedThroughputExceededException',
      'RequestLimitExceeded',
      'ThrottlingException',
    ].includes(name);

  let safe_code = 'DYNAMODB_REQUEST_FAILED';
  if (
    [
      'ProvisionedThroughputExceededException',
      'RequestLimitExceeded',
      'ThrottlingException',
    ].includes(name) ||
    status === 429
  ) {
    safe_code = 'DYNAMODB_THROTTLED';
  } else if (
    name === 'AccessDeniedException' ||
    name === 'UnrecognizedClientException'
  ) {
    safe_code = 'DYNAMODB_ACCESS_DENIED';
  } else if (name === 'ValidationException') {
    safe_code = 'DYNAMODB_VALIDATION_ERROR';
  } else if (
    name === 'InternalServerError' ||
    (status !== undefined && status >= 500)
  ) {
    safe_code = 'DYNAMODB_UNAVAILABLE';
  }

  return {kind: 'INFRASTRUCTURE_ERROR', retryable, safe_code};
}

function outgoingSerializationFailure(
  error: unknown,
): PersistenceFailure | null {
  if (!(error instanceof DynamoDbSerializationError)) {
    return null;
  }
  if (error.code === 'SERIALIZATION_ENVELOPE_EXCEEDED') {
    return {kind: 'LIMIT_EXCEEDED', reason: 'ITEM_SIZE'};
  }
  return {kind: 'LIMIT_EXCEEDED', reason: 'INPUT_BOUNDS'};
}

function invalidStoredItemFailure(): PersistenceFailure {
  return {
    kind: 'INFRASTRUCTURE_ERROR',
    retryable: false,
    safe_code: 'DYNAMODB_ITEM_INVALID',
  };
}

export class DynamoDbDecisionStore implements DecisionStore {
  private readonly client: DynamoDbDecisionClient;
  private readonly tableName: string;

  constructor(options: DynamoDbDecisionStoreOptions) {
    if (options.tableName.length === 0) {
      throw new Error('tableName must be non-empty');
    }
    this.client = options.client;
    this.tableName = options.tableName;
  }

  async loadDecision(decision_id: DecisionId): Promise<LoadDecisionResult> {
    const read = await this.readItem(decision_id);
    if (read.kind === 'FAILURE') {
      return read.failure;
    }
    if (read.kind === 'NOT_FOUND') {
      return {kind: 'NOT_FOUND', decision_id};
    }
    return {kind: 'FOUND', canonical_state: toCanonicalState(read.item)};
  }

  async createDecision(
    input: CreateDecisionInput,
  ): Promise<CreateDecisionResult> {
    let request: PutItemCommandInput;
    try {
      const built = buildPutDecisionItemRequest(this.tableName, input);
      request = {
        ...built,
        Item: toSdkItem(built.Item),
        ExpressionAttributeNames: {...built.ExpressionAttributeNames},
      };
    } catch (error) {
      return outgoingSerializationFailure(error) ?? normalizeAwsError(error);
    }

    try {
      await this.client.send(new PutItemCommand(request));
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        return normalizeAwsError(error);
      }
      const existing = await this.readItem(input.decision_id);
      if (existing.kind === 'FAILURE') {
        return existing.failure;
      }
      if (existing.kind === 'NOT_FOUND') {
        return {
          kind: 'INFRASTRUCTURE_ERROR',
          retryable: false,
          safe_code: 'DYNAMODB_CONDITION_STATE_MISSING',
        };
      }
      return {
        kind: 'ALREADY_EXISTS',
        canonical_state: toCanonicalState(existing.item),
      };
    }

    const refreshed = await this.readItem(input.decision_id);
    if (refreshed.kind === 'FAILURE') {
      return refreshed.failure;
    }
    if (refreshed.kind === 'NOT_FOUND') {
      return {
        kind: 'INFRASTRUCTURE_ERROR',
        retryable: true,
        safe_code: 'DYNAMODB_POST_WRITE_MISSING',
      };
    }
    return {
      kind: 'CREATED',
      canonical_state: toCanonicalState(refreshed.item),
    };
  }

  async applyMutation(
    input: ApplyDecisionMutationInput,
  ): Promise<ApplyDecisionMutationResult> {
    const bounds_failure = inputBoundsFailure(
      input.operation_id,
      input.base_version,
    );
    if (bounds_failure) {
      return bounds_failure;
    }

    const fingerprint = computeMutationFingerprint({
      base_version: input.base_version,
      mutation: input.mutation,
      next_state: input.next_state,
    });
    const committed_version = input.base_version + 1;
    const receipt: OperationReceipt = {
      operation_id: input.operation_id,
      mutation_fingerprint: fingerprint,
      committed_version,
    };

    let built: ReturnType<typeof buildUpdateDecisionItemRequest>;
    try {
      built = buildUpdateDecisionItemRequest({
        base_version: input.base_version,
        receipt,
        next_state: input.next_state,
      });
    } catch (error) {
      return outgoingSerializationFailure(error) ?? normalizeAwsError(error);
    }

    const size_preflight = await this.readItem(input.decision_id);
    if (size_preflight.kind === 'FAILURE') {
      return size_preflight.failure;
    }
    if (
      size_preflight.kind === 'FOUND' &&
      size_preflight.item.version === input.base_version &&
      !size_preflight.item.operation_ids.includes(input.operation_id) &&
      size_preflight.item.operation_receipts.length < MAX_OPERATION_RECEIPTS
    ) {
      const complete_next_item: DynamoDbDecisionItem = {
        ...size_preflight.item,
        ...input.next_state,
        version: committed_version,
        operation_ids: [
          ...size_preflight.item.operation_ids,
          input.operation_id,
        ],
        operation_receipts: [
          ...size_preflight.item.operation_receipts,
          receipt,
        ],
      };
      try {
        enforceDecisionItemEnvelope(complete_next_item);
      } catch (error) {
        return outgoingSerializationFailure(error) ?? normalizeAwsError(error);
      }
    }

    const request: UpdateItemCommandInput = {
      TableName: this.tableName,
      Key: {decision_id: {S: input.decision_id}},
      ConditionExpression: built.ConditionExpression,
      UpdateExpression: built.UpdateExpression,
      ExpressionAttributeNames: {...built.ExpressionAttributeNames},
      ExpressionAttributeValues: Object.fromEntries(
        Object.entries(built.ExpressionAttributeValues).map(([name, value]) => [
          name,
          toSdkAttributeValue(value),
        ]),
      ),
      ReturnValues: built.ReturnValues,
    };

    try {
      await this.client.send(new UpdateItemCommand(request));
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        return normalizeAwsError(error);
      }
      return this.classifyConditionalFailure(input, fingerprint);
    }

    const refreshed = await this.readItem(input.decision_id);
    if (refreshed.kind === 'FAILURE') {
      return refreshed.failure;
    }
    if (refreshed.kind === 'NOT_FOUND') {
      return {
        kind: 'INFRASTRUCTURE_ERROR',
        retryable: true,
        safe_code: 'DYNAMODB_POST_WRITE_MISSING',
      };
    }
    return {
      kind: 'APPLIED',
      applied: true,
      operation_id: input.operation_id,
      committed_version,
      canonical_state: toCanonicalState(refreshed.item),
    };
  }

  private async classifyConditionalFailure(
    input: ApplyDecisionMutationInput,
    fingerprint: string,
  ): Promise<ApplyDecisionMutationResult> {
    const refreshed = await this.readItem(input.decision_id);
    if (refreshed.kind === 'FAILURE') {
      return refreshed.failure;
    }
    if (refreshed.kind === 'NOT_FOUND') {
      return {kind: 'NOT_FOUND', decision_id: input.decision_id};
    }

    const canonical_state = toCanonicalState(refreshed.item);
    const existing_receipt = refreshed.item.operation_receipts.find(
      (candidate) => candidate.operation_id === input.operation_id,
    );
    if (existing_receipt) {
      if (existing_receipt.mutation_fingerprint === fingerprint) {
        return {
          kind: 'IDEMPOTENT_REPLAY',
          applied: false,
          reason: 'IDEMPOTENT_REPLAY',
          operation_id: input.operation_id,
          committed_version: existing_receipt.committed_version,
          canonical_state,
        };
      }
      return {
        kind: 'OPERATION_ID_CONFLICT',
        applied: false,
        reason: 'OPERATION_ID_CONFLICT',
        operation_id: input.operation_id,
        current_version: refreshed.item.version,
        canonical_state,
      };
    }
    if (refreshed.item.version !== input.base_version) {
      return {
        kind: 'STALE_VERSION',
        applied: false,
        reason: 'STALE_VERSION',
        current_version: refreshed.item.version,
        canonical_state,
      };
    }
    if (refreshed.item.operation_receipts.length >= MAX_OPERATION_RECEIPTS) {
      return {kind: 'LIMIT_EXCEEDED', reason: 'OPERATION_COUNT'};
    }
    return {
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: false,
      safe_code: 'DYNAMODB_CONDITION_UNEXPLAINED',
    };
  }

  private async readItem(decision_id: DecisionId): Promise<ReadItemResult> {
    let request: GetItemCommandInput;
    try {
      const built = buildGetDecisionItemRequest(this.tableName, decision_id);
      request = {
        ...built,
        Key: toSdkItem(built.Key),
      };
    } catch (error) {
      return {
        kind: 'FAILURE',
        failure:
          outgoingSerializationFailure(error) ?? normalizeAwsError(error),
      };
    }

    let response: GetItemCommandOutput;
    try {
      response = (await this.client.send(
        new GetItemCommand(request),
      )) as GetItemCommandOutput;
    } catch (error) {
      return {kind: 'FAILURE', failure: normalizeAwsError(error)};
    }
    if (response.Item === undefined) {
      return {kind: 'NOT_FOUND'};
    }
    try {
      return {
        kind: 'FOUND',
        item: deserializeDecisionItem(
          response.Item as unknown as DynamoItemMap,
        ),
      };
    } catch {
      return {kind: 'FAILURE', failure: invalidStoredItemFailure()};
    }
  }
}
