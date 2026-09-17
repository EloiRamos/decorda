import type {
  DynamoDbSerializationErrorCode,
  DynamoItemMap,
} from '../../../src/infrastructure/persistence/dynamoDbSerialization';
import {
  DynamoDbSerializationError,
  deserializeDecisionItem,
  enforceDecisionItemEnvelope,
  measureDecisionItemEnvelopeBytes,
  renderDecisionItemEnvelope,
  serializeDecisionItem,
  SUPPORTED_SCHEMA_VERSION,
} from '../../../src/infrastructure/persistence/dynamoDbSerialization';
import {MAX_ITEM_SIZE_BYTES} from '../../../src/application/decisionStore';
import type {DynamoDbDecisionItem} from '../../../src/infrastructure/persistence/dynamoDbTypes';
import type {ParticipantResponse} from '../../../src/domain/types';
import {initialDecisionState} from '../../../src/domain/fixtures';

const FINGERPRINT_ONE = 'aa'.repeat(32);
const FINGERPRINT_TWO = 'bb'.repeat(32);
const FINGERPRINT_THREE = 'cc'.repeat(32);

function populatedItem(): DynamoDbDecisionItem {
  return {
    decision_id: 'decision-saturday-activity',
    schema_version: 1,
    version: 2,
    selected_candidate_id: 'option-riverside-picnic',
    participant_responses: [
      {participant_id: 'participant-alex', response_state: 'approved'},
      {participant_id: 'participant-blair', response_state: 'pending'},
      {participant_id: 'participant-casey', response_state: 'rejected'},
      {participant_id: 'participant-devon', response_state: 'approved'},
    ],
    confirmed_plan: {
      plan_id: 'plan-saturday-activity',
      version: 1,
      selected_components: [
        {
          component_id: 'component-activity',
          option_id: 'option-riverside-picnic',
        },
        {
          component_id: 'component-return-arrangement',
          option_id: 'option-museum-workshop',
        },
      ],
      confirmation_state: 'confirmed',
    },
    fixture_state: initialDecisionState.fixture_state,
    operation_ids: [
      'op-select-riverside-1',
      'op-approve-alex-2',
      'op-confirm-plan-3',
    ],
    operation_receipts: [
      {
        operation_id: 'op-select-riverside-1',
        mutation_fingerprint: FINGERPRINT_ONE,
        committed_version: 2,
      },
      {
        operation_id: 'op-approve-alex-2',
        mutation_fingerprint: FINGERPRINT_TWO,
        committed_version: 3,
      },
      {
        operation_id: 'op-confirm-plan-3',
        mutation_fingerprint: FINGERPRINT_THREE,
        committed_version: 4,
      },
    ],
    expires_at: 1_800_000_000,
  };
}

function freshItem(): DynamoDbDecisionItem {
  return {
    ...populatedItem(),
    version: 1,
    selected_candidate_id: null,
    participant_responses: initialDecisionState.participant_responses.map(
      (response) => ({...response}),
    ),
    confirmed_plan: null,
    operation_ids: [],
    operation_receipts: [],
  };
}

function itemWith(overrides: Record<string, unknown>): DynamoDbDecisionItem {
  return {...populatedItem(), ...overrides} as unknown as DynamoDbDecisionItem;
}

function itemWithSelection(selection: string): DynamoDbDecisionItem {
  return {
    ...freshItem(),
    selected_candidate_id: selection,
  } as unknown as DynamoDbDecisionItem;
}

function serializedPopulated(): DynamoItemMap {
  return serializeDecisionItem(populatedItem());
}

function recordWith(overrides: Record<string, unknown>): DynamoItemMap {
  return {...serializedPopulated(), ...overrides} as DynamoItemMap;
}

function expectErrorCode(
  operation: () => unknown,
  code: DynamoDbSerializationErrorCode,
): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DynamoDbSerializationError);
  expect((caught as DynamoDbSerializationError).code).toBe(code);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

// Independent UTF-8 byte counter used to cross-check the envelope
// measurement; counts code points exactly like the documented encoding.
function utf8Length(value: string): number {
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

const EXPECTED_SERIALIZED_POPULATED = {
  decision_id: {S: 'decision-saturday-activity'},
  schema_version: {N: '1'},
  version: {N: '2'},
  selected_candidate_id: {S: 'option-riverside-picnic'},
  participant_responses: {
    L: [
      {
        M: {
          participant_id: {S: 'participant-alex'},
          response_state: {S: 'approved'},
        },
      },
      {
        M: {
          participant_id: {S: 'participant-blair'},
          response_state: {S: 'pending'},
        },
      },
      {
        M: {
          participant_id: {S: 'participant-casey'},
          response_state: {S: 'rejected'},
        },
      },
      {
        M: {
          participant_id: {S: 'participant-devon'},
          response_state: {S: 'approved'},
        },
      },
    ],
  },
  confirmed_plan: {
    M: {
      plan_id: {S: 'plan-saturday-activity'},
      version: {N: '1'},
      selected_components: {
        L: [
          {
            M: {
              component_id: {S: 'component-activity'},
              option_id: {S: 'option-riverside-picnic'},
            },
          },
          {
            M: {
              component_id: {S: 'component-return-arrangement'},
              option_id: {S: 'option-museum-workshop'},
            },
          },
        ],
      },
      confirmation_state: {S: 'confirmed'},
    },
  },
  fixture_state: {
    M: {
      source: {S: 'synthetic_fixture'},
      scenario: {S: 'saturday_activity'},
      constraint_ids: {
        L: [
          {S: 'constraint-budget'},
          {S: 'constraint-return-time'},
          {S: 'constraint-outdoor-preference'},
        ],
      },
      candidate_option_ids: {
        L: [
          {S: 'option-riverside-picnic'},
          {S: 'option-museum-workshop'},
          {S: 'option-forest-course'},
          {S: 'option-community-garden'},
        ],
      },
      context_change_ids: {L: [{S: 'context-change-rain-fixture'}]},
    },
  },
  operation_ids: {
    L: [
      {S: 'op-select-riverside-1'},
      {S: 'op-approve-alex-2'},
      {S: 'op-confirm-plan-3'},
    ],
  },
  operation_receipts: {
    L: [
      {
        M: {
          operation_id: {S: 'op-select-riverside-1'},
          mutation_fingerprint: {S: FINGERPRINT_ONE},
          committed_version: {N: '2'},
        },
      },
      {
        M: {
          operation_id: {S: 'op-approve-alex-2'},
          mutation_fingerprint: {S: FINGERPRINT_TWO},
          committed_version: {N: '3'},
        },
      },
      {
        M: {
          operation_id: {S: 'op-confirm-plan-3'},
          mutation_fingerprint: {S: FINGERPRINT_THREE},
          committed_version: {N: '4'},
        },
      },
    ],
  },
  expires_at: {N: '1800000000'},
};

describe('PERSISTENCE-001 DynamoDB serialization', () => {
  describe('serialization mapping', () => {
    it('serializes a full representative item into the exact low-level record', () => {
      expect(serializeDecisionItem(populatedItem())).toEqual(
        EXPECTED_SERIALIZED_POPULATED,
      );
    });

    it('uses exactly the ten stable attribute names in fixed order', () => {
      expect(Object.keys(serializeDecisionItem(populatedItem()))).toEqual([
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
      ]);
    });

    it('maps identity and plan strings to S attributes', () => {
      const serialized = serializedPopulated();

      expect(serialized.decision_id).toEqual({S: 'decision-saturday-activity'});
      expect(serialized.selected_candidate_id).toEqual({
        S: 'option-riverside-picnic',
      });
      const plan = serialized.confirmed_plan;
      if (!('M' in plan)) {
        throw new Error('expected confirmed plan map');
      }
      expect(plan.M.plan_id).toEqual({S: 'plan-saturday-activity'});
      expect(plan.M.confirmation_state).toEqual({S: 'confirmed'});
    });

    it('maps numbers to N attributes carrying decimal strings', () => {
      const serialized = serializedPopulated();

      expect(serialized.schema_version).toEqual({N: '1'});
      expect(serialized.version).toEqual({N: '2'});
      expect(serialized.expires_at).toEqual({N: '1800000000'});
      const plan = serialized.confirmed_plan;
      if (!('M' in plan)) {
        throw new Error('expected confirmed plan map');
      }
      expect(plan.M.version).toEqual({N: '1'});
      const receipt = serialized.operation_receipts;
      if (!('L' in receipt)) {
        throw new Error('expected receipt list');
      }
      expect(receipt.L[0]).toEqual({
        M: {
          operation_id: {S: 'op-select-riverside-1'},
          mutation_fingerprint: {S: FINGERPRINT_ONE},
          committed_version: {N: '2'},
        },
      });
    });

    it('maps a null selected candidate and a null confirmed plan to NULL', () => {
      const serialized = serializeDecisionItem(freshItem());

      expect(serialized.selected_candidate_id).toEqual({NULL: true});
      expect(serialized.confirmed_plan).toEqual({NULL: true});
    });

    it('maps a non-null selected candidate to S and keeps participant order', () => {
      const serialized = serializedPopulated();

      expect(serialized.selected_candidate_id).toEqual({
        S: 'option-riverside-picnic',
      });
      const responses = serialized.participant_responses;
      if (!('L' in responses)) {
        throw new Error('expected response list');
      }
      expect(responses.L.map((entry) => entry)).toEqual(
        EXPECTED_SERIALIZED_POPULATED.participant_responses.L,
      );
    });

    it('maps a non-null confirmed plan to its fixed map', () => {
      const serialized = serializedPopulated();
      const plan = serialized.confirmed_plan;
      if (!('M' in plan)) {
        throw new Error('expected confirmed plan map');
      }

      expect(Object.keys(plan.M)).toEqual([
        'plan_id',
        'version',
        'selected_components',
        'confirmation_state',
      ]);
      expect(plan.M).toEqual(EXPECTED_SERIALIZED_POPULATED.confirmed_plan.M);
    });

    it('preserves selected component order inside the confirmed plan', () => {
      const serialized = serializedPopulated();
      const plan = serialized.confirmed_plan;
      if (!('M' in plan)) {
        throw new Error('expected confirmed plan map');
      }
      const components = plan.M.selected_components;
      if (!('L' in components)) {
        throw new Error('expected component list');
      }

      expect(components.L.map((entry) => entry)).toEqual([
        {
          M: {
            component_id: {S: 'component-activity'},
            option_id: {S: 'option-riverside-picnic'},
          },
        },
        {
          M: {
            component_id: {S: 'component-return-arrangement'},
            option_id: {S: 'option-museum-workshop'},
          },
        },
      ]);
    });

    it('preserves operation id and receipt order', () => {
      const serialized = serializedPopulated();
      const operation_ids = serialized.operation_ids;
      const receipts = serialized.operation_receipts;
      if (!('L' in operation_ids) || !('L' in receipts)) {
        throw new Error('expected operation id and receipt lists');
      }

      expect(operation_ids.L.map((entry) => entry)).toEqual([
        {S: 'op-select-riverside-1'},
        {S: 'op-approve-alex-2'},
        {S: 'op-confirm-plan-3'},
      ]);
      expect(receipts.L.map((receipt) => receipt)).toEqual(
        EXPECTED_SERIALIZED_POPULATED.operation_receipts.L,
      );
    });

    it('maps fixture state to its fixed five-field map', () => {
      const serialized = serializedPopulated();

      expect(serialized.fixture_state).toEqual(
        EXPECTED_SERIALIZED_POPULATED.fixture_state,
      );
    });

    it('produces identical output for repeated serialization', () => {
      const first = serializeDecisionItem(populatedItem());
      const second = serializeDecisionItem(populatedItem());

      expect(first).toEqual(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  });

  describe('deserialization', () => {
    it('round-trips a populated item preserving the logical value', () => {
      const item = populatedItem();

      expect(deserializeDecisionItem(serializeDecisionItem(item))).toEqual(
        item,
      );
    });

    it('round-trips a fresh item with null selection and plan', () => {
      const item = freshItem();

      expect(deserializeDecisionItem(serializeDecisionItem(item))).toEqual(
        item,
      );
    });

    it('re-serializes a deserialized item to the identical record', () => {
      const item = populatedItem();
      const serialized = serializeDecisionItem(item);

      expect(
        serializeDecisionItem(deserializeDecisionItem(serialized)),
      ).toEqual(serialized);
    });

    it('returns newly constructed objects, never input references', () => {
      const item = populatedItem();
      const deserialized = deserializeDecisionItem(serializeDecisionItem(item));

      expect(deserialized).not.toBe(item);
      expect(deserialized.participant_responses).not.toBe(
        item.participant_responses,
      );
      expect(deserialized.participant_responses[0]).not.toBe(
        item.participant_responses[0],
      );
      const plan = deserialized.confirmed_plan;
      const original_plan = item.confirmed_plan;
      if (plan === null || original_plan === null) {
        throw new Error('expected confirmed plans');
      }
      expect(plan).not.toBe(original_plan);
      expect(plan.selected_components[0]).not.toBe(
        original_plan.selected_components[0],
      );
      expect(deserialized.fixture_state).not.toBe(item.fixture_state);
      expect(deserialized.operation_receipts[0]).not.toBe(
        item.operation_receipts[0],
      );
    });

    it('does not mutate the serialization input', () => {
      const frozen = deepFreeze(populatedItem());
      expect(() => serializeDecisionItem(frozen)).not.toThrow();

      const item = populatedItem();
      const serialized = serializeDecisionItem(item);
      (item.participant_responses as ParticipantResponse[]).push({
        participant_id: 'participant-late',
        response_state: 'approved',
      });
      (item.operation_ids as string[]).push('op-late');

      expect(serialized.participant_responses).toEqual(
        EXPECTED_SERIALIZED_POPULATED.participant_responses,
      );
      expect(serialized.operation_ids).toEqual(
        EXPECTED_SERIALIZED_POPULATED.operation_ids,
      );
    });

    it('does not mutate the low-level record during deserialization', () => {
      const record = deepFreeze(serializedPopulated());
      expect(() => deserializeDecisionItem(record)).not.toThrow();
      expect(record).toEqual(serializedPopulated());
    });
  });

  describe('validation and rejection', () => {
    it('rejects unknown top-level fields in both directions', () => {
      expectErrorCode(
        () => serializeDecisionItem(itemWith({intruder: 'x'})),
        'UNKNOWN_TOP_LEVEL_FIELD',
      );
      expectErrorCode(
        () => deserializeDecisionItem(recordWith({intruder: {S: 'x'}})),
        'UNKNOWN_TOP_LEVEL_FIELD',
      );
    });

    it('rejects missing required fields in both directions', () => {
      const incomplete = {...populatedItem()} as {expires_at?: number};
      delete incomplete.expires_at;
      expectErrorCode(
        () =>
          serializeDecisionItem(incomplete as unknown as DynamoDbDecisionItem),
        'MISSING_REQUIRED_FIELD',
      );
      const incomplete_record = serializedPopulated() as {
        selected_candidate_id?: unknown;
      };
      delete incomplete_record.selected_candidate_id;
      expectErrorCode(
        () =>
          deserializeDecisionItem(
            incomplete_record as unknown as DynamoItemMap,
          ),
        'MISSING_REQUIRED_FIELD',
      );
    });

    it('rejects undefined field values in both directions', () => {
      expectErrorCode(
        () => serializeDecisionItem(itemWith({version: undefined})),
        'UNDEFINED_VALUE',
      );
      expectErrorCode(
        () => deserializeDecisionItem(recordWith({version: undefined})),
        'MALFORMED_ATTRIBUTE_VALUE',
      );
    });

    it('rejects non-finite numbers', () => {
      expectErrorCode(
        () => serializeDecisionItem(itemWith({version: Number.NaN})),
        'NON_FINITE_NUMBER',
      );
      expectErrorCode(
        () =>
          serializeDecisionItem(
            itemWith({expires_at: Number.POSITIVE_INFINITY}),
          ),
        'NON_FINITE_NUMBER',
      );
    });

    it('rejects unsafe integers', () => {
      expectErrorCode(
        () => serializeDecisionItem(itemWith({version: 2 ** 53})),
        'UNSAFE_INTEGER',
      );
    });

    it('rejects non-integer numbers where integers are required', () => {
      expectErrorCode(
        () => serializeDecisionItem(itemWith({version: 1.5})),
        'NOT_AN_INTEGER',
      );
      expectErrorCode(
        () => serializeDecisionItem(itemWith({version: 0})),
        'NOT_A_POSITIVE_INTEGER',
      );
    });

    it('rejects unsupported schema versions in both directions', () => {
      expectErrorCode(
        () =>
          serializeDecisionItem(
            itemWith({schema_version: SUPPORTED_SCHEMA_VERSION + 1}),
          ),
        'UNSUPPORTED_SCHEMA_VERSION',
      );
      expectErrorCode(
        () =>
          deserializeDecisionItem(
            recordWith({
              schema_version: {N: String(SUPPORTED_SCHEMA_VERSION + 1)},
            }),
          ),
        'UNSUPPORTED_SCHEMA_VERSION',
      );
    });

    it('rejects malformed AttributeValue discriminants', () => {
      expectErrorCode(
        () =>
          deserializeDecisionItem(recordWith({decision_id: {S: 'x', N: '1'}})),
        'MALFORMED_ATTRIBUTE_VALUE',
      );
      expectErrorCode(
        () => deserializeDecisionItem(recordWith({decision_id: {SS: ['x']}})),
        'MALFORMED_ATTRIBUTE_VALUE',
      );
      expectErrorCode(
        () => deserializeDecisionItem(recordWith({decision_id: {S: 3}})),
        'MALFORMED_ATTRIBUTE_VALUE',
      );
      expectErrorCode(
        () => deserializeDecisionItem(recordWith({expires_at: {NULL: false}})),
        'MALFORMED_ATTRIBUTE_VALUE',
      );
      expectErrorCode(
        () => deserializeDecisionItem(recordWith({operation_ids: {L: ['x']}})),
        'MALFORMED_ATTRIBUTE_VALUE',
      );
      expectErrorCode(
        () =>
          deserializeDecisionItem(
            recordWith({participant_responses: {L: [{M: {extra: 1}}]}}),
          ),
        'MALFORMED_ATTRIBUTE_VALUE',
      );
    });

    it('rejects wrong nullable representations', () => {
      expectErrorCode(
        () =>
          deserializeDecisionItem(
            recordWith({selected_candidate_id: {BOOL: false}}),
          ),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () =>
          deserializeDecisionItem(
            recordWith({selected_candidate_id: {N: '0'}}),
          ),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () =>
          deserializeDecisionItem(recordWith({confirmed_plan: {S: 'null'}})),
        'WRONG_FIELD_TYPE',
      );
    });

    it('rejects functions, symbols, and class instances reaching the serializer', () => {
      class Injected {
        value = 1;
      }
      expectErrorCode(
        () => serializeDecisionItem(itemWith({version: () => 1})),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () =>
          serializeDecisionItem(itemWith({selected_candidate_id: Symbol('x')})),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () =>
          serializeDecisionItem(
            new Injected() as unknown as DynamoDbDecisionItem,
          ),
        'UNSUPPORTED_VALUE_TYPE',
      );
      expectErrorCode(
        () =>
          serializeDecisionItem(
            itemWith({participant_responses: [new Injected()]}),
          ),
        'UNSUPPORTED_VALUE_TYPE',
      );
    });

    it('rejects wrong field types', () => {
      expectErrorCode(
        () => serializeDecisionItem(itemWith({expires_at: '1800000000'})),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () => serializeDecisionItem(itemWith({decision_id: 7})),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () => serializeDecisionItem(itemWith({fixture_state: []})),
        'UNSUPPORTED_VALUE_TYPE',
      );
    });

    it('rejects unknown nested fields and invalid enum members', () => {
      expectErrorCode(
        () =>
          serializeDecisionItem(
            itemWith({
              confirmed_plan: {
                ...populatedItem().confirmed_plan,
                unexpected: true,
              },
            }),
          ),
        'UNKNOWN_FIELD',
      );
      expectErrorCode(
        () =>
          serializeDecisionItem(
            itemWith({
              participant_responses: [
                {participant_id: 'participant-alex', response_state: 'maybe'},
              ],
            }),
          ),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () =>
          serializeDecisionItem(
            itemWith({
              fixture_state: {
                ...initialDecisionState.fixture_state,
                source: 'live_provider',
              },
            }),
          ),
        'WRONG_FIELD_TYPE',
      );
    });

    it('rejects empty strings where non-empty identities are required', () => {
      expectErrorCode(
        () => serializeDecisionItem(itemWith({decision_id: ''})),
        'WRONG_FIELD_TYPE',
      );
      expectErrorCode(
        () => deserializeDecisionItem(recordWith({decision_id: {S: ''}})),
        'WRONG_FIELD_TYPE',
      );
    });
  });

  describe('serialization envelope', () => {
    it('measures the serialization envelope deterministically', () => {
      const item = populatedItem();

      expect(measureDecisionItemEnvelopeBytes(item)).toBe(
        measureDecisionItemEnvelopeBytes(item),
      );
      expect(measureDecisionItemEnvelopeBytes(item)).toBe(
        utf8Length(renderDecisionItemEnvelope(item)),
      );
    });

    it('counts UTF-8 bytes, not JS string characters', () => {
      const multibyte_item = itemWith({selected_candidate_id: 'option-é'});
      const rendered = renderDecisionItemEnvelope(multibyte_item);

      expect(rendered.length).toBe(utf8Length(rendered) - 1);
      expect(measureDecisionItemEnvelopeBytes(multibyte_item)).toBe(
        utf8Length(rendered),
      );
    });

    it('renders the documented fixed-order envelope representation', () => {
      const tiny_item: DynamoDbDecisionItem = {
        decision_id: 'decision-x',
        schema_version: 1,
        version: 1,
        selected_candidate_id: null,
        participant_responses: [],
        confirmed_plan: null,
        fixture_state: {
          source: 'synthetic_fixture',
          scenario: 'saturday_activity',
          constraint_ids: [],
          candidate_option_ids: [],
          context_change_ids: [],
        },
        operation_ids: [],
        operation_receipts: [],
        expires_at: 0,
      };

      expect(renderDecisionItemEnvelope(tiny_item)).toBe(
        'M{"confirmed_plan":NULL,"decision_id":S:"decision-x","expires_at":N:0,' +
          '"fixture_state":M{"candidate_option_ids":L[0]{},"constraint_ids":L[0]{},' +
          '"context_change_ids":L[0]{},"scenario":S:"saturday_activity",' +
          '"source":S:"synthetic_fixture"},"operation_ids":L[0]{},' +
          '"operation_receipts":L[0]{},"participant_responses":L[0]{},' +
          '"schema_version":N:1,"selected_candidate_id":NULL,"version":N:1}',
      );
    });

    it('rejects above-limit items and accepts exactly-at-limit items', () => {
      const base = itemWithSelection('option-pad');
      const base_bytes = measureDecisionItemEnvelopeBytes(base);
      expect(base_bytes).toBeLessThan(MAX_ITEM_SIZE_BYTES);
      const deficit = MAX_ITEM_SIZE_BYTES - base_bytes;

      const at_limit = itemWithSelection('option-pad' + 'a'.repeat(deficit));
      expect(measureDecisionItemEnvelopeBytes(at_limit)).toBe(
        MAX_ITEM_SIZE_BYTES,
      );
      expect(enforceDecisionItemEnvelope(at_limit)).toBe(MAX_ITEM_SIZE_BYTES);

      const over_limit = itemWithSelection(
        'option-pad' + 'a'.repeat(deficit + 1),
      );
      let caught: unknown;
      try {
        enforceDecisionItemEnvelope(over_limit);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DynamoDbSerializationError);
      expect((caught as DynamoDbSerializationError).code).toBe(
        'SERIALIZATION_ENVELOPE_EXCEEDED',
      );
    });

    it('measures only the Decorda envelope rendering, not AWS internal item-size accounting', () => {
      expect(MAX_ITEM_SIZE_BYTES).toBe(32 * 1024);
      const item = populatedItem();
      const rendered = renderDecisionItemEnvelope(item);

      expect(measureDecisionItemEnvelopeBytes(item)).toBe(utf8Length(rendered));
      expect(
        renderDecisionItemEnvelope(
          deserializeDecisionItem(serializeDecisionItem(item)),
        ),
      ).toBe(rendered);
    });
  });
});
