/* eslint-env jest */
import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type {
  GetItemCommandOutput,
  PutItemCommandOutput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';

// React Native's Jest resolver selects the SDK's untransformed ESM native
// submodule. Keep the adapter compiled against the real SDK declarations while
// using these hand-written command shells with the injected fake send surface.
jest.mock('@aws-sdk/client-dynamodb', () => {
  class Command {
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  class ConditionalFailure extends Error {
    readonly name = 'ConditionalCheckFailedException';
    readonly $metadata: unknown;

    constructor(options: {message?: string; $metadata?: unknown}) {
      super(options.message);
      this.$metadata = options.$metadata;
    }
  }

  return {
    ConditionalCheckFailedException: ConditionalFailure,
    GetItemCommand: class GetCommandShell extends Command {},
    PutItemCommand: class PutCommandShell extends Command {},
    UpdateItemCommand: class UpdateCommandShell extends Command {},
  };
});
import type {
  ApplyDecisionMutationInput,
  DecisionSnapshot,
  OperationReceipt,
} from '../../../src/application/decisionStore';
import {MAX_OPERATION_RECEIPTS} from '../../../src/application/decisionStore';
import {
  initialDecisionState,
  referenceCandidateOptions,
} from '../../../src/domain/fixtures';
import type {DecisionId} from '../../../src/domain/types';
import {
  DynamoDbDecisionStore,
  type DynamoDbDecisionClient,
} from '../../../src/infrastructure/persistence/dynamoDbDecisionStore';
import type {DynamoDbDecisionItem} from '../../../src/infrastructure/persistence/dynamoDbTypes';
import {
  buildPutDecisionItemRequest,
  buildUpdateDecisionItemRequest,
} from '../../../src/infrastructure/persistence/dynamoDbRequests';
import {serializeDecisionItem} from '../../../src/infrastructure/persistence/dynamoDbSerialization';
import {computeMutationFingerprint} from '../../../src/infrastructure/persistence/mutationFingerprint';

type SupportedCommand = GetItemCommand | PutItemCommand | UpdateItemCommand;
type SupportedOutput =
  | GetItemCommandOutput
  | PutItemCommandOutput
  | UpdateItemCommandOutput;

const TABLE_NAME = 'decorda-test-table';
const DECISION_ID: DecisionId = initialDecisionState.decision_id;
const CANDIDATE_ID = referenceCandidateOptions[0].id;

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

function selectedSnapshot(): DecisionSnapshot {
  return {...pendingSnapshot(), selected_candidate_id: CANDIDATE_ID};
}

function decisionItem(
  overrides: Partial<DynamoDbDecisionItem> = {},
): DynamoDbDecisionItem {
  return {
    decision_id: DECISION_ID,
    schema_version: 1,
    version: 1,
    ...pendingSnapshot(),
    operation_ids: [],
    operation_receipts: [],
    expires_at: 2_000,
    ...overrides,
  };
}

function getOutput(item?: DynamoDbDecisionItem): GetItemCommandOutput {
  return {
    ...(item === undefined ? {} : {Item: serializeDecisionItem(item)}),
    $metadata: {},
  } as GetItemCommandOutput;
}

function conditionalFailure(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    $metadata: {requestId: 'raw-request-id'},
    message: 'raw table ARN and endpoint details',
  });
}

function mutationInput(
  overrides: Partial<ApplyDecisionMutationInput> = {},
): ApplyDecisionMutationInput {
  return {
    decision_id: DECISION_ID,
    operation_id: 'operation-1',
    base_version: 1,
    mutation: {kind: 'SELECT_CANDIDATE', candidate_id: CANDIDATE_ID},
    next_state: selectedSnapshot(),
    ...overrides,
  };
}

function receiptFor(input: ApplyDecisionMutationInput): OperationReceipt {
  return {
    operation_id: input.operation_id,
    mutation_fingerprint: computeMutationFingerprint({
      base_version: input.base_version,
      mutation: input.mutation,
      next_state: input.next_state,
    }),
    committed_version: input.base_version + 1,
  };
}

class FakeClient {
  readonly commands: SupportedCommand[] = [];
  private readonly steps: Array<
    (command: SupportedCommand) => SupportedOutput | Promise<SupportedOutput>
  > = [];

  enqueue(output: SupportedOutput): void {
    this.steps.push(() => output);
  }

  enqueueError(error: unknown): void {
    this.steps.push(() => Promise.reject(error));
  }

  enqueueStep(
    step: (
      command: SupportedCommand,
    ) => SupportedOutput | Promise<SupportedOutput>,
  ): void {
    this.steps.push(step);
  }

  async send(command: SupportedCommand): Promise<SupportedOutput> {
    this.commands.push(command);
    const step = this.steps.shift();
    if (!step) {
      throw new Error('unexpected fake client send');
    }
    return step(command);
  }
}

function storeWith(client: FakeClient): DynamoDbDecisionStore {
  return new DynamoDbDecisionStore({
    client: client as unknown as DynamoDbDecisionClient,
    tableName: TABLE_NAME,
  });
}

function createInput() {
  return {
    decision_id: DECISION_ID,
    initial_state: pendingSnapshot(),
    expires_at: 2_000,
  } as const;
}

describe('DynamoDbDecisionStore loadDecision', () => {
  it('sends the exact table/key with a strongly consistent GetItem', async () => {
    const client = new FakeClient();
    client.enqueue(getOutput());

    await storeWith(client).loadDecision(DECISION_ID);

    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]).toBeInstanceOf(GetItemCommand);
    expect(client.commands[0].input).toEqual({
      TableName: TABLE_NAME,
      Key: {decision_id: {S: DECISION_ID}},
      ConsistentRead: true,
    });
  });

  it('returns NOT_FOUND when DynamoDB has no item', async () => {
    const client = new FakeClient();
    client.enqueue(getOutput());

    await expect(storeWith(client).loadDecision(DECISION_ID)).resolves.toEqual({
      kind: 'NOT_FOUND',
      decision_id: DECISION_ID,
    });
  });

  it('deserializes a found item into canonical state', async () => {
    const client = new FakeClient();
    client.enqueue(
      getOutput(
        decisionItem({version: 3, selected_candidate_id: CANDIDATE_ID}),
      ),
    );

    await expect(storeWith(client).loadDecision(DECISION_ID)).resolves.toEqual({
      kind: 'FOUND',
      canonical_state: {
        ...pendingSnapshot(),
        decision_id: DECISION_ID,
        version: 3,
        selected_candidate_id: CANDIDATE_ID,
      },
    });
  });
});

describe('DynamoDbDecisionStore createDecision', () => {
  it('preserves the P3 conditional create request', async () => {
    const client = new FakeClient();
    client.enqueue({$metadata: {}});
    client.enqueue(getOutput(decisionItem()));

    await storeWith(client).createDecision(createInput());

    const command = client.commands[0];
    expect(command).toBeInstanceOf(PutItemCommand);
    const expected = buildPutDecisionItemRequest(TABLE_NAME, createInput());
    expect(command.input).toMatchObject({
      TableName: expected.TableName,
      ConditionExpression: expected.ConditionExpression,
      ExpressionAttributeNames: expected.ExpressionAttributeNames,
      ReturnValues: 'NONE',
      Item: expected.Item,
    });
  });

  it('strongly refreshes after success and returns CREATED', async () => {
    const client = new FakeClient();
    client.enqueue({$metadata: {}});
    client.enqueue(getOutput(decisionItem()));

    const result = await storeWith(client).createDecision(createInput());

    expect(client.commands.map((command) => command.constructor)).toEqual([
      PutItemCommand,
      GetItemCommand,
    ]);
    expect((client.commands[1] as GetItemCommand).input.ConsistentRead).toBe(
      true,
    );
    expect(result).toMatchObject({
      kind: 'CREATED',
      canonical_state: {version: 1},
    });
  });

  it('returns ALREADY_EXISTS after a conditional failure and strong read', async () => {
    const client = new FakeClient();
    client.enqueueError(conditionalFailure());
    client.enqueue(getOutput(decisionItem({version: 4})));

    await expect(
      storeWith(client).createDecision(createInput()),
    ).resolves.toMatchObject({
      kind: 'ALREADY_EXISTS',
      canonical_state: {version: 4},
    });
    expect(client.commands[1]).toBeInstanceOf(GetItemCommand);
    expect((client.commands[1] as GetItemCommand).input.ConsistentRead).toBe(
      true,
    );
  });

  it('fails safely when conditional failure is followed by a missing item', async () => {
    const client = new FakeClient();
    client.enqueueError(conditionalFailure());
    client.enqueue(getOutput());

    await expect(
      storeWith(client).createDecision(createInput()),
    ).resolves.toEqual({
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: false,
      safe_code: 'DYNAMODB_CONDITION_STATE_MISSING',
    });
  });
});

describe('DynamoDbDecisionStore applyMutation command and success', () => {
  it('composes TableName/Key while preserving P3 expressions and NONE', async () => {
    const input = mutationInput();
    const client = new FakeClient();
    client.enqueue(getOutput(decisionItem()));
    client.enqueue({$metadata: {}});
    client.enqueue(
      getOutput(
        decisionItem({
          ...selectedSnapshot(),
          version: 2,
          operation_ids: [input.operation_id],
          operation_receipts: [receiptFor(input)],
        }),
      ),
    );

    await storeWith(client).applyMutation(input);

    const update = client.commands[1];
    expect(update).toBeInstanceOf(UpdateItemCommand);
    const p3 = buildUpdateDecisionItemRequest({
      base_version: input.base_version,
      receipt: receiptFor(input),
      next_state: input.next_state,
    });
    expect(update.input).toEqual({
      TableName: TABLE_NAME,
      Key: {decision_id: {S: DECISION_ID}},
      ConditionExpression: p3.ConditionExpression,
      UpdateExpression: p3.UpdateExpression,
      ExpressionAttributeNames: p3.ExpressionAttributeNames,
      ExpressionAttributeValues: p3.ExpressionAttributeValues,
      ReturnValues: 'NONE',
    });
  });

  it('returns the original committed version with the refreshed canonical state', async () => {
    const input = mutationInput();
    const client = new FakeClient();
    client.enqueue(getOutput(decisionItem()));
    client.enqueue({$metadata: {}});
    client.enqueue(
      getOutput(
        decisionItem({
          ...selectedSnapshot(),
          version: 7,
          operation_ids: [input.operation_id],
          operation_receipts: [receiptFor(input)],
        }),
      ),
    );

    await expect(storeWith(client).applyMutation(input)).resolves.toMatchObject(
      {
        kind: 'APPLIED',
        applied: true,
        operation_id: input.operation_id,
        committed_version: 2,
        canonical_state: {version: 7, selected_candidate_id: CANDIDATE_ID},
      },
    );
    expect(client.commands[2]).toBeInstanceOf(GetItemCommand);
    expect((client.commands[2] as GetItemCommand).input.ConsistentRead).toBe(
      true,
    );
  });

  it('enforces the complete 32 KiB serialization envelope before UpdateItem', async () => {
    const oversized = mutationInput({
      next_state: {
        ...selectedSnapshot(),
        fixture_state: {
          ...selectedSnapshot().fixture_state,
          context_change_ids: [
            `context-change-${'x'.repeat(
              40_000,
            )}` as `context-change-${string}`,
          ],
        },
      },
    });
    const client = new FakeClient();
    client.enqueue(getOutput(decisionItem()));

    await expect(storeWith(client).applyMutation(oversized)).resolves.toEqual({
      kind: 'LIMIT_EXCEEDED',
      reason: 'ITEM_SIZE',
    });
    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]).toBeInstanceOf(GetItemCommand);
  });
});

describe('DynamoDbDecisionStore conditional classification', () => {
  async function classify(
    input: ApplyDecisionMutationInput,
    refreshed?: DynamoDbDecisionItem,
  ) {
    const client = new FakeClient();
    client.enqueue(getOutput(refreshed));
    client.enqueueError(conditionalFailure());
    client.enqueue(getOutput(refreshed));
    return {result: await storeWith(client).applyMutation(input), client};
  }

  it('classifies same operation ID and fingerprint as replay', async () => {
    const input = mutationInput();
    const receipt = receiptFor(input);
    const {result} = await classify(
      input,
      decisionItem({
        version: 5,
        operation_ids: [input.operation_id],
        operation_receipts: [{...receipt, committed_version: 2}],
      }),
    );

    expect(result).toMatchObject({
      kind: 'IDEMPOTENT_REPLAY',
      committed_version: 2,
      canonical_state: {version: 5},
    });
  });

  it('classifies same operation ID with a different fingerprint as conflict', async () => {
    const input = mutationInput();
    const {result} = await classify(
      input,
      decisionItem({
        version: 5,
        operation_ids: [input.operation_id],
        operation_receipts: [
          {...receiptFor(input), mutation_fingerprint: 'different'},
        ],
      }),
    );

    expect(result).toMatchObject({
      kind: 'OPERATION_ID_CONFLICT',
      current_version: 5,
    });
  });

  it('gives replay and conflict precedence over stale classification', async () => {
    const input = mutationInput({base_version: 1});
    const receipt = receiptFor(input);
    const replay = await classify(
      input,
      decisionItem({
        version: 9,
        operation_ids: [input.operation_id],
        operation_receipts: [receipt],
      }),
    );
    const conflict = await classify(
      input,
      decisionItem({
        version: 9,
        operation_ids: [input.operation_id],
        operation_receipts: [{...receipt, mutation_fingerprint: 'different'}],
      }),
    );

    expect(replay.result.kind).toBe('IDEMPOTENT_REPLAY');
    expect(conflict.result.kind).toBe('OPERATION_ID_CONFLICT');
  });

  it('classifies a different current version as stale', async () => {
    const {result} = await classify(
      mutationInput(),
      decisionItem({version: 4}),
    );

    expect(result).toMatchObject({
      kind: 'STALE_VERSION',
      current_version: 4,
      canonical_state: {version: 4},
    });
  });

  it('classifies a full receipt list as OPERATION_COUNT', async () => {
    const receipts = Array.from(
      {length: MAX_OPERATION_RECEIPTS},
      (_, index) => ({
        operation_id: `prior-${index}`,
        mutation_fingerprint: `fingerprint-${index}`,
        committed_version: index + 2,
      }),
    );
    const {result} = await classify(
      mutationInput({base_version: 41}),
      decisionItem({
        version: 41,
        operation_ids: receipts.map((receipt) => receipt.operation_id),
        operation_receipts: receipts,
      }),
    );

    expect(result).toEqual({kind: 'LIMIT_EXCEEDED', reason: 'OPERATION_COUNT'});
  });

  it('classifies a missing item as NOT_FOUND', async () => {
    const {result} = await classify(mutationInput());

    expect(result).toEqual({kind: 'NOT_FOUND', decision_id: DECISION_ID});
  });

  it('normalizes an unexplained conditional failure', async () => {
    const {result} = await classify(mutationInput(), decisionItem());

    expect(result).toEqual({
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: false,
      safe_code: 'DYNAMODB_CONDITION_UNEXPLAINED',
    });
  });

  it('never retries the conditional mutation', async () => {
    const {client} = await classify(
      mutationInput(),
      decisionItem({version: 4}),
    );

    expect(
      client.commands.filter((command) => command instanceof UpdateItemCommand),
    ).toHaveLength(1);
  });
});

describe('DynamoDbDecisionStore error and product boundaries', () => {
  it('normalizes non-conditional SDK errors without raw AWS details', async () => {
    const client = new FakeClient();
    const error = Object.assign(new Error('secret endpoint and table ARN'), {
      name: 'ProvisionedThroughputExceededException',
      $metadata: {requestId: 'raw-request-id', httpStatusCode: 400},
      $retryable: {throttling: true},
    });
    client.enqueueError(error);

    const result = await storeWith(client).loadDecision(DECISION_ID);

    expect(result).toEqual({
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: true,
      safe_code: 'DYNAMODB_THROTTLED',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('raw-request-id');
  });

  it('normalizes malformed stored data instead of exposing deserializer errors', async () => {
    const client = new FakeClient();
    client.enqueue({
      Item: {decision_id: {S: DECISION_ID}},
      $metadata: {requestId: 'raw-request-id'},
    } as GetItemCommandOutput);

    await expect(storeWith(client).loadDecision(DECISION_ID)).resolves.toEqual({
      kind: 'INFRASTRUCTURE_ERROR',
      retryable: false,
      safe_code: 'DYNAMODB_ITEM_INVALID',
    });
  });

  it('passes through upstream product state without feasibility or consensus logic', async () => {
    const product_illegal_state: DecisionSnapshot = {
      ...selectedSnapshot(),
      selected_candidate_id: 'option-not-in-fixture',
    };
    const input = mutationInput({next_state: product_illegal_state});
    const client = new FakeClient();
    client.enqueue(getOutput(decisionItem()));
    client.enqueue({$metadata: {}});
    client.enqueue(
      getOutput(
        decisionItem({
          ...product_illegal_state,
          version: 2,
          operation_ids: [input.operation_id],
          operation_receipts: [receiptFor(input)],
        }),
      ),
    );

    const result = await storeWith(client).applyMutation(input);

    expect(result).toMatchObject({
      kind: 'APPLIED',
      canonical_state: {selected_candidate_id: 'option-not-in-fixture'},
    });
  });

  it('uses only the injected send surface', async () => {
    const client = new FakeClient();
    client.enqueueStep((command) => {
      expect(command).toBeInstanceOf(GetItemCommand);
      return getOutput();
    });

    await storeWith(client).loadDecision(DECISION_ID);

    expect(client.commands).toHaveLength(1);
  });
});
