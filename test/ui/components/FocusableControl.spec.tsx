import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import type {View} from 'react-native';
import type {ReactTestInstance} from 'react-test-renderer';

import FocusableControl, {FOCUSABLE_CONTROL_COLORS} from '../../../src/ui/components/FocusableControl';
import type {FocusableControlProps} from '../../../src/ui/components/FocusableControl';

const COMPONENT_SOURCE = (
  jest.requireActual('fs') as {
    readFileSync: (filePath: string, encoding: string) => string;
  }
).readFileSync(
  (jest.requireActual('path') as {
    join: (...segments: Array<string>) => string;
  }).join('src', 'ui', 'components', 'FocusableControl.tsx'),
  'utf8',
);

const CONTROL_LABEL = 'Review shared plan';
const UNFOCUSED_CUE = {borderWidth: 5, padding: 6, transform: [{scale: 1}]};
const FOCUSED_CUE = {borderColor: FOCUSABLE_CONTROL_COLORS.focusedBorder, transform: [{scale: 1.02}]};

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function renderControl(overrides: Partial<FocusableControlProps> = {}) {
  const onPress = jest.fn();
  const screen = render(
    <FocusableControl label={CONTROL_LABEL} onPress={onPress} {...overrides} />,
  );
  return {onPress, screen};
}

function renderControlWithRef(ref: React.Ref<View>) {
  const onPress = jest.fn();
  const screen = render(
    <FocusableControl ref={ref} label={CONTROL_LABEL} onPress={onPress} />,
  );
  return {onPress, screen};
}

function getControl(
  screen: ReturnType<typeof renderControl>['screen'],
): ReactTestInstance {
  return screen.getByRole('button', {name: CONTROL_LABEL});
}

function styleEntries(control: ReactTestInstance): Array<Record<string, unknown>> {
  const style = control.props.style as unknown[];
  return style.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null,
  );
}

describe('FocusableControl', () => {
  it('renders its visible label', () => {
    const {screen} = renderControl();

    expect(screen.getByText(CONTROL_LABEL)).toBeTruthy();
  });

  it('exposes the underlying control as accessible', () => {
    const {screen} = renderControl();

    expect(getControl(screen).props.accessible).toBe(true);
  });

  it('exposes the button accessibility role', () => {
    const {screen} = renderControl();

    expect(getControl(screen).props.accessibilityRole).toBe('button');
  });

  it('exposes the supplied accessibility label', () => {
    const {screen} = renderControl({
      accessibilityLabel: 'Open the shared plan review',
    });

    expect(
      screen.getByRole('button', {name: 'Open the shared plan review'}),
    ).toBeTruthy();
  });

  it('exposes the supplied accessibility hint and omits it when not supplied', () => {
    const hinted = renderControl({accessibilityHint: 'Shows the shared plan'});
    expect(hinted.screen.getByHintText('Shows the shared plan')).toBeTruthy();

    const unhinted = renderControl();
    expect(unhinted.screen.queryByHintText('Shows the shared plan')).toBeNull();
  });

  it('reports an enabled, focusable control by default', () => {
    const {screen} = renderControl();
    const control = getControl(screen);

    expect(
      screen.getByRole('button', {name: CONTROL_LABEL, disabled: false}),
    ).toBeTruthy();
    expect(control.props.accessibilityState.disabled).toBe(false);
    expect(control.props.focusable).toBe(true);
  });

  it('reports the disabled state and drops D-pad focusability', () => {
    const {screen} = renderControl({disabled: true});

    const control = screen.getByRole('button', {
      name: CONTROL_LABEL,
      disabled: true,
    });
    expect(control.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(`${CONTROL_LABEL} · UNAVAILABLE`)).toBeTruthy();
    expect(control.props.focusable).toBe(false);
  });

  it('reports the selected state', () => {
    const {screen} = renderControl({selected: true});

    expect(
      screen.getByRole('button', {name: CONTROL_LABEL, selected: true}),
    ).toBeTruthy();
    expect(getControl(screen).props.accessibilityState.selected).toBe(true);
  });

  it('activates the supplied action when enabled', () => {
    const {onPress, screen} = renderControl();
    const control = getControl(screen);

    fireEvent(control, 'pressIn');
    fireEvent(control, 'pressOut');

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not activate the supplied action when disabled', () => {
    const {onPress, screen} = renderControl({disabled: true});
    const control = getControl(screen);

    fireEvent(control, 'pressIn');
    fireEvent(control, 'pressOut');

    expect(onPress).not.toHaveBeenCalled();
  });

  it('switches to the focused visual state on focus', () => {
    const {screen} = renderControl();
    const control = getControl(screen);
    expect(styleEntries(control)).toContainEqual(
      expect.objectContaining(UNFOCUSED_CUE),
    );

    fireEvent(control, 'focus');

    expect(styleEntries(control)).toContainEqual(
      expect.objectContaining(FOCUSED_CUE),
    );
  });

  it('restores the unfocused visual state on blur', () => {
    const {screen} = renderControl();
    const control = getControl(screen);
    fireEvent(control, 'focus');

    fireEvent(control, 'blur');

    expect(styleEntries(control)).toContainEqual(
      expect.objectContaining(UNFOCUSED_CUE),
    );
    expect(styleEntries(control)).not.toContainEqual(
      expect.objectContaining(FOCUSED_CUE),
    );
  });

  it('signals focus with a non-color-only physical cue', () => {
    const {screen} = renderControl();
    const control = getControl(screen);

    const unfocused = styleEntries(control).find(
      entry => entry.borderWidth === UNFOCUSED_CUE.borderWidth,
    );
    expect(unfocused?.transform).toEqual([{scale: 1}]);

    fireEvent(control, 'focus');

    const focused = styleEntries(control).find(
      entry => entry.borderColor === FOCUSABLE_CONTROL_COLORS.focusedBorder,
    );
    expect(focused).toBeDefined();
    expect(styleEntries(control)[0].borderWidth).toBe(UNFOCUSED_CUE.borderWidth);
    expect(focused?.borderColor).toBe(FOCUSABLE_CONTROL_COLORS.focusedBorder);
    expect(focused?.transform).toEqual([{scale: 1.02}]);
  });

  it('does not request preferred initial focus by default', () => {
    const {screen} = renderControl();

    expect(getControl(screen).props.hasTVPreferredFocus).toBe(false);
  });

  it('maps the preferred-initial-focus flag onto the initial focus request', () => {
    const {screen} = renderControl({preferredInitialFocus: true});
    expect(getControl(screen).props.hasTVPreferredFocus).toBe(true);

    const disabled = renderControl({disabled: true, preferredInitialFocus: true});
    expect(getControl(disabled.screen).props.hasTVPreferredFocus).toBe(false);
  });

  it('does not use or render any focus-restoration mechanism', () => {
    expect(COMPONENT_SOURCE).not.toMatch(/FocusManager/);
    expect(COMPONENT_SOURCE).not.toMatch(/TVFocusGuideView/);
    expect(COMPONENT_SOURCE).not.toMatch(/nextFocus/);
    expect(COMPONENT_SOURCE).not.toMatch(/enableSynchronousFocusEvents/);

    const {screen} = renderControl();
    const control = getControl(screen);
    expect(control.props.nextFocusUp).toBeUndefined();
    expect(control.props.nextFocusDown).toBeUndefined();
    expect(control.props.nextFocusLeft).toBeUndefined();
    expect(control.props.nextFocusRight).toBeUndefined();
    expect(control.props.nextFocusForward).toBeUndefined();
  });

  it('does not use the TV event handler hook', () => {
    expect(COMPONENT_SOURCE).not.toMatch(/useTVEventHandler/);
  });

  it('does not mutate the supplied props', () => {
    const onPress = jest.fn();
    const props = Object.freeze({
      label: CONTROL_LABEL,
      onPress,
      accessibilityHint: 'Shows the shared plan',
      selected: true,
      preferredInitialFocus: true,
    });

    const screen = render(React.createElement(FocusableControl, props));
    const control = screen.getByRole('button', {name: CONTROL_LABEL});
    fireEvent(control, 'focus');
    fireEvent(control, 'pressIn');
    fireEvent(control, 'pressOut');
    fireEvent(control, 'blur');

    expect(props).toEqual({
      label: CONTROL_LABEL,
      onPress,
      accessibilityHint: 'Shows the shared plan',
      selected: true,
      preferredInitialFocus: true,
    });
    expect(Object.isFrozen(props)).toBe(true);
  });
});

describe('FocusableControl forwarded View ref', () => {
  it('forwards a View ref to the underlying Pressable view', () => {
    const ref = React.createRef<View>();
    const screen = render(
      <FocusableControl ref={ref} label={CONTROL_LABEL} onPress={jest.fn()} />,
    );

    expect(ref.current).not.toBeNull();
    expect(ref.current?.props.accessible).toBe(true);
    expect(ref.current?.props.accessibilityRole).toBe('button');
    expect(
      screen.getByRole('button', {name: CONTROL_LABEL}),
    ).toBeTruthy();
  });

  it('keeps the forwarded ref usable on an enabled control across activation', () => {
    const ref = React.createRef<View>();
    const {onPress, screen} = renderControlWithRef(ref);

    const control = getControl(screen);
    fireEvent(control, 'focus');
    fireEvent(control, 'pressIn');
    fireEvent(control, 'pressOut');
    fireEvent(control, 'blur');

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(ref.current).not.toBeNull();
  });

  it('keeps focus, blur, and press behavior unchanged while a ref is attached', () => {
    const ref = React.createRef<View>();
    const {screen} = renderControlWithRef(ref);
    const control = getControl(screen);

    expect(styleEntries(control)).toContainEqual(
      expect.objectContaining(UNFOCUSED_CUE),
    );

    fireEvent(control, 'focus');
    expect(styleEntries(control)).toContainEqual(
      expect.objectContaining(FOCUSED_CUE),
    );

    fireEvent(control, 'blur');
    expect(styleEntries(control)).toContainEqual(
      expect.objectContaining(UNFOCUSED_CUE),
    );
    expect(styleEntries(control)).not.toContainEqual(
      expect.objectContaining(FOCUSED_CUE),
    );
  });

  it('keeps accessibility exposure unchanged while a ref is forwarded', () => {
    const ref = React.createRef<View>();
    render(
      <FocusableControl
        ref={ref}
        label={CONTROL_LABEL}
        onPress={jest.fn()}
        accessibilityLabel="Ref accessibility probe"
        accessibilityHint="Shows the shared plan"
        selected={true}
      />,
    );

    expect(
      ref.current?.props.accessibilityLabel ?? undefined,
    ).toBeDefined();
    expect(ref.current?.props.accessibilityHint).toBe('Shows the shared plan');
    expect(ref.current?.props.accessibilityState).toEqual({
      disabled: false,
      selected: true,
    });
  });

  it('hands the underlying view to a callback ref and clears it on unmount', () => {
    const received: Array<View | null> = [];
    const {unmount} = render(
      <FocusableControl
        ref={instance => {
          received.push(instance);
        }}
        label={CONTROL_LABEL}
        onPress={jest.fn()}
      />,
    );

    expect(received[0]).not.toBeNull();

    unmount();

    expect(received[received.length - 1]).toBeNull();
  });

  it('keeps hasTVPreferredFocus an initial-mount preference only and adds no focus logic', () => {
    expect(COMPONENT_SOURCE.match(/hasTVPreferredFocus/g)).toHaveLength(1);
    expect(COMPONENT_SOURCE).not.toMatch(
      /FocusManager|findNodeHandle|BackHandler|setTimeout|setInterval|FocusManager\.focus/,
    );

    const preferred = renderControl({preferredInitialFocus: true});
    expect(
      getControl(preferred.screen).props.hasTVPreferredFocus,
    ).toBe(true);

    const {screen} = renderControl();
    fireEvent(getControl(screen), 'focus');
    expect(getControl(screen).props.hasTVPreferredFocus).toBe(false);
  });

  it('meets text, boundary, and focused-indicator contrast thresholds', () => {
    expect(contrastRatio(FOCUSABLE_CONTROL_COLORS.label, FOCUSABLE_CONTROL_COLORS.enabledBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FOCUSABLE_CONTROL_COLORS.label, FOCUSABLE_CONTROL_COLORS.disabledBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FOCUSABLE_CONTROL_COLORS.border, FOCUSABLE_CONTROL_COLORS.disabledBackground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(FOCUSABLE_CONTROL_COLORS.focusedBorder, FOCUSABLE_CONTROL_COLORS.adjacent)).toBeGreaterThanOrEqual(3);
  });

  it('keeps primary, secondary, and absolute treatments accessible', () => {
    for (const variant of ['primary', 'secondary', 'absolute'] as const) {
      const {screen} = renderControl({variant, size: 'compact'});
      const control = getControl(screen);
      expect(control.props.accessibilityRole).toBe('button');
      fireEvent(control, 'focus');
      expect(styleEntries(control)[0].borderWidth).toBe(5);
      expect(styleEntries(control)).toContainEqual(expect.objectContaining({borderColor: FOCUSABLE_CONTROL_COLORS.focusedBorder}));
    }
  });
});
