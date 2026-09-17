import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {LayoutChangeEvent, StyleProp, ViewStyle} from 'react-native';
import {colors, geometry, typography} from '../theme/conceptA';

export default function DecisionShell({spine, children, stageStyle}: Readonly<{
  spine: React.ReactNode;
  children: React.ReactNode;
  stageStyle?: StyleProp<ViewStyle>;
}>): React.JSX.Element {
  const [bounds, setBounds] = useState<{width: number; height: number}>({width: geometry.canvasWidth, height: geometry.canvasHeight});
  const scale = Math.min(bounds.width / geometry.canvasWidth, bounds.height / geometry.canvasHeight);
  const onLayout = (event: LayoutChangeEvent): void => {
    const {width, height} = event.nativeEvent.layout;
    setBounds(previous => previous.width === width && previous.height === height ? previous : {width, height});
  };
  return <View style={styles.viewport} onLayout={onLayout}>
    <View style={{width: geometry.canvasWidth * scale, height: geometry.canvasHeight * scale}}>
      <View style={[styles.canvas, {
        transform: [
          {translateX: -(geometry.canvasWidth * (1 - scale)) / 2},
          {translateY: -(geometry.canvasHeight * (1 - scale)) / 2},
          {scale},
        ],
      }]}>
        <View style={styles.spine}>
          <Text accessibilityRole="header" style={styles.wordmark}>DECORDA</Text>
          <Text style={styles.fixture}>SATURDAY PLAN · SYNTHETIC FIXTURE</Text>
          {spine}
        </View>
        <View style={[styles.stage, stageStyle]}>{children}</View>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  viewport: {flex: 1, backgroundColor: colors.ground, alignItems: 'center', justifyContent: 'center'},
  canvas: {width: geometry.canvasWidth, height: geometry.canvasHeight, backgroundColor: colors.ground, paddingVertical: geometry.paddingVertical, paddingHorizontal: geometry.paddingHorizontal, flexDirection: 'row', gap: geometry.stageGap},
  spine: {width: geometry.spineWidth, borderRightColor: colors.rule, borderRightWidth: 1, paddingRight: geometry.spineRightPadding},
  wordmark: {color: colors.ink, fontSize: typography.wordmark, fontWeight: '600', letterSpacing: 8},
  fixture: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: typography.label, letterSpacing: 3, marginTop: 10, marginBottom: 26},
  stage: {flex: 1, minWidth: 0},
});
