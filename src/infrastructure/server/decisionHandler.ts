import type {DecisionSession} from '../../application/decisionSession';

const MAX_BODY_BYTES = 32 * 1024;

export type DecisionHandlerEvent = Readonly<{
  body?: string | null;
  isBase64Encoded?: boolean;
}>;

export type DecisionHandlerResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;

function response(statusCode: number, body: unknown): DecisionHandlerResponse {
  return {
    statusCode,
    headers: {'content-type': 'application/json; charset=utf-8'},
    body: JSON.stringify(body),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function validIdentity(value: unknown): value is {operation_id: string; base_version: number} {
  return (
    isObject(value) &&
    typeof value.operation_id === 'string' &&
    value.operation_id.length > 0 &&
    value.operation_id.length <= 128 &&
    Number.isSafeInteger(value.base_version) &&
    (value.base_version as number) > 0
  );
}

export function createDecisionHandler(session: DecisionSession) {
  return async (event: DecisionHandlerEvent): Promise<DecisionHandlerResponse> => {
    if (
      event.isBase64Encoded === true ||
      typeof event.body !== 'string' ||
      event.body.length === 0 ||
      utf8ByteLength(event.body) > MAX_BODY_BYTES
    ) {
      return response(400, {kind: 'INVALID_REQUEST'});
    }
    let command: unknown;
    try {
      command = JSON.parse(event.body) as unknown;
    } catch {
      return response(400, {kind: 'INVALID_REQUEST'});
    }
    if (!isObject(command) || typeof command.kind !== 'string') {
      return response(400, {kind: 'INVALID_REQUEST'});
    }
    switch (command.kind) {
      case 'OPEN':
        return response(200, await session.open());
      case 'START_FIXTURE':
        return response(200, await session.startFixture());
      case 'SELECT_CANDIDATE':
        if (!validIdentity(command.identity) || typeof command.candidate_id !== 'string') {
          return response(400, {kind: 'INVALID_REQUEST'});
        }
        return response(200, await session.selectCandidate(command.identity, command.candidate_id as never));
      case 'SET_PARTICIPANT_RESPONSE':
        if (
          !validIdentity(command.identity) ||
          typeof command.participant_id !== 'string' ||
          (command.response_state !== 'approved' && command.response_state !== 'rejected')
        ) {
          return response(400, {kind: 'INVALID_REQUEST'});
        }
        return response(200, await session.setParticipantResponse(
          command.identity,
          command.participant_id as never,
          command.response_state,
        ));
      case 'CONFIRM_PLAN':
        if (!validIdentity(command.identity)) {
          return response(400, {kind: 'INVALID_REQUEST'});
        }
        return response(200, await session.confirmPlan(command.identity));
      case 'BEGIN_SCOPED_REPLAN':
        return response(200, await session.beginScopedReplan());
      case 'CONFIRM_SCOPED_REPLAN':
        if (
          typeof command.operation_id !== 'string' ||
          command.operation_id.length === 0 ||
          command.operation_id.length > 128 ||
          !isObject(command.flow)
        ) {
          return response(400, {kind: 'INVALID_REQUEST'});
        }
        return response(200, await session.confirmScopedReplan(
          command.operation_id,
          command.flow as never,
        ));
      default:
        return response(400, {kind: 'INVALID_REQUEST'});
    }
  };
}
