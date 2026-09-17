import type {
  DecisionSnapshot,
  OperationReceipt,
} from '../../../src/application/decisionStore';
import {
  buildGetDecisionItemRequest,
  buildPutDecisionItemRequest,
  buildUpdateDecisionItemRequest,
  extractGetItemResponseItem,
  getResponseHasItem,
  isCompleteGetDecisionItemRequest,
  isCompletePutDecisionItemRequest,
  isCompleteUpdateDecisionItemRequest,
} from '../../../src/infrastructure/persistence/dynamoDbRequests';
import {DynamoDbSerializationError} from '../../../src/infrastructure/persistence/dynamoDbSerialization';
import type {DynamoItemMap} from '../../../src/infrastructure/persistence/dynamoDbSerialization';
import {MAX_OPERATION_RECEIPTS} from '../../../src/application/decisionStore';
import type {CandidateOptionId} from '../../../src/domain/types';
import type {ParticipantResponse} from '../../../src/domain/types';
import {
  initialDecisionState,
  referenceCandidateOptions,
} from '../../../src/domain/fixtures';

const TABLE_NAME = 'decorda-decisions-test';
const DECISION_ID = initialDecisionState.decision_id;
const RIVERSIDE_ID = referenceCandidateOptions[0].id;
const OPERATION_ID = 'op-select-riverside-1';

const RECEIPT: OperationReceipt = {
  operation_id: OPERATION_ID,
  mutation_fingerprint:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  committed_version: 2,
};

function pendingSnapshot(): DecisionSnapshot {
  return {
    selected_candidate_id: null,
    participant_responses: initialDecisionState.participant_responses.map(
      (response) => ({...response}),
    ),
    confirmed_plan: null,
    fixture_state: initialDecisionState.fixture_state,
  };
}

function approvedSnapshot(): DecisionSnapshot {
  return {
    selected_candidate_id: RIVERSIDE_ID,
    participant_responses: initialDecisionState.participant_responses.map(
      (response) => ({
        ...response,
        response_state: 'approved' as const,
      }),
    ),
    confirmed_plan: {
      plan_id: 'plan-saturday-activity',
      version: 1,
      selected_components: [
        {component_id: 'component-activity', option_id: RIVERSIDE_ID},
      ],
      confirmation_state: 'confirmed',
    },
    fixture_state: initialDecisionState.fixture_state,
  };
}

function createInput(initial_state: DecisionSnapshot = pendingSnapshot()) {
  return {
    decision_id: DECISION_ID,
    initial_state,
    expires_at: 1_800_000_000,
  };
}

function updateInput(next_state: DecisionSnapshot = approvedSnapshot()) {
  return {base_version: 1, receipt: RECEIPT, next_state};
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

const EXPECTED_FIXTURE_STATE = {
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
};

describe('PERSISTENCE-001 DynamoDB request builders', () => {
  describe('get request builder', () => {
    it('builds the exact get shape with a strongly consistent read', () => {
      expect(buildGetDecisionItemRequest(TABLE_NAME, DECISION_ID)).toEqual({
        TableName: TABLE_NAME,
        Key: {decision_id: {S: DECISION_ID}},
        ConsistentRead: true,
      });
    });

    it('carries exactly TableName, Key, and ConsistentRead with no extra fields', () => {
      const request = buildGetDecisionItemRequest(TABLE_NAME, DECISION_ID);

      expect(Object.keys(request)).toEqual([
        'TableName',
        'Key',
        'ConsistentRead',
      ]);
      expect(request.ConsistentRead).toBe(true);
    });

    it('rejects empty table names and decision ids', () => {
      expect(() => buildGetDecisionItemRequest('', DECISION_ID)).toThrow(
        DynamoDbSerializationError,
      );
      expect(() =>
        buildGetDecisionItemRequest(TABLE_NAME, '' as never),
      ).toThrow(DynamoDbSerializationError);
    });

    it('passes the modeled completeness check', () => {
      const request = buildGetDecisionItemRequest(TABLE_NAME, DECISION_ID);

      expect(isCompleteGetDecisionItemRequest(request)).toBe(true);
      expect(
        isCompleteGetDecisionItemRequest({...request, ConsistentRead: false}),
      ).toBe(false);
      expect(isCompleteGetDecisionItemRequest(null)).toBe(false);
    });
  });

  describe('put request builder', () => {
    it('builds the exact conditional-create request', () => {
      const request = buildPutDecisionItemRequest(TABLE_NAME, createInput());

      expect(request).toEqual({
        TableName: TABLE_NAME,
        Item: request.Item,
        ConditionExpression: 'attribute_not_exists(#decision_id)',
        ExpressionAttributeNames: {'#decision_id': 'decision_id'},
        ReturnValues: 'NONE',
      });
      expect(Object.keys(request)).toEqual([
        'TableName',
        'Item',
        'ConditionExpression',
        'ExpressionAttributeNames',
        'ReturnValues',
      ]);
    });

    it('serializes the initial item at schema version 1, version 1', () => {
      const request = buildPutDecisionItemRequest(TABLE_NAME, createInput());
      const item = request.Item;

      expect(Object.keys(item)).toEqual([
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
      expect(item.decision_id).toEqual({S: DECISION_ID});
      expect(item.schema_version).toEqual({N: '1'});
      expect(item.version).toEqual({N: '1'});
    });

    it('starts with empty operation id and receipt lists', () => {
      const request = buildPutDecisionItemRequest(TABLE_NAME, createInput());

      expect(request.Item.operation_ids).toEqual({L: []});
      expect(request.Item.operation_receipts).toEqual({L: []});
    });

    it('serializes the initial snapshot and epoch-seconds expiry', () => {
      const request = buildPutDecisionItemRequest(TABLE_NAME, createInput());

      expect(request.Item.selected_candidate_id).toEqual({NULL: true});
      expect(request.Item.confirmed_plan).toEqual({NULL: true});
      expect(request.Item.participant_responses).toEqual({
        L: [
          {
            M: {
              participant_id: {S: 'participant-alex'},
              response_state: {S: 'pending'},
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
              response_state: {S: 'pending'},
            },
          },
          {
            M: {
              participant_id: {S: 'participant-devon'},
              response_state: {S: 'pending'},
            },
          },
        ],
      });
      expect(request.Item.fixture_state).toEqual(EXPECTED_FIXTURE_STATE);
      expect(request.Item.expires_at).toEqual({N: '1800000000'});
    });

    it('never carries ReturnValuesOnConditionCheckFailure', () => {
      const request = buildPutDecisionItemRequest(TABLE_NAME, createInput());

      expect(
        Object.prototype.hasOwnProperty.call(
          request,
          'ReturnValuesOnConditionCheckFailure',
        ),
      ).toBe(false);
      expect(JSON.stringify(request)).not.toMatch(
        /ReturnValuesOnConditionCheckFailure/,
      );
    });

    it('enforces the project 32 KiB envelope on the complete initial item', () => {
      const oversized = createInput({
        ...pendingSnapshot(),
        selected_candidate_id: ('option-' +
          'a'.repeat(40_000)) as CandidateOptionId,
      });

      let caught: unknown;
      try {
        buildPutDecisionItemRequest(TABLE_NAME, oversized);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DynamoDbSerializationError);
      expect((caught as DynamoDbSerializationError).code).toBe(
        'SERIALIZATION_ENVELOPE_EXCEEDED',
      );
    });

    it('rejects empty table names and passes the completeness check', () => {
      expect(() => buildPutDecisionItemRequest('', createInput())).toThrow(
        DynamoDbSerializationError,
      );

      const request = buildPutDecisionItemRequest(TABLE_NAME, createInput());
      expect(isCompletePutDecisionItemRequest(request)).toBe(true);
      expect(isCompletePutDecisionItemRequest({})).toBe(false);
      expect(
        isCompletePutDecisionItemRequest({
          ...request,
          ConditionExpression: 'attribute_not_exists(decision_id)',
        }),
      ).toBe(false);
    });
  });

  describe('update request builder', () => {
    it('builds the exact frozen condition expression', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());

      expect(request.ConditionExpression).toBe(
        '#version = :base_version AND NOT contains(#operation_ids, :operation_id) AND size(#operation_ids) < :maximum_operations',
      );
    });

    it('builds the exact frozen one-line update expression', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());

      expect(request.UpdateExpression).toBe(
        'SET #selected_candidate_id = :selected_candidate_id, ' +
          '#participant_responses = :participant_responses, ' +
          '#confirmed_plan = :confirmed_plan, ' +
          '#fixture_state = :fixture_state, ' +
          '#version = #version + :one, ' +
          '#operation_ids = list_append(#operation_ids, :operation_ids_append), ' +
          '#operation_receipts = list_append(#operation_receipts, :operation_receipts_append)',
      );
    });

    it('carries exactly the seven required aliases', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());

      expect(request.ExpressionAttributeNames).toEqual({
        '#version': 'version',
        '#selected_candidate_id': 'selected_candidate_id',
        '#participant_responses': 'participant_responses',
        '#confirmed_plan': 'confirmed_plan',
        '#fixture_state': 'fixture_state',
        '#operation_ids': 'operation_ids',
        '#operation_receipts': 'operation_receipts',
      });
    });

    it('binds the base version, operation id, and increment values', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());
      const values = request.ExpressionAttributeValues;

      expect(values[':base_version']).toEqual({N: '1'});
      expect(values[':operation_id']).toEqual({S: OPERATION_ID});
      expect(values[':one']).toEqual({N: '1'});
    });

    it('binds the frozen maximum of 40 operations', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());

      expect(MAX_OPERATION_RECEIPTS).toBe(40);
      expect(request.ExpressionAttributeValues[':maximum_operations']).toEqual({
        N: '40',
      });
      expect(request.ConditionExpression).toContain(
        'size(#operation_ids) < :maximum_operations',
      );
    });

    it('carries the complete validated next state fields', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());
      const values = request.ExpressionAttributeValues;

      expect(values[':selected_candidate_id']).toEqual({S: RIVERSIDE_ID});
      expect(values[':participant_responses']).toEqual({
        L: initialDecisionState.participant_responses.map((response) => ({
          M: {
            participant_id: {S: response.participant_id},
            response_state: {S: 'approved'},
          },
        })),
      });
      expect(values[':confirmed_plan']).toEqual({
        M: {
          plan_id: {S: 'plan-saturday-activity'},
          version: {N: '1'},
          selected_components: {
            L: [
              {
                M: {
                  component_id: {S: 'component-activity'},
                  option_id: {S: RIVERSIDE_ID},
                },
              },
            ],
          },
          confirmation_state: {S: 'confirmed'},
        },
      });
      expect(values[':fixture_state']).toEqual(EXPECTED_FIXTURE_STATE);
    });

    it('serializes null selection and null plan snapshot fields as NULL', () => {
      const request = buildUpdateDecisionItemRequest(
        updateInput(pendingSnapshot()),
      );
      const values = request.ExpressionAttributeValues;

      expect(values[':selected_candidate_id']).toEqual({NULL: true});
      expect(values[':confirmed_plan']).toEqual({NULL: true});
    });

    it('appends exactly one operation id and one receipt', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());
      const values = request.ExpressionAttributeValues;

      expect(values[':operation_ids_append']).toEqual({
        L: [{S: OPERATION_ID}],
      });
      expect(values[':operation_receipts_append']).toEqual({
        L: [
          {
            M: {
              operation_id: {S: RECEIPT.operation_id},
              mutation_fingerprint: {S: RECEIPT.mutation_fingerprint},
              committed_version: {N: '2'},
            },
          },
        ],
      });
    });

    it('returns exactly the five frozen members with ReturnValues NONE', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());

      expect(Object.keys(request)).toEqual([
        'ConditionExpression',
        'UpdateExpression',
        'ExpressionAttributeNames',
        'ExpressionAttributeValues',
        'ReturnValues',
      ]);
      expect(request.ReturnValues).toBe('NONE');
      expect(JSON.stringify(request)).not.toMatch(
        /ReturnValuesOnConditionCheckFailure|region|credentials?|endpoint|retry|client|token|table_name/i,
      );
    });

    it('builds deterministically for identical inputs', () => {
      const first = buildUpdateDecisionItemRequest(updateInput());
      const second = buildUpdateDecisionItemRequest(updateInput());

      expect(first).toEqual(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('does not mutate its inputs', () => {
      const frozen_input = deepFreeze(updateInput());
      expect(() => buildUpdateDecisionItemRequest(frozen_input)).not.toThrow();

      const input = updateInput();
      const request = buildUpdateDecisionItemRequest(input);
      (input.next_state.participant_responses as ParticipantResponse[]).push({
        participant_id: 'participant-late',
        response_state: 'approved',
      });

      const values = request.ExpressionAttributeValues;
      const responses = values[':participant_responses'];
      if (!('L' in responses)) {
        throw new Error('expected response list');
      }
      expect(responses.L).toHaveLength(4);
      expect(values[':selected_candidate_id']).toEqual({S: RIVERSIDE_ID});
    });

    it('rejects invalid base versions and malformed receipts', () => {
      for (const base_version of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
        expect(() =>
          buildUpdateDecisionItemRequest({...updateInput(), base_version}),
        ).toThrow(DynamoDbSerializationError);
      }
      expect(() =>
        buildUpdateDecisionItemRequest({
          ...updateInput(),
          receipt: {...RECEIPT, operation_id: ''},
        }),
      ).toThrow(DynamoDbSerializationError);
      expect(() =>
        buildUpdateDecisionItemRequest({
          ...updateInput(),
          receipt: {...RECEIPT, committed_version: 0},
        }),
      ).toThrow(DynamoDbSerializationError);
    });

    it('rejects incomplete next states instead of merging patches', () => {
      expect(() =>
        buildUpdateDecisionItemRequest({
          ...updateInput(),
          next_state: {
            ...approvedSnapshot(),
            unexpected: true,
          } as unknown as DecisionSnapshot,
        }),
      ).toThrow(DynamoDbSerializationError);
    });

    it('passes the modeled completeness check', () => {
      const request = buildUpdateDecisionItemRequest(updateInput());

      expect(isCompleteUpdateDecisionItemRequest(request)).toBe(true);
      expect(isCompleteUpdateDecisionItemRequest(null)).toBe(false);
      expect(
        isCompleteUpdateDecisionItemRequest({
          ...request,
          ReturnValues: 'ALL_NEW',
        }),
      ).toBe(false);
    });
  });

  describe('modeled get response helpers', () => {
    it('detects item presence and extracts the low-level item map', () => {
      const record: DynamoItemMap = {decision_id: {S: DECISION_ID}};

      expect(getResponseHasItem({Item: record})).toBe(true);
      expect(getResponseHasItem({})).toBe(false);
      expect(extractGetItemResponseItem({Item: record})).toBe(record);
      expect(extractGetItemResponseItem({})).toBeNull();
    });
  });
});
