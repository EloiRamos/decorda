import type {
  CreateDecisionInput,
  DecisionSnapshot,
  OperationReceipt,
} from '../../application/decisionStore';
import {MAX_OPERATION_RECEIPTS} from '../../application/decisionStore';
import type {DecisionId} from '../../domain/types';
import type {DynamoDbDecisionItem} from './dynamoDbTypes';
import {
  DynamoDbSerializationError,
  enforceDecisionItemEnvelope,
  serializeDecisionItem,
  serializeDecisionSnapshotFields,
  serializeOperationReceipt,
} from './dynamoDbSerialization';
import type {
  DynamoAttributeValue,
  DynamoItemMap,
  DynamoString,
} from './dynamoDbSerialization';

// Pure P3 request objects only: no AWS command classes, no client.send, no
// region/credentials/retry/endpoint configuration anywhere in this module.
// P4 composes these plain objects into SDK commands.

export type DynamoDbGetItemRequest = Readonly<{
  TableName: string;
  Key: Readonly<{decision_id: DynamoString}>;
  ConsistentRead: true;
}>;

export type DynamoDbPutItemRequest = Readonly<{
  TableName: string;
  Item: DynamoItemMap;
  ConditionExpression: string;
  ExpressionAttributeNames: Readonly<Record<string, string>>;
  ReturnValues: 'NONE';
}>;

// Exactly the five frozen members of the PERSISTENCE-001 update request
// shape. TableName and Key composition is P4 adapter responsibility; the
// frozen P3 shape does not include them.
export type DynamoDbUpdateItemRequest = Readonly<{
  ConditionExpression: string;
  UpdateExpression: string;
  ExpressionAttributeNames: Readonly<Record<string, string>>;
  ExpressionAttributeValues: Readonly<Record<string, DynamoAttributeValue>>;
  ReturnValues: 'NONE';
}>;

// Modeled minimal Get response: presence of the low-level item only. No SDK
// exception classes and no service-error normalization live here (P4 owns
// that boundary).
export type DynamoDbGetItemResponse = Readonly<{Item?: DynamoItemMap}>;

const CREATE_CONDITION_EXPRESSION = 'attribute_not_exists(#decision_id)';
const CREATE_EXPRESSION_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  '#decision_id': 'decision_id',
};
const UPDATE_CONDITION_EXPRESSION =
  '#version = :base_version AND NOT contains(#operation_ids, :operation_id) AND size(#operation_ids) < :maximum_operations';
const UPDATE_UPDATE_EXPRESSION =
  'SET #selected_candidate_id = :selected_candidate_id, #participant_responses = :participant_responses, #confirmed_plan = :confirmed_plan, #fixture_state = :fixture_state, #version = #version + :one, #operation_ids = list_append(#operation_ids, :operation_ids_append), #operation_receipts = list_append(#operation_receipts, :operation_receipts_append)';
const UPDATE_EXPRESSION_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  '#version': 'version',
  '#selected_candidate_id': 'selected_candidate_id',
  '#participant_responses': 'participant_responses',
  '#confirmed_plan': 'confirmed_plan',
  '#fixture_state': 'fixture_state',
  '#operation_ids': 'operation_ids',
  '#operation_receipts': 'operation_receipts',
};

function assertTableName(table_name: string): void {
  if (typeof table_name !== 'string' || table_name.length === 0) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      'table_name must be a non-empty string',
    );
  }
}

function assertDecisionId(decision_id: DecisionId): void {
  if (typeof decision_id !== 'string' || decision_id.length === 0) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      'decision_id must be a non-empty string',
    );
  }
}

function assertBaseVersion(base_version: number): void {
  if (typeof base_version !== 'number' || !Number.isFinite(base_version)) {
    throw new DynamoDbSerializationError(
      'NON_FINITE_NUMBER',
      'base_version must be a finite number',
    );
  }
  if (!Number.isInteger(base_version)) {
    throw new DynamoDbSerializationError(
      'NOT_AN_INTEGER',
      'base_version must be an integer',
    );
  }
  if (!Number.isSafeInteger(base_version)) {
    throw new DynamoDbSerializationError(
      'UNSAFE_INTEGER',
      'base_version must be a safe integer',
    );
  }
  if (base_version <= 0) {
    throw new DynamoDbSerializationError(
      'NOT_A_POSITIVE_INTEGER',
      'base_version must be a positive integer',
    );
  }
}

// Always strongly consistent; the canonical refresh path has no eventually
// consistent variant and no GSI/global-table support.
export function buildGetDecisionItemRequest(
  table_name: string,
  decision_id: DecisionId,
): DynamoDbGetItemRequest {
  assertTableName(table_name);
  assertDecisionId(decision_id);
  return {
    TableName: table_name,
    Key: {decision_id: {S: decision_id}},
    ConsistentRead: true,
  };
}

function buildInitialDecisionItem(
  input: CreateDecisionInput,
): DynamoDbDecisionItem {
  const initial_state = input.initial_state;
  return {
    decision_id: input.decision_id,
    schema_version: 1,
    version: 1,
    selected_candidate_id: initial_state.selected_candidate_id,
    participant_responses: initial_state.participant_responses,
    confirmed_plan: initial_state.confirmed_plan,
    fixture_state: initial_state.fixture_state,
    operation_ids: [],
    operation_receipts: [],
    expires_at: input.expires_at,
  };
}

// Conditional create: never overwrites an existing decision. The builder
// possesses the complete initial item, so the project-level 32 KiB
// serialization-envelope guard is enforced honestly here.
export function buildPutDecisionItemRequest(
  table_name: string,
  input: CreateDecisionInput,
): DynamoDbPutItemRequest {
  assertTableName(table_name);
  const initial_item = buildInitialDecisionItem(input);
  enforceDecisionItemEnvelope(initial_item);
  return {
    TableName: table_name,
    Item: serializeDecisionItem(initial_item),
    ConditionExpression: CREATE_CONDITION_EXPRESSION,
    ExpressionAttributeNames: CREATE_EXPRESSION_ATTRIBUTE_NAMES,
    ReturnValues: 'NONE',
  };
}

export type DynamoDbUpdateRequestInput = Readonly<{
  base_version: number;
  // Fully formed P2 receipt: P3 serializes it, it never re-hashes.
  receipt: OperationReceipt;
  // Complete validated next state; P3 runs no feasibility/consensus logic.
  next_state: DecisionSnapshot;
}>;

// Full-state replacement over the exact base version, with bounded
// idempotency append. The operation ID and committed version always come
// from the supplied receipt so the condition, the append list, and the
// stored receipt cannot diverge. The builder does not possess the current
// receipt metadata of the stored item, so it does not measure or claim to
// enforce the final complete-item size (P4 integration responsibility).
export function buildUpdateDecisionItemRequest(
  input: DynamoDbUpdateRequestInput,
): DynamoDbUpdateItemRequest {
  assertBaseVersion(input.base_version);
  const receipt_map = serializeOperationReceipt(input.receipt);
  const snapshot_fields = serializeDecisionSnapshotFields(input.next_state);
  return {
    ConditionExpression: UPDATE_CONDITION_EXPRESSION,
    UpdateExpression: UPDATE_UPDATE_EXPRESSION,
    ExpressionAttributeNames: UPDATE_EXPRESSION_ATTRIBUTE_NAMES,
    ExpressionAttributeValues: {
      ':base_version': {N: String(input.base_version)},
      ':operation_id': {S: input.receipt.operation_id},
      ':maximum_operations': {N: String(MAX_OPERATION_RECEIPTS)},
      ':selected_candidate_id': snapshot_fields.selected_candidate_id,
      ':participant_responses': snapshot_fields.participant_responses,
      ':confirmed_plan': snapshot_fields.confirmed_plan,
      ':fixture_state': snapshot_fields.fixture_state,
      ':one': {N: '1'},
      ':operation_ids_append': {L: [{S: input.receipt.operation_id}]},
      ':operation_receipts_append': {L: [receipt_map]},
    },
    ReturnValues: 'NONE',
  };
}

function isStringAttributeValue(value: unknown): value is DynamoString {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 1 &&
    typeof (value as {S?: unknown}).S === 'string'
  );
}

function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

const ATTRIBUTE_DISCRIMINANTS = ['S', 'N', 'BOOL', 'NULL', 'L', 'M'] as const;

function isAttributeValueShaped(value: unknown): boolean {
  if (!isPlainObjectValue(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    (ATTRIBUTE_DISCRIMINANTS as readonly string[]).includes(keys[0])
  );
}

// Tiny pure modeled helpers: request-object completeness checks used by
// tests and by P4 as cheap structural assertions.
export function isCompleteGetDecisionItemRequest(value: unknown): boolean {
  if (!isPlainObjectValue(value) || Object.keys(value).length !== 3) {
    return false;
  }
  const key = (value as {Key?: unknown}).Key;
  return (
    typeof value.TableName === 'string' &&
    value.TableName.length > 0 &&
    isPlainObjectValue(key) &&
    Object.keys(key).length === 1 &&
    isStringAttributeValue((key as Record<string, unknown>).decision_id) &&
    value.ConsistentRead === true
  );
}

export function isCompletePutDecisionItemRequest(value: unknown): boolean {
  if (!isPlainObjectValue(value) || Object.keys(value).length !== 5) {
    return false;
  }
  const typed = value as {
    TableName: unknown;
    Item: unknown;
    ConditionExpression: unknown;
    ExpressionAttributeNames: unknown;
    ReturnValues: unknown;
  };
  if (
    typeof typed.TableName !== 'string' ||
    typed.TableName.length === 0 ||
    !isPlainObjectValue(typed.Item) ||
    Object.keys(typed.Item).length === 0
  ) {
    return false;
  }
  for (const attribute of Object.values(typed.Item)) {
    if (!isAttributeValueShaped(attribute)) {
      return false;
    }
  }
  const names = typed.ExpressionAttributeNames;
  return (
    typed.ConditionExpression === 'attribute_not_exists(#decision_id)' &&
    isPlainObjectValue(names) &&
    Object.keys(names).length === 1 &&
    names['#decision_id'] === 'decision_id' &&
    typed.ReturnValues === 'NONE'
  );
}

export function isCompleteUpdateDecisionItemRequest(value: unknown): boolean {
  if (!isPlainObjectValue(value) || Object.keys(value).length !== 5) {
    return false;
  }
  const typed = value as {
    ConditionExpression: unknown;
    UpdateExpression: unknown;
    ExpressionAttributeNames: unknown;
    ExpressionAttributeValues: unknown;
    ReturnValues: unknown;
  };
  if (
    typed.ConditionExpression !== UPDATE_CONDITION_EXPRESSION ||
    typeof typed.UpdateExpression !== 'string' ||
    !typed.UpdateExpression.startsWith('SET ') ||
    !isPlainObjectValue(typed.ExpressionAttributeNames) ||
    !isPlainObjectValue(typed.ExpressionAttributeValues)
  ) {
    return false;
  }
  for (const alias of Object.keys(UPDATE_EXPRESSION_ATTRIBUTE_NAMES)) {
    if (
      (typed.ExpressionAttributeNames as Record<string, unknown>)[alias] !==
      UPDATE_EXPRESSION_ATTRIBUTE_NAMES[alias]
    ) {
      return false;
    }
  }
  for (const value_entry of Object.values(typed.ExpressionAttributeValues)) {
    if (!isAttributeValueShaped(value_entry)) {
      return false;
    }
  }
  return typed.ReturnValues === 'NONE';
}

// Detects whether a modeled Get response carries a low-level item.
export function getResponseHasItem(response: DynamoDbGetItemResponse): boolean {
  return response.Item !== undefined;
}

// Extracts the low-level item map from a modeled Get response, or null when
// the item is absent. Never throws and never mutates the response.
export function extractGetItemResponseItem(
  response: DynamoDbGetItemResponse,
): DynamoItemMap | null {
  return response.Item === undefined ? null : response.Item;
}
