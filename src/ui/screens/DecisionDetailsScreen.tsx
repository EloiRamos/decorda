import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {CandidateOption, CandidateOptionId, ConfirmedPlan} from '../../domain/types';
import {referenceComponentLabel} from '../../domain/decisionScenario';
import {referenceCandidateOptions} from '../../domain/fixtures';
import DecisionShell from '../components/DecisionShell';
import FocusableControl from '../components/FocusableControl';
import TruthSpine, {type TruthSpineModel} from '../components/TruthSpine';
import {colors, geometry, typography} from '../theme/conceptA';

export type DecisionDetailsContent =
  | Readonly<{kind: 'candidate' | 'replacement'; candidate: CandidateOption}>
  | Readonly<{kind: 'confirmed'; plan: ConfirmedPlan}>;

export default function DecisionDetailsScreen({content, onBack, spineModel}: Readonly<{
  content: DecisionDetailsContent;
  onBack: () => void;
  spineModel?: TruthSpineModel;
}>): React.JSX.Element {
  const candidateById = new Map<CandidateOptionId, CandidateOption>(
    referenceCandidateOptions.map(candidate => [candidate.id, candidate]),
  );
  const model: TruthSpineModel = spineModel ?? {
    sessionLabel: 'Local fixture', canonicalLabel: 'Decision open',
    decisionVersion: null, planVersion: null, status: 'Inspecting never saves a response.', child: true,
  };
  return <DecisionShell spine={<TruthSpine model={model} footer={<FocusableControl label="Back to decision" accessibilityHint="Returns to the originating decision control." onPress={onBack} preferredInitialFocus />} />}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>DECISION DETAILS</Text>
      {content.kind === 'confirmed' ? <>
        <Text accessibilityRole="header" style={styles.title}>Confirmed components</Text>
        <Text style={styles.body}>Confirmed plan version {content.plan.version}</Text>
        {content.plan.selected_components.map(component => {
          const option = candidateById.get(component.option_id);
          return <View key={component.component_id} style={styles.card}>
            <Text style={styles.heading}>{referenceComponentLabel(component.component_id)}</Text>
            <Text style={styles.body}>{option?.title ?? component.option_id}</Text>
            {option && <Text style={styles.body}>{option.description} · {option.cost_eur} EUR · return {option.return_time.display}</Text>}
          </View>;
        })}
      </> : <>
        <Text accessibilityRole="header" style={styles.title}>{content.candidate.title}</Text>
        <Text style={styles.description}>{content.candidate.description}</Text>
        <View style={styles.evidence}>
          <View style={styles.evidenceCard}><Text style={styles.label}>COST</Text><Text style={styles.figure}>{content.candidate.cost_eur} EUR</Text><Text style={styles.small}>Activity budget is 60 EUR</Text></View>
          <View style={styles.evidenceCard}><Text style={styles.label}>RETURN TIME</Text><Text style={styles.figure}>{content.candidate.return_time.display}</Text><Text style={styles.small}>Return limit is 18:00</Text></View>
          <View style={styles.evidenceCard}><Text style={styles.label}>SETTING</Text><Text style={styles.figure}>{content.candidate.setting}</Text><Text style={styles.small}>Outdoor is a soft preference</Text></View>
        </View>
        <View style={styles.tradeoff}><Text style={styles.label}>SOFT PREFERENCE TRADE-OFF</Text><Text style={styles.body}>{content.candidate.setting === 'outdoor' ? 'Outdoor preference satisfied. No hard constraint is in tension.' : 'Does not match the soft outdoor preference, while satisfying hard limits.'}</Text></View>
        <Text style={styles.small}>Inspecting never records a response and never writes anything. Back returns to the originating control.</Text>
      </>}
    </ScrollView>
  </DecisionShell>;
}

const styles = StyleSheet.create({
  scroll: {flex: 1}, content: {gap: 22, paddingHorizontal: geometry.focusReserve, paddingBottom: geometry.focusReserve},
  eyebrow: {color: colors.signal, fontFamily: typography.machine, fontSize: typography.stageLabel, letterSpacing: 4},
  title: {color: colors.ink, fontSize: typography.detailHeadline, fontWeight: '600', lineHeight: 66},
  description: {color: colors.inkSecondary, fontSize: 32, lineHeight: 44},
  evidence: {flexDirection: 'row', gap: 20},
  evidenceCard: {flex: 1, backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, padding: 20, gap: 8},
  card: {backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, padding: 26, gap: 12},
  heading: {color: colors.ink, fontSize: 36, fontWeight: '600'},
  label: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: 20, letterSpacing: 2.5},
  figure: {color: colors.ink, fontFamily: typography.machine, fontSize: 40, fontWeight: '600'},
  body: {color: colors.ink, fontSize: 28, lineHeight: 39},
  small: {color: colors.inkTertiary, fontSize: 22, lineHeight: 31},
  tradeoff: {backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, borderLeftColor: colors.inkTertiary, borderLeftWidth: 8, padding: 26, gap: 10},
});
