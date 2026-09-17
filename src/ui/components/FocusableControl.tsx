import React, {forwardRef, useState} from 'react';
import type {View} from 'react-native';
import {Pressable, StyleSheet, Text, View as InnerView} from 'react-native';
import {colors, focus, typography} from '../theme/conceptA';

export interface FocusableControlProps {
  /** Visible label rendered inside the control. */
  label: string;
  /** Invoked when the focused control is activated with D-pad OK/Select. */
  onPress: () => void;
  /** Accessible name; falls back to the visible label. */
  accessibilityLabel?: string;
  /** Optional non-redundant accessibility hint. */
  accessibilityHint?: string;
  /** Disabled controls cannot activate and are not D-pad focusable. */
  disabled?: boolean;
  /** Reports a selected state to assistive technology. */
  selected?: boolean;
  /** Requests initial D-pad focus for this control on mount. */
  preferredInitialFocus?: boolean;
  variant?: 'primary' | 'secondary' | 'absolute';
  size?: 'standard' | 'compact' | 'replanCompact';
}

export const FOCUSABLE_CONTROL_COLORS = {
  adjacent: colors.ground,
  enabledBackground: colors.secondaryActionBackground,
  disabledBackground: colors.recessedPanel,
  border: colors.inactiveBorder,
  focusedBackground: colors.secondaryActionBackground,
  focusedBorder: colors.signal,
  label: colors.ink,
} as const;

function FocusableControlBase(
  {
    label,
    onPress,
    accessibilityLabel,
    accessibilityHint,
    disabled = false,
    selected = false,
    preferredInitialFocus = false,
    variant = 'secondary',
    size = 'standard',
  }: FocusableControlProps,
  ref: React.ForwardedRef<View>,
): React.JSX.Element {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      ref={ref}
      accessible={true}
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{disabled, selected}}
      disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={preferredInitialFocus && !disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={[
        styles.control,
        size === 'compact' && styles.compactFrame,
        size === 'replanCompact' && styles.replanFrame,
        focused && styles.controlFocused,
        focused && size === 'compact' && styles.compactFocused,
        focused && size === 'replanCompact' && styles.replanFocused,
      ]}>
      <InnerView style={[
        styles.inner,
        variant === 'primary' && styles.primary,
        variant === 'absolute' && styles.absolute,
        disabled && styles.controlDisabled,
        selected && !disabled && styles.selected,
        size === 'compact' && styles.compact,
        size === 'replanCompact' && styles.replanCompact,
      ]}>
        <Text style={[styles.label, variant !== 'secondary' && !disabled && styles.darkLabel,
          size !== 'standard' && styles.compactLabel, disabled && styles.disabledLabel]}>
          {disabled ? `${label} · UNAVAILABLE` : label}
        </Text>
      </InnerView>
    </Pressable>
  );
}

// The forwarded View ref exposes the underlying Pressable view so a screen
// can attach it to a semantic-key registry and restore D-pad focus
// deterministically after returning from a child flow. The primitive itself
// stays free of any focus-management logic.
const FocusableControl = forwardRef<View, FocusableControlProps>(
  FocusableControlBase,
);

export default FocusableControl;

const styles = StyleSheet.create({
  control: {
    alignSelf: 'flex-start', borderColor: 'transparent', borderWidth: focus.outerWidth,
    padding: focus.gap,
    transform: [{scale: 1}],
  },
  compactFrame: {},
  replanFrame: {},
  controlFocused: {
    borderColor: FOCUSABLE_CONTROL_COLORS.focusedBorder,
    transform: [{scale: focus.standardScale}],
  },
  compactFocused: {transform: [{scale: focus.compactScale}]},
  replanFocused: {transform: [{scale: focus.smallScale}]},
  inner: {alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryActionBackground,
    borderColor: colors.inkTertiary, borderWidth: 1, paddingVertical: 22, paddingHorizontal: 30},
  primary: {backgroundColor: colors.signal, borderColor: colors.signal},
  absolute: {backgroundColor: colors.absolute, borderColor: colors.absolute},
  controlDisabled: {backgroundColor: colors.recessedPanel, borderColor: colors.inactiveBorder,
    borderStyle: 'dashed'},
  selected: {borderWidth: 3, borderColor: colors.absolute},
  compact: {paddingVertical: 18, paddingHorizontal: 26},
  replanCompact: {paddingVertical: 16, paddingHorizontal: 24},
  label: {
    color: FOCUSABLE_CONTROL_COLORS.label,
    fontSize: typography.controlStandard,
    fontWeight: '600',
  },
  darkLabel: {color: colors.actionInk},
  compactLabel: {fontSize: typography.controlCompact},
  disabledLabel: {color: colors.inkSecondary},
});
