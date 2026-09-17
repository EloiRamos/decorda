/* global globalThis */
import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import DecisionShell from './ui/components/DecisionShell';
import TruthSpine from './ui/components/TruthSpine';
import {colors, typography} from './ui/theme/conceptA';
import DecisionScreen from './ui/screens/DecisionScreen';
import {createDecisionSession} from './infrastructure/runtime/createDecisionSession';
import {defaultLocalDecisionRuntimeConfig, readDecisionRuntimeConfig} from './infrastructure/runtime/decisionRuntimeConfig';
import type {DecisionHttpTransport} from './infrastructure/network/httpDecisionSession';

function defaultTransport(): DecisionHttpTransport | undefined {
  if (typeof fetch !== 'function') return undefined;
  return async (url, init) => {
    const response = await fetch(url, init);
    return {status: response.status, text: () => response.text()};
  };
}

export default function App(): React.JSX.Element {
  const composition = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const injected = globalThis.__DECORDA_RUNTIME_CONFIG__;
    const config = injected === undefined
      ? defaultLocalDecisionRuntimeConfig(now)
      : readDecisionRuntimeConfig(injected);
    return createDecisionSession({config, transport: defaultTransport()});
  }, []);
  if (composition.kind === 'INVALID_CONFIGURATION') {
    return <DecisionShell spine={<TruthSpine model={{sessionLabel: 'Unavailable', canonicalLabel: 'Not opened', decisionVersion: null, planVersion: null, status: composition.message, statusKind: 'terminal'}} />}>
      <View accessible accessibilityRole="alert" style={styles.alert}>
        <Text style={styles.alertLabel}>■ UNAVAILABLE</Text>
        <Text style={styles.alertTitle}>DECISION SESSION UNAVAILABLE</Text>
        <Text style={styles.alertBody}>{composition.message}</Text>
      </View>
    </DecisionShell>;
  }
  return <DecisionScreen session={composition.session} clientId={composition.clientId} expiresAtEpochSeconds={composition.expiresAtEpochSeconds} />;
}

const styles = StyleSheet.create({
  alert: {backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, borderLeftColor: colors.absolute, borderLeftWidth: 8, padding: 30, gap: 16},
  alertLabel: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: 23, letterSpacing: 4},
  alertTitle: {color: colors.ink, fontSize: 46, fontWeight: '600'},
  alertBody: {color: colors.inkSecondary, fontSize: 26},
});
