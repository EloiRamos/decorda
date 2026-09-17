import {AppRegistry} from 'react-native';

import {name as appName} from '../app.json';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as Record<string, unknown>;
  const namespace: Record<string, unknown> = {__esModule: true};
  const overrides: Record<string, unknown> = {
    AppRegistry: {registerComponent: jest.fn()},
    LogBox: {ignoreAllLogs: jest.fn()},
  };

  for (const key of Object.getOwnPropertyNames(actual)) {
    if (key === '__esModule' || key in overrides) {
      continue;
    }
    Object.defineProperty(namespace, key, {
      enumerable: true,
      configurable: true,
      get: () => actual[key],
    });
  }
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(namespace, key, {
      enumerable: true,
      configurable: true,
      value,
    });
  }
  return namespace;
});

describe('Decorda production bootstrap', () => {
  it('registers the real default App export under the configured app name', () => {
    let actualApp: unknown;
    jest.isolateModules(() => {
      actualApp = (
        jest.requireActual('../src/App') as {default: unknown}
      ).default;
      jest.requireActual('../index');
    });

    const registerComponent =
      AppRegistry.registerComponent as jest.MockedFunction<
        typeof AppRegistry.registerComponent
      >;
    expect(registerComponent).toHaveBeenCalledTimes(1);

    const [registeredName, provider] = registerComponent.mock.calls[0];
    const registeredComponent = provider();

    expect(registeredName).toBe(appName);
    expect(registeredComponent).toBe(actualApp);
    expect(typeof registeredComponent).toBe('function');
  });
});
