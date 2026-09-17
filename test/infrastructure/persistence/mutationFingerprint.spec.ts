/* eslint-env jest */
/// <reference types="node" />
import {readFileSync} from 'fs';
import {resolve} from 'path';
import type {
  DecisionMutationIntent,
  DecisionSnapshot,
} from '../../../src/application/decisionStore';
import {
  initialDecisionState,
  referenceCandidateOptions,
} from '../../../src/domain/fixtures';
import {computeMutationFingerprint} from '../../../src/infrastructure/persistence/mutationFingerprint';
import {sha256HexUtf8} from '../../../src/infrastructure/persistence/sha256';

const RIVERSIDE_ID = referenceCandidateOptions[0].id;

function fingerprintFixture(): Readonly<{
  base_version: number;
  mutation: DecisionMutationIntent;
  next_state: DecisionSnapshot;
}> {
  return {
    base_version: 1,
    mutation: {kind: 'SELECT_CANDIDATE', candidate_id: RIVERSIDE_ID},
    next_state: {
      selected_candidate_id: RIVERSIDE_ID,
      participant_responses: initialDecisionState.participant_responses.map(
        (response, index) => ({
          ...response,
          response_state:
            index === 0 ? ('approved' as const) : response.response_state,
        }),
      ),
      confirmed_plan: null,
      fixture_state: initialDecisionState.fixture_state,
    },
  };
}

describe('pure TypeScript SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'Decorda café ☕ 你好',
      '83d279dcbcb31217b771f898a15b4150fbabedb546775c66b34bfa96feba68d1',
    ],
  ])('matches the fixed SHA-256 vector for %p', (input, expected) => {
    expect(sha256HexUtf8(input)).toBe(expected);
  });

  it.each([
    [
      'valid surrogate pair',
      '\ud83d\ude00',
      'f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9',
    ],
    [
      'isolated high surrogate',
      '\ud800',
      '83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097',
    ],
    [
      'isolated low surrogate',
      '\udc00',
      '83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097',
    ],
    [
      'mixed isolated and valid surrogates',
      'A\ud800B\ud83d\ude00C\udc00D',
      'b21af6697782be4600d8e0a691515ca3a2cbf20c957442eac6495ee9d9f09dcc',
    ],
  ])(
    'matches Node UTF-8 replacement behavior for %s',
    (_label, input, expected) => {
      expect(sha256HexUtf8(input)).toBe(expected);
    },
  );

  it('hashes an input spanning multiple 64-byte blocks', () => {
    expect(sha256HexUtf8('a'.repeat(200))).toBe(
      'c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5',
    );
  });

  it.each([
    [
      '55-byte final block',
      `${'é'.repeat(27)}a`,
      '3c9f6b7589808c2738ddef21ae17c0aeaf0c23e81346dd1b3710437826b4b28e',
    ],
    [
      '56-byte final block',
      `${'é'.repeat(26)}😀`,
      '4140f3fbd6c896ecc493e118157c09b1eaa381fac92d94d4c2c6fb1813d83c3f',
    ],
    [
      'multibyte multi-block input',
      `${'é'.repeat(31)}€😀`,
      '35588c655e89506d180699cf71c00d7e26b91725028e5e351f705e4a9ba36a71',
    ],
  ])(
    'handles UTF-8 byte-length boundary: %s',
    (_label, input, expected) => {
      expect(sha256HexUtf8(input)).toBe(expected);
    },
  );

  it('is deterministic across repeated hashing', () => {
    const input = 'deterministic \ud83d\ude00 input'.repeat(20);
    const first = sha256HexUtf8(input);
    expect(sha256HexUtf8(input)).toBe(first);
    expect(sha256HexUtf8(input)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('mutation fingerprint compatibility', () => {
  it('preserves the current canonical fixture golden fingerprint', () => {
    expect(computeMutationFingerprint(fingerprintFixture())).toBe(
      'a12282009a41daaa8ac45a81d2fc9a5e191e6f28a5fbef0692fdb513623704eb',
    );
  });

  it('is stable for an identical replay input and emits lowercase SHA-256 hex', () => {
    const fixture = fingerprintFixture();
    const first = computeMutationFingerprint(fixture);
    expect(computeMutationFingerprint(fixture)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes for a contract-relevant field, base version, or mutation discriminant', () => {
    const fixture = fingerprintFixture();
    const original = computeMutationFingerprint(fixture);
    expect(
      computeMutationFingerprint({
        ...fixture,
        next_state: {...fixture.next_state, selected_candidate_id: null},
      }),
    ).not.toBe(original);
    expect(
      computeMutationFingerprint({...fixture, base_version: 2}),
    ).not.toBe(original);
    expect(
      computeMutationFingerprint({
        ...fixture,
        mutation: {kind: 'CONFIRM_PLAN', plan_id: 'plan-saturday-activity'},
      }),
    ).not.toBe(original);
  });

  it('changes when participant order changes', () => {
    const fixture = fingerprintFixture();
    expect(
      computeMutationFingerprint({
        ...fixture,
        next_state: {
          ...fixture.next_state,
          participant_responses: [
            ...fixture.next_state.participant_responses,
          ].reverse(),
        },
      }),
    ).not.toBe(computeMutationFingerprint(fixture));
  });

  it('changes when selected component order changes', () => {
    const fixture = fingerprintFixture();
    const components = [
      {component_id: 'component-activity' as const, option_id: RIVERSIDE_ID},
      {
        component_id: 'component-return-arrangement' as const,
        option_id: referenceCandidateOptions[1].id,
      },
    ];
    const withPlan: typeof fixture = {
      ...fixture,
      next_state: {
        ...fixture.next_state,
        confirmed_plan: {
          plan_id: 'plan-saturday-activity',
          version: 1,
          confirmation_state: 'confirmed',
          selected_components: components,
        },
      },
    };
    expect(
      computeMutationFingerprint({
        ...withPlan,
        next_state: {
          ...withPlan.next_state,
          confirmed_plan: {
            ...withPlan.next_state.confirmed_plan!,
            selected_components: [...components].reverse(),
          },
        },
      }),
    ).not.toBe(computeMutationFingerprint(withPlan));
  });
});

describe('Vega production boundary', () => {
  it('keeps Node built-ins out of the production fingerprint modules', () => {
    const persistenceDirectory = resolve(
      process.cwd(),
      'src/infrastructure/persistence',
    );
    const fingerprintSource = readFileSync(
      resolve(persistenceDirectory, 'mutationFingerprint.ts'),
      'utf8',
    );
    const sha256Source = readFileSync(
      resolve(persistenceDirectory, 'sha256.ts'),
      'utf8',
    );

    expect(fingerprintSource).not.toMatch(/from ['"](?:node:)?crypto['"]/);
    expect(sha256Source).not.toMatch(/\b(?:import|require)\b/);
  });
});
