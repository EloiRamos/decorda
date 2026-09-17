import type {
  DecisionSnapshot,
  OperationReceipt,
} from '../../application/decisionStore';
import {MAX_ITEM_SIZE_BYTES} from '../../application/decisionStore';
import type {
  CandidateOptionId,
  ConfirmedPlan,
  ConstraintId,
  ContextChangeId,
  DecisionFixtureState,
  DecisionId,
  ParticipantId,
  ParticipantResponse,
  ParticipantResponseState,
  PlanComponentId,
  PlanId,
} from '../../domain/types';
import type {DynamoDbDecisionItem} from './dynamoDbTypes';

// Repository-owned low-level mirror of the DynamoDB AttributeValue shape.
// Deliberately SDK-free: the frozen PERSISTENCE-001 item needs no binary or
// set types, and `undefined` never appears below this boundary.
export type DynamoString = Readonly<{S: string}>;
export type DynamoNumber = Readonly<{N: string}>;
export type DynamoBoolean = Readonly<{BOOL: boolean}>;
export type DynamoNull = Readonly<{NULL: true}>;
export type DynamoList = Readonly<{L: readonly DynamoAttributeValue[]}>;
export type DynamoAttributeMap = Readonly<Record<string, DynamoAttributeValue>>;
export type DynamoMap = Readonly<{M: DynamoAttributeMap}>;

export type DynamoAttributeValue =
  | DynamoString
  | DynamoNumber
  | DynamoBoolean
  | DynamoNull
  | DynamoList
  | DynamoMap;

// A complete low-level item: attribute name -> AttributeValue.
export type DynamoItemMap = DynamoAttributeMap;

// Exactly one persistence schema version is supported; nothing migrates.
export const SUPPORTED_SCHEMA_VERSION = 1;

const ITEM_FIELD_NAMES = [
  'decision_id',
  'schema_version',
  'version',
  'selected_candidate_id',
  'participant_responses',
  'confirmed_plan',
  'fixture_state',
  'operation_ids',
  'operation_receipts',
  'expires_at',
] as const;

const SNAPSHOT_FIELD_NAMES = [
  'selected_candidate_id',
  'participant_responses',
  'confirmed_plan',
  'fixture_state',
] as const;

const PARTICIPANT_RESPONSE_FIELDS = [
  'participant_id',
  'response_state',
] as const;

const CONFIRMED_PLAN_FIELDS = [
  'plan_id',
  'version',
  'selected_components',
  'confirmation_state',
] as const;

const COMPONENT_REFERENCE_FIELDS = ['component_id', 'option_id'] as const;

const FIXTURE_STATE_FIELDS = [
  'source',
  'scenario',
  'constraint_ids',
  'candidate_option_ids',
  'context_change_ids',
] as const;

const RECEIPT_FIELDS = [
  'operation_id',
  'mutation_fingerprint',
  'committed_version',
] as const;

const PARTICIPANT_RESPONSE_STATES: readonly ParticipantResponseState[] = [
  'pending',
  'approved',
  'rejected',
];

const CONFIRMATION_STATES = ['confirmed'] as const;
const FIXTURE_SOURCES = ['synthetic_fixture'] as const;
const FIXTURE_SCENARIOS = ['saturday_activity'] as const;

// Deterministic internal fault strategy: serialization problems are
// programming/parse faults, so they throw exactly one small error type that
// carries a stable code. Raw AWS errors cannot exist here: P3 has no AWS.
export type DynamoDbSerializationErrorCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'UNKNOWN_TOP_LEVEL_FIELD'
  | 'UNKNOWN_FIELD'
  | 'UNDEFINED_VALUE'
  | 'NON_FINITE_NUMBER'
  | 'UNSAFE_INTEGER'
  | 'NOT_AN_INTEGER'
  | 'NOT_A_POSITIVE_INTEGER'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'MALFORMED_ATTRIBUTE_VALUE'
  | 'UNSUPPORTED_VALUE_TYPE'
  | 'WRONG_FIELD_TYPE'
  | 'SERIALIZATION_ENVELOPE_EXCEEDED';

export class DynamoDbSerializationError extends Error {
  readonly code: DynamoDbSerializationErrorCode;

  constructor(code: DynamoDbSerializationErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'DynamoDbSerializationError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObjectValue(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new DynamoDbSerializationError(
      'UNSUPPORTED_VALUE_TYPE',
      `field must be a plain object: ${field}`,
    );
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}

function requireField(
  record: Readonly<Record<string, unknown>>,
  field: string,
): unknown {
  if (!(field in record)) {
    throw new DynamoDbSerializationError(
      'MISSING_REQUIRED_FIELD',
      `missing required field: ${field}`,
    );
  }
  const value = record[field];
  if (value === undefined) {
    throw new DynamoDbSerializationError(
      'UNDEFINED_VALUE',
      `field must not be undefined: ${field}`,
    );
  }
  return value;
}

function assertItemKeys(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    if (!(ITEM_FIELD_NAMES as readonly string[]).includes(key)) {
      throw new DynamoDbSerializationError(
        'UNKNOWN_TOP_LEVEL_FIELD',
        `unknown top-level field: ${key}`,
      );
    }
  }
  for (const field of ITEM_FIELD_NAMES) {
    if (!(field in record)) {
      throw new DynamoDbSerializationError(
        'MISSING_REQUIRED_FIELD',
        `missing required field: ${field}`,
      );
    }
  }
}

function assertNestedKeys(
  record: Readonly<Record<string, unknown>>,
  path: string,
  expected: readonly string[],
): void {
  for (const key of Object.keys(record)) {
    if (!expected.includes(key)) {
      throw new DynamoDbSerializationError(
        'UNKNOWN_FIELD',
        `unknown field: ${path}.${key}`,
      );
    }
  }
  for (const field of expected) {
    if (!(field in record)) {
      throw new DynamoDbSerializationError(
        'MISSING_REQUIRED_FIELD',
        `missing required field: ${path}.${field}`,
      );
    }
  }
}

function serializeNonEmptyString(value: unknown, field: string): DynamoString {
  if (typeof value !== 'string') {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be a string: ${field}`,
    );
  }
  if (value.length === 0) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be a non-empty string: ${field}`,
    );
  }
  return {S: value};
}

function serializeEnumMember(
  value: unknown,
  field: string,
  allowed: readonly string[],
): DynamoString {
  const attribute = serializeNonEmptyString(value, field);
  if (!allowed.includes(attribute.S)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be one of ${allowed.join('|')}: ${field}`,
    );
  }
  return attribute;
}

function serializeNullableString(
  value: unknown,
  field: string,
): DynamoAttributeValue {
  if (value === null) {
    return {NULL: true};
  }
  return serializeNonEmptyString(value, field);
}

function serializeInteger(value: unknown, field: string): DynamoNumber {
  if (typeof value !== 'number') {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be a number: ${field}`,
    );
  }
  if (!Number.isFinite(value)) {
    throw new DynamoDbSerializationError(
      'NON_FINITE_NUMBER',
      `field must be a finite number: ${field}`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new DynamoDbSerializationError(
      'NOT_AN_INTEGER',
      `field must be an integer: ${field}`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new DynamoDbSerializationError(
      'UNSAFE_INTEGER',
      `field must be a safe integer: ${field}`,
    );
  }
  return {N: String(value)};
}

function serializePositiveInteger(value: unknown, field: string): DynamoNumber {
  const attribute = serializeInteger(value, field);
  if (Number(attribute.N) <= 0) {
    throw new DynamoDbSerializationError(
      'NOT_A_POSITIVE_INTEGER',
      `field must be a positive integer: ${field}`,
    );
  }
  return attribute;
}

function serializeSchemaVersion(value: unknown): DynamoNumber {
  const attribute = serializeInteger(value, 'schema_version');
  if (Number(attribute.N) !== SUPPORTED_SCHEMA_VERSION) {
    throw new DynamoDbSerializationError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `unsupported schema_version: only ${SUPPORTED_SCHEMA_VERSION} is supported`,
    );
  }
  return attribute;
}

function serializeStringList(value: unknown, field: string): DynamoList {
  if (!Array.isArray(value)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be an array: ${field}`,
    );
  }
  return {
    L: value.map((entry, index) =>
      serializeNonEmptyString(entry, `${field}[${index}]`),
    ),
  };
}

function serializeParticipantResponse(
  value: unknown,
  field: string,
): DynamoMap {
  assertPlainObjectValue(value, field);
  const record = asRecord(value);
  assertNestedKeys(record, field, PARTICIPANT_RESPONSE_FIELDS);
  return {
    M: {
      participant_id: serializeNonEmptyString(
        requireField(record, 'participant_id'),
        `${field}.participant_id`,
      ),
      response_state: serializeEnumMember(
        requireField(record, 'response_state'),
        `${field}.response_state`,
        PARTICIPANT_RESPONSE_STATES,
      ),
    },
  };
}

function serializeParticipantResponses(
  value: unknown,
  field: string,
): DynamoList {
  if (!Array.isArray(value)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be an array: ${field}`,
    );
  }
  return {
    L: value.map((entry, index) =>
      serializeParticipantResponse(entry, `${field}[${index}]`),
    ),
  };
}

function serializeComponentReference(value: unknown, field: string): DynamoMap {
  assertPlainObjectValue(value, field);
  const record = asRecord(value);
  assertNestedKeys(record, field, COMPONENT_REFERENCE_FIELDS);
  return {
    M: {
      component_id: serializeNonEmptyString(
        requireField(record, 'component_id'),
        `${field}.component_id`,
      ),
      option_id: serializeNonEmptyString(
        requireField(record, 'option_id'),
        `${field}.option_id`,
      ),
    },
  };
}

function serializeConfirmedPlan(
  value: unknown,
  field: string,
): DynamoAttributeValue {
  if (value === null) {
    return {NULL: true};
  }
  assertPlainObjectValue(value, field);
  const record = asRecord(value);
  assertNestedKeys(record, field, CONFIRMED_PLAN_FIELDS);
  const components_field = `${field}.selected_components`;
  const selected_components = requireField(record, 'selected_components');
  if (!Array.isArray(selected_components)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be an array: ${components_field}`,
    );
  }
  return {
    M: {
      plan_id: serializeNonEmptyString(
        requireField(record, 'plan_id'),
        `${field}.plan_id`,
      ),
      version: serializePositiveInteger(
        requireField(record, 'version'),
        `${field}.version`,
      ),
      selected_components: {
        L: selected_components.map((entry, index) =>
          serializeComponentReference(entry, `${components_field}[${index}]`),
        ),
      },
      confirmation_state: serializeEnumMember(
        requireField(record, 'confirmation_state'),
        `${field}.confirmation_state`,
        CONFIRMATION_STATES,
      ),
    },
  };
}

function serializeFixtureState(value: unknown, field: string): DynamoMap {
  assertPlainObjectValue(value, field);
  const record = asRecord(value);
  assertNestedKeys(record, field, FIXTURE_STATE_FIELDS);
  return {
    M: {
      source: serializeEnumMember(
        requireField(record, 'source'),
        `${field}.source`,
        FIXTURE_SOURCES,
      ),
      scenario: serializeEnumMember(
        requireField(record, 'scenario'),
        `${field}.scenario`,
        FIXTURE_SCENARIOS,
      ),
      constraint_ids: serializeStringList(
        requireField(record, 'constraint_ids'),
        `${field}.constraint_ids`,
      ),
      candidate_option_ids: serializeStringList(
        requireField(record, 'candidate_option_ids'),
        `${field}.candidate_option_ids`,
      ),
      context_change_ids: serializeStringList(
        requireField(record, 'context_change_ids'),
        `${field}.context_change_ids`,
      ),
    },
  };
}

function serializeReceiptEntry(value: unknown, field: string): DynamoMap {
  assertPlainObjectValue(value, field);
  const record = asRecord(value);
  assertNestedKeys(record, field, RECEIPT_FIELDS);
  return {
    M: {
      operation_id: serializeNonEmptyString(
        requireField(record, 'operation_id'),
        `${field}.operation_id`,
      ),
      mutation_fingerprint: serializeNonEmptyString(
        requireField(record, 'mutation_fingerprint'),
        `${field}.mutation_fingerprint`,
      ),
      committed_version: serializePositiveInteger(
        requireField(record, 'committed_version'),
        `${field}.committed_version`,
      ),
    },
  };
}

function serializeReceiptList(value: unknown, field: string): DynamoList {
  if (!Array.isArray(value)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be an array: ${field}`,
    );
  }
  return {
    L: value.map((entry, index) =>
      serializeReceiptEntry(entry, `${field}[${index}]`),
    ),
  };
}

// Fixed-shape serialization of the four canonical snapshot fields. The update
// request builder reuses this; it never merges or derives partial patches.
export type DynamoDbSnapshotFields = Readonly<{
  selected_candidate_id: DynamoAttributeValue;
  participant_responses: DynamoAttributeValue;
  confirmed_plan: DynamoAttributeValue;
  fixture_state: DynamoAttributeValue;
}>;

export function serializeDecisionSnapshotFields(
  snapshot: DecisionSnapshot,
): DynamoDbSnapshotFields {
  assertPlainObjectValue(snapshot, 'snapshot');
  const record = asRecord(snapshot);
  assertNestedKeys(record, 'snapshot', SNAPSHOT_FIELD_NAMES);
  return {
    selected_candidate_id: serializeNullableString(
      requireField(record, 'selected_candidate_id'),
      'selected_candidate_id',
    ),
    participant_responses: serializeParticipantResponses(
      requireField(record, 'participant_responses'),
      'participant_responses',
    ),
    confirmed_plan: serializeConfirmedPlan(
      requireField(record, 'confirmed_plan'),
      'confirmed_plan',
    ),
    fixture_state: serializeFixtureState(
      requireField(record, 'fixture_state'),
      'fixture_state',
    ),
  };
}

// Serializes a complete canonical item into the low-level record with exactly
// the ten stable attribute names, in fixed order, as new plain objects.
export function serializeDecisionItem(
  item: DynamoDbDecisionItem,
): DynamoItemMap {
  assertPlainObjectValue(item, 'item');
  const record = asRecord(item);
  assertItemKeys(record);
  return {
    decision_id: serializeNonEmptyString(
      requireField(record, 'decision_id'),
      'decision_id',
    ),
    schema_version: serializeSchemaVersion(
      requireField(record, 'schema_version'),
    ),
    version: serializePositiveInteger(
      requireField(record, 'version'),
      'version',
    ),
    selected_candidate_id: serializeNullableString(
      requireField(record, 'selected_candidate_id'),
      'selected_candidate_id',
    ),
    participant_responses: serializeParticipantResponses(
      requireField(record, 'participant_responses'),
      'participant_responses',
    ),
    confirmed_plan: serializeConfirmedPlan(
      requireField(record, 'confirmed_plan'),
      'confirmed_plan',
    ),
    fixture_state: serializeFixtureState(
      requireField(record, 'fixture_state'),
      'fixture_state',
    ),
    operation_ids: serializeStringList(
      requireField(record, 'operation_ids'),
      'operation_ids',
    ),
    operation_receipts: serializeReceiptList(
      requireField(record, 'operation_receipts'),
      'operation_receipts',
    ),
    expires_at: serializeInteger(
      requireField(record, 'expires_at'),
      'expires_at',
    ),
  };
}

export function serializeOperationReceipt(
  receipt: OperationReceipt,
): DynamoMap {
  return serializeReceiptEntry(receipt, 'operation_receipt');
}

// Structural AttributeValue validation: exactly one known discriminant whose
// payload type matches. Returns freshly constructed attribute values.
function validateAttributeValue(
  value: unknown,
  field: string,
): DynamoAttributeValue {
  if (!isPlainObject(value)) {
    throw new DynamoDbSerializationError(
      'MALFORMED_ATTRIBUTE_VALUE',
      `field must be an AttributeValue map: ${field}`,
    );
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    throw new DynamoDbSerializationError(
      'MALFORMED_ATTRIBUTE_VALUE',
      `field must carry exactly one attribute discriminant: ${field}`,
    );
  }
  const record = asRecord(value);
  switch (keys[0]) {
    case 'S':
      if (typeof record.S !== 'string') {
        throw new DynamoDbSerializationError(
          'MALFORMED_ATTRIBUTE_VALUE',
          `S attribute must carry a string: ${field}`,
        );
      }
      return {S: record.S};
    case 'N':
      if (
        typeof record.N !== 'string' ||
        !/^-?[0-9]+(\.[0-9]+)?$/.test(record.N)
      ) {
        throw new DynamoDbSerializationError(
          'MALFORMED_ATTRIBUTE_VALUE',
          `N attribute must carry a numeric string: ${field}`,
        );
      }
      return {N: record.N};
    case 'BOOL':
      if (typeof record.BOOL !== 'boolean') {
        throw new DynamoDbSerializationError(
          'MALFORMED_ATTRIBUTE_VALUE',
          `BOOL attribute must carry a boolean: ${field}`,
        );
      }
      return {BOOL: record.BOOL};
    case 'NULL':
      if (record.NULL !== true) {
        throw new DynamoDbSerializationError(
          'MALFORMED_ATTRIBUTE_VALUE',
          `NULL attribute must be exactly true: ${field}`,
        );
      }
      return {NULL: true};
    case 'L': {
      const entries = record.L;
      if (!Array.isArray(entries)) {
        throw new DynamoDbSerializationError(
          'MALFORMED_ATTRIBUTE_VALUE',
          `L attribute must carry a list: ${field}`,
        );
      }
      return {
        L: entries.map((entry, index) =>
          validateAttributeValue(entry, `${field}[${index}]`),
        ),
      };
    }
    case 'M': {
      const nested = record.M;
      if (!isPlainObject(nested)) {
        throw new DynamoDbSerializationError(
          'MALFORMED_ATTRIBUTE_VALUE',
          `M attribute must carry a map: ${field}`,
        );
      }
      const result: Record<string, DynamoAttributeValue> = {};
      for (const key of Object.keys(nested)) {
        result[key] = validateAttributeValue(nested[key], `${field}.${key}`);
      }
      return {M: result};
    }
    default:
      throw new DynamoDbSerializationError(
        'MALFORMED_ATTRIBUTE_VALUE',
        `unknown AttributeValue discriminant: ${field}`,
      );
  }
}

function requireAttribute(
  record: DynamoAttributeMap,
  field: string,
): DynamoAttributeValue {
  if (!(field in record)) {
    throw new DynamoDbSerializationError(
      'MISSING_REQUIRED_FIELD',
      `missing required field: ${field}`,
    );
  }
  return validateAttributeValue(record[field], field);
}

function readNonEmptyStringAttribute(
  value: DynamoAttributeValue,
  field: string,
): string {
  if (!('S' in value)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field expects an S attribute: ${field}`,
    );
  }
  if (value.S.length === 0) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be a non-empty string: ${field}`,
    );
  }
  return value.S;
}

function readNullableStringAttribute(
  value: DynamoAttributeValue,
  field: string,
): string | null {
  if ('NULL' in value) {
    return null;
  }
  return readNonEmptyStringAttribute(value, field);
}

function readEnumStringAttribute<T extends string>(
  value: DynamoAttributeValue,
  field: string,
  allowed: readonly T[],
): T {
  const member = readNonEmptyStringAttribute(value, field);
  if (!(allowed as readonly string[]).includes(member)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field must be one of ${allowed.join('|')}: ${field}`,
    );
  }
  return member as T;
}

function readIntegerAttribute(
  value: DynamoAttributeValue,
  field: string,
): number {
  if (!('N' in value)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field expects an N attribute: ${field}`,
    );
  }
  if (!/^-?(0|[1-9][0-9]*)$/.test(value.N)) {
    throw new DynamoDbSerializationError(
      'NOT_AN_INTEGER',
      `field expects a canonical integer N string: ${field}`,
    );
  }
  const parsed = Number(value.N);
  if (!Number.isSafeInteger(parsed)) {
    throw new DynamoDbSerializationError(
      'UNSAFE_INTEGER',
      `field expects a safe integer: ${field}`,
    );
  }
  return parsed;
}

function readPositiveIntegerAttribute(
  value: DynamoAttributeValue,
  field: string,
): number {
  const parsed = readIntegerAttribute(value, field);
  if (parsed <= 0) {
    throw new DynamoDbSerializationError(
      'NOT_A_POSITIVE_INTEGER',
      `field expects a positive integer: ${field}`,
    );
  }
  return parsed;
}

function readListAttribute(
  value: DynamoAttributeValue,
  field: string,
): readonly DynamoAttributeValue[] {
  if (!('L' in value)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field expects an L attribute: ${field}`,
    );
  }
  return value.L;
}

function readMapAttribute(
  value: DynamoAttributeValue,
  field: string,
): DynamoAttributeMap {
  if (!('M' in value)) {
    throw new DynamoDbSerializationError(
      'WRONG_FIELD_TYPE',
      `field expects an M attribute: ${field}`,
    );
  }
  return value.M;
}

function readNonEmptyStringList(
  value: DynamoAttributeValue,
  field: string,
): string[] {
  return readListAttribute(value, field).map((entry, index) =>
    readNonEmptyStringAttribute(entry, `${field}[${index}]`),
  );
}

function readParticipantResponses(
  value: DynamoAttributeValue,
  field: string,
): ParticipantResponse[] {
  return readListAttribute(value, field).map((entry, index) => {
    const entry_field = `${field}[${index}]`;
    const map = readMapAttribute(
      validateAttributeValue(entry, entry_field),
      entry_field,
    );
    assertNestedKeys(map, entry_field, PARTICIPANT_RESPONSE_FIELDS);
    const response: ParticipantResponse = {
      participant_id: readNonEmptyStringAttribute(
        requireAttribute(map, 'participant_id'),
        `${entry_field}.participant_id`,
      ) as ParticipantId,
      response_state: readEnumStringAttribute(
        requireAttribute(map, 'response_state'),
        `${entry_field}.response_state`,
        PARTICIPANT_RESPONSE_STATES,
      ),
    };
    return response;
  });
}

function readConfirmedPlan(
  value: DynamoAttributeValue,
  field: string,
): ConfirmedPlan | null {
  if ('NULL' in value) {
    return null;
  }
  const map = readMapAttribute(value, field);
  assertNestedKeys(map, field, CONFIRMED_PLAN_FIELDS);
  const components_field = `${field}.selected_components`;
  const selected_components = readListAttribute(
    requireAttribute(map, 'selected_components'),
    components_field,
  ).map((entry, index) => {
    const entry_field = `${components_field}[${index}]`;
    const component_map = readMapAttribute(
      validateAttributeValue(entry, entry_field),
      entry_field,
    );
    assertNestedKeys(component_map, entry_field, COMPONENT_REFERENCE_FIELDS);
    return {
      component_id: readNonEmptyStringAttribute(
        requireAttribute(component_map, 'component_id'),
        `${entry_field}.component_id`,
      ) as PlanComponentId,
      option_id: readNonEmptyStringAttribute(
        requireAttribute(component_map, 'option_id'),
        `${entry_field}.option_id`,
      ) as CandidateOptionId,
    };
  });
  const plan: ConfirmedPlan = {
    plan_id: readNonEmptyStringAttribute(
      requireAttribute(map, 'plan_id'),
      `${field}.plan_id`,
    ) as PlanId,
    version: readPositiveIntegerAttribute(
      requireAttribute(map, 'version'),
      `${field}.version`,
    ),
    selected_components,
    confirmation_state: readEnumStringAttribute(
      requireAttribute(map, 'confirmation_state'),
      `${field}.confirmation_state`,
      CONFIRMATION_STATES,
    ),
  };
  return plan;
}

function readFixtureState(
  value: DynamoAttributeValue,
  field: string,
): DecisionFixtureState {
  const map = readMapAttribute(value, field);
  assertNestedKeys(map, field, FIXTURE_STATE_FIELDS);
  const fixture_state: DecisionFixtureState = {
    source: readEnumStringAttribute(
      requireAttribute(map, 'source'),
      `${field}.source`,
      FIXTURE_SOURCES,
    ),
    scenario: readEnumStringAttribute(
      requireAttribute(map, 'scenario'),
      `${field}.scenario`,
      FIXTURE_SCENARIOS,
    ),
    constraint_ids: readNonEmptyStringList(
      requireAttribute(map, 'constraint_ids'),
      `${field}.constraint_ids`,
    ) as ConstraintId[],
    candidate_option_ids: readNonEmptyStringList(
      requireAttribute(map, 'candidate_option_ids'),
      `${field}.candidate_option_ids`,
    ) as CandidateOptionId[],
    context_change_ids: readNonEmptyStringList(
      requireAttribute(map, 'context_change_ids'),
      `${field}.context_change_ids`,
    ) as ContextChangeId[],
  };
  return fixture_state;
}

function readOperationReceipts(
  value: DynamoAttributeValue,
  field: string,
): OperationReceipt[] {
  return readListAttribute(value, field).map((entry, index) => {
    const entry_field = `${field}[${index}]`;
    const map = readMapAttribute(
      validateAttributeValue(entry, entry_field),
      entry_field,
    );
    assertNestedKeys(map, entry_field, RECEIPT_FIELDS);
    return {
      operation_id: readNonEmptyStringAttribute(
        requireAttribute(map, 'operation_id'),
        `${entry_field}.operation_id`,
      ),
      mutation_fingerprint: readNonEmptyStringAttribute(
        requireAttribute(map, 'mutation_fingerprint'),
        `${entry_field}.mutation_fingerprint`,
      ),
      committed_version: readPositiveIntegerAttribute(
        requireAttribute(map, 'committed_version'),
        `${entry_field}.committed_version`,
      ),
    };
  });
}

// Deserializes a validated low-level item map back into the canonical item.
// Always returns newly constructed plain objects and never mutates the input.
export function deserializeDecisionItem(
  record: DynamoItemMap,
): DynamoDbDecisionItem {
  assertPlainObjectValue(record, 'item');
  assertItemKeys(record);
  const schema_version = readIntegerAttribute(
    requireAttribute(record, 'schema_version'),
    'schema_version',
  );
  if (schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new DynamoDbSerializationError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `unsupported schema_version: only ${SUPPORTED_SCHEMA_VERSION} is supported`,
    );
  }
  const item: DynamoDbDecisionItem = {
    decision_id: readNonEmptyStringAttribute(
      requireAttribute(record, 'decision_id'),
      'decision_id',
    ) as DecisionId,
    schema_version,
    version: readPositiveIntegerAttribute(
      requireAttribute(record, 'version'),
      'version',
    ),
    selected_candidate_id: readNullableStringAttribute(
      requireAttribute(record, 'selected_candidate_id'),
      'selected_candidate_id',
    ) as CandidateOptionId | null,
    participant_responses: readParticipantResponses(
      requireAttribute(record, 'participant_responses'),
      'participant_responses',
    ),
    confirmed_plan: readConfirmedPlan(
      requireAttribute(record, 'confirmed_plan'),
      'confirmed_plan',
    ),
    fixture_state: readFixtureState(
      requireAttribute(record, 'fixture_state'),
      'fixture_state',
    ),
    operation_ids: readNonEmptyStringList(
      requireAttribute(record, 'operation_ids'),
      'operation_ids',
    ),
    operation_receipts: readOperationReceipts(
      requireAttribute(record, 'operation_receipts'),
      'operation_receipts',
    ),
    expires_at: readIntegerAttribute(
      requireAttribute(record, 'expires_at'),
      'expires_at',
    ),
  };
  return item;
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

function renderAttributeMap(map: DynamoAttributeMap): string {
  const entries = Object.keys(map)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${renderAttributeValue(map[key])}`);
  return `M{${entries.join(',')}}`;
}

function renderAttributeValue(value: DynamoAttributeValue): string {
  if ('S' in value) {
    return `S:${JSON.stringify(value.S)}`;
  }
  if ('N' in value) {
    return `N:${value.N}`;
  }
  if ('BOOL' in value) {
    return `BOOL:${value.BOOL}`;
  }
  if ('NULL' in value) {
    return 'NULL';
  }
  if ('L' in value) {
    return `L[${value.L.length}]{${value.L.map(renderAttributeValue).join(
      ',',
    )}}`;
  }
  return renderAttributeMap(value.M);
}

// Decorda serialization-envelope rendering: a deterministic fixed-order
// rendering of the complete low-level item (map keys sorted recursively).
export function renderDecisionItemEnvelope(item: DynamoDbDecisionItem): string {
  return renderAttributeMap(serializeDecisionItem(item));
}

// Decorda serialization-envelope measurement: the UTF-8 byte length of the
// fixed-order rendering above. This is the project's own conservative
// envelope only; it is NOT claimed to equal AWS's internal DynamoDB
// item-size accounting.
export function measureDecisionItemEnvelopeBytes(
  item: DynamoDbDecisionItem,
): number {
  return utf8ByteLength(renderDecisionItemEnvelope(item));
}

// Enforces the 32 KiB project-level serialization envelope. An item exactly
// at the limit passes; anything above it fails deterministically.
export function enforceDecisionItemEnvelope(
  item: DynamoDbDecisionItem,
): number {
  const bytes = measureDecisionItemEnvelopeBytes(item);
  if (bytes > MAX_ITEM_SIZE_BYTES) {
    throw new DynamoDbSerializationError(
      'SERIALIZATION_ENVELOPE_EXCEEDED',
      `Decorda serialization-envelope is ${bytes} bytes, above the ${MAX_ITEM_SIZE_BYTES}-byte project limit`,
    );
  }
  return bytes;
}
