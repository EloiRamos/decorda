/* global globalThis */
import React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';
import App from '../src/App';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as Record<string, unknown>;
  const namespace: Record<string, unknown> = {__esModule: true};
  const overrides: Record<string, unknown> = {
    AppState: {currentState: 'active', addEventListener: jest.fn().mockReturnValue({remove: jest.fn()})},
    BackHandler: {addEventListener: jest.fn().mockReturnValue({remove: jest.fn()}), exitApp: jest.fn()},
    FocusManager: {focus: jest.fn(), blur: jest.fn(), getFocused: jest.fn()},
    findNodeHandle: jest.fn(),
  };
  for (const key of Object.getOwnPropertyNames(actual)) {
    if (key === '__esModule' || key in overrides) continue;
    Object.defineProperty(namespace, key, {enumerable: true, configurable: true, get: () => actual[key]});
  }
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(namespace, key, {enumerable: true, configurable: true, value});
  return namespace;
});

describe('App runtime composition', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    delete globalThis.__DECORDA_RUNTIME_CONFIG__;
    globalThis.fetch = originalFetch;
  });

  it('defaults to labelled local fixture mode without a network request', () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as never;
    const screen = render(<App />);
    expect(screen.getByText('DECORDA')).toBeTruthy();
    expect(screen.getByText(/Local fixture · process-lifetime persistence/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails visibly for an attempted invalid durable configuration', () => {
    globalThis.__DECORDA_RUNTIME_CONFIG__ = {mode: 'durable_https', endpoint: 'http://invalid', expiresAtEpochSeconds: 100, clientId: 'tv'};
    const screen = render(<App />);
    expect(screen.getByText('DECORDA')).toBeTruthy();
    expect(screen.getByText('■ UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('DECISION SESSION UNAVAILABLE')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('selects the configured HTTPS path through the real App entry', async () => {
    globalThis.__DECORDA_RUNTIME_CONFIG__ = {mode: 'durable_https', endpoint: 'https://example.invalid/decision', expiresAtEpochSeconds: 100, clientId: 'tv'};
    globalThis.fetch = jest.fn().mockResolvedValue({status: 200, text: async () => JSON.stringify({kind: 'NOT_FOUND', decision_id: 'decision-saturday-activity'})}) as never;
    const screen = render(<App />);
    expect(screen.getByText(/Durable HTTPS session/)).toBeTruthy();
    await act(async () => {fireEvent.press(screen.getByRole('button', {name: 'Open shared decision'})); await Promise.resolve();});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Decision not found/).length).toBeGreaterThan(0);
  });

  it('keeps AWS credentials and adapters out of rendered TV configuration', () => {
    const rendered = JSON.stringify(render(<App />).toJSON());
    expect(rendered).not.toMatch(/aws_access|secret|arn:|tableName|dynamodb/i);
  });
});
