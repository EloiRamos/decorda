import type {OperationReceipt} from '../../../src/application/decisionStore';
import type {DynamoDbDecisionItem} from '../../../src/infrastructure/persistence/dynamoDbTypes';
import {initialDecisionState} from '../../../src/domain/fixtures';
import type {DecisionId} from '../../../src/domain/types';

const DECISION_ID: DecisionId = initialDecisionState.decision_id;

const RECEIPT: OperationReceipt = {
  operation_id: 'op-select-riverside-1',
  mutation_fingerprint:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  committed_version: 2,
};

function populatedItem(): DynamoDbDecisionItem {
  return {
    decision_id: DECISION_ID,
    schema_version: 1,
    version: 2,
    selected_candidate_id: 'option-riverside-picnic',
    participant_responses: initialDecisionState.participant_responses.map(
      response => ({
        ...response,
        response_state: 'approved' as const,
      }),
    ),
    confirmed_plan: {
      plan_id: 'plan-saturday-activity',
      version: 1,
      selected_components: [
        {
          component_id: 'component-activity',
          option_id: 'option-riverside-picnic',
        },
      ],
      confirmation_state: 'confirmed',
    },
    fixture_state: initialDecisionState.fixture_state,
    operation_ids: [RECEIPT.operation_id],
    operation_receipts: [RECEIPT],
    expires_at: 1_800_000_000,
  };
}

function freshItem(): DynamoDbDecisionItem {
  return {
    ...populatedItem(),
    version: 1,
    selected_candidate_id: null,
    participant_responses: initialDecisionState.participant_responses.map(
      response => ({...response}),
    ),
    confirmed_plan: null,
    operation_ids: [],
    operation_receipts: [],
  };
}

describe('PERSISTENCE-001 DynamoDB DTO types', () => {
  it('keeps exactly the ten canonical persisted attributes', () => {
    expect(Object.keys(populatedItem())).toEqual([
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

  it('carries the schema version, decision identity, and positive version', () => {
    const item = populatedItem();

    expect(item.schema_version).toBe(1);
    expect(item.decision_id).toBe('decision-saturday-activity');
    expect(item.version).toBe(2);
    expect(Number.isInteger(item.version)).toBe(true);
    expect(item.version).toBeGreaterThan(0);
  });

  it('preserves the ordered participant responses', () => {
    const item = populatedItem();

    expect(item.participant_responses.map(response => response.participant_id)).toEqual(
      [
        'participant-alex',
        'participant-blair',
        'participant-casey',
        'participant-devon',
      ],
    );
    expect(
      item.participant_responses.every(
        response => response.response_state === 'approved',
      ),
    ).toBe(true);
    expect(freshItem().participant_responses).toEqual(
      initialDecisionState.participant_responses,
    );
  });

  it('encodes absent selection and plan as null, never undefined', () => {
    const fresh = freshItem();
    const populated = populatedItem();

    expect(fresh.selected_candidate_id).toBeNull();
    expect(fresh.confirmed_plan).toBeNull();
    expect(fresh.selected_candidate_id).not.toBeUndefined();
    expect(fresh.confirmed_plan).not.toBeUndefined();
    expect(populated.selected_candidate_id).toBe('option-riverside-picnic');
    expect(populated.confirmed_plan?.confirmation_state).toBe('confirmed');
  });

  it('carries accepted operation ids and bounded receipts', () => {
    const item = populatedItem();

    expect(item.operation_ids).toEqual(['op-select-riverside-1']);
    expect(item.operation_receipts).toEqual([RECEIPT]);
    expect(Object.keys(RECEIPT)).toEqual([
      'operation_id',
      'mutation_fingerprint',
      'committed_version',
    ]);
  });

  it('carries the epoch-seconds expiry as an integer', () => {
    const item = populatedItem();

    expect(Number.isInteger(item.expires_at)).toBe(true);
    expect(item.expires_at).toBe(1_800_000_000);
  });

  it('contains no UI, focus, feasibility, consensus, credential, or table-config fields', () => {
    const fieldNames = JSON.stringify({
      populated: populatedItem(),
      fresh: freshItem(),
    })
      .match(/"([^"]+)":/g)
      ?.map(field => field.toLowerCase())
      .join(' ');

    expect(fieldNames).toBeDefined();
    expect(fieldNames).not.toMatch(
      /consensus|feasib|focus|ui_|render|display|label|credential|secret|access_?key|session_?token|table|region|endpoint|billing|index/,
    );

    for (const item of [populatedItem(), freshItem()]) {
      expect(Object.keys(item)).not.toContain('ui_state');
      expect(Object.keys(item)).not.toContain('focus_state');
      expect(Object.keys(item)).not.toContain('feasibility_result');
      expect(Object.keys(item)).not.toContain('consensus_status');
      expect(Object.keys(item)).not.toContain('access_key_id');
      expect(Object.keys(item)).not.toContain('secret_access_key');
      expect(Object.keys(item)).not.toContain('table_name');
      expect(Object.keys(item)).not.toContain('billing_mode');
    }
  });
});
