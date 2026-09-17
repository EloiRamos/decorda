import React, {useEffect, useRef} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {referenceConstraints, referenceParticipants} from '../../domain/fixtures';
import type {ParticipantResponse} from '../../domain/types';
import {colors, compactSpine, spacing, typography} from '../theme/conceptA';

export type StatusKind = 'neutral' | 'working' | 'attention' | 'terminal' | 'limit';
export type TruthSpineModel = Readonly<{
  sessionLabel: string;
  canonicalLabel: string;
  decisionVersion: number | null;
  planVersion: number | null;
  responses?: readonly ParticipantResponse[];
  status: string;
  statusKind?: StatusKind;
  statusLabel?: string;
  child?: boolean;
  affected?: readonly string[];
  preserved?: readonly string[];
  scopedConsensus?: string;
  draftInvalidated?: boolean;
}>;

export function statusMark(kind: StatusKind): string {
  if (kind === 'working') return '◷';
  if (kind === 'attention') return '▲';
  if (kind === 'terminal') return '■';
  return '◌';
}

function Block({label, children, compact}: Readonly<{label: string; children: React.ReactNode; compact?: boolean}>): React.JSX.Element {
  return <View style={[styles.block, compact && styles.compactBlock]}><Text style={styles.label}>{label}</Text>{children}</View>;
}

export default function TruthSpine({model, footer, compactFit = false, originKey}: Readonly<{
  model: TruthSpineModel;
  footer?: React.ReactNode;
  compactFit?: boolean;
  originKey?: string;
}>): React.JSX.Element {
  const responseById = new Map(model.responses?.map(response => [response.participant_id, response.response_state]) ?? []);
  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {scrollRef.current?.scrollTo({y: 0, animated: false});}, [originKey]);
  return <ScrollView ref={scrollRef} style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    {model.child && <Block label="BOUNDED CHILD VIEW" compact={compactFit}><Text style={styles.copy}>The record stays visible while evidence is read.</Text><Text style={styles.copy}>Back returns to the originating control.</Text></Block>}
    <Block label="SESSION MODE" compact={compactFit}><Text style={styles.value}>{model.sessionLabel}</Text></Block>
    <Block label="CANONICAL STATE" compact={compactFit}><Text style={styles.value}>{model.canonicalLabel}</Text></Block>
    <View style={[styles.versions, compactFit && styles.compactVersions]}>
      <View style={styles.version}><Text style={styles.label}>DECISION VERSION · CAS</Text><Text style={styles.versionValue}>{model.decisionVersion ?? '—'}</Text></View>
      <View style={styles.version}><Text style={styles.label}>PLAN VERSION</Text><Text style={styles.versionValue}>{model.planVersion ?? '—'}</Text></View>
    </View>
    {(model.affected || model.preserved) ? <>
      {model.affected?.map(value => <View key={`affected-${value}`} style={[styles.affected, compactFit && styles.compactScope]}><Text style={styles.affectedLabel}>◆ AFFECTED · MAY CHANGE</Text><Text style={styles.value}>{value}</Text></View>)}
      {model.preserved?.map(value => <View key={`preserved-${value}`} style={[styles.preserved, compactFit && styles.compactScope]}><Text style={styles.label}>▣ PRESERVED · STAYS AS SAVED</Text><Text style={styles.value}>{value}</Text></View>)}
      <Block label="SCOPED CONSENSUS" compact={compactFit}><Text style={styles.value}>{model.scopedConsensus ?? 'PENDING'}</Text></Block>
    </> : <>
      <Block label="PARTICIPANTS" compact={compactFit}>{referenceParticipants.map(participant => <View key={participant.id} style={styles.person}><Text style={styles.personName}>{participant.display_name}</Text><Text style={styles.personState}>{(responseById.get(participant.id) ?? 'pending').toUpperCase()}</Text></View>)}</Block>
      <Block label="CONSTRAINT WALL" compact={compactFit}><Text style={styles.provenance}>Synthetic reference inputs · human-confirmed fixture provenance</Text>{referenceConstraints.map(constraint => <View key={constraint.id} style={[styles.constraint, constraint.kind === 'hard' ? styles.hard : styles.soft]}><Text style={styles.constraintKind}>{constraint.kind.toUpperCase()}</Text><Text style={styles.constraintText}>{constraint.label}</Text></View>)}</Block>
    </>}
    {model.draftInvalidated && <View style={styles.invalidated}><Text accessibilityLiveRegion="assertive" style={styles.affectedLabel}>▲ DRAFT INVALIDATED</Text><Text style={styles.copy}>A newer canonical version invalidated the unfinished scoped draft. Nothing was merged.</Text></View>}
    <Block label="LIVE STATUS" compact={compactFit}><Text accessibilityLiveRegion="polite" accessibilityRole="text" style={[styles.status, compactFit && styles.compactStatus]}>{statusMark(model.statusKind ?? 'neutral')} {model.statusLabel ? `${model.statusLabel} · ` : ''}{model.status}</Text></Block>
    {footer}
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: {flex: 1}, content: {paddingHorizontal: 11, paddingBottom: 16},
  block: {borderTopColor: colors.rule, borderTopWidth: 1, paddingVertical: 16, gap: spacing.xxs},
  compactBlock: {paddingVertical: compactSpine.blockPaddingVertical, gap: compactSpine.blockGap},
  label: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: typography.label, letterSpacing: 2.5},
  value: {color: colors.ink, fontSize: 26, lineHeight: 36, fontWeight: '600'},
  copy: {color: colors.inkSecondary, fontSize: 22, lineHeight: 30},
  versions: {borderTopColor: colors.rule, borderTopWidth: 1, flexDirection: 'row', paddingVertical: 16, gap: spacing.card},
  compactVersions: {paddingVertical: compactSpine.versionsPaddingVertical},
  version: {flex: 1},
  versionValue: {color: colors.ink, fontFamily: typography.machine, fontSize: 31, fontWeight: '600', marginTop: 7},
  person: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3},
  personName: {color: colors.ink, fontSize: 24},
  personState: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: 19},
  provenance: {color: colors.inkTertiary, fontSize: 19, lineHeight: 26},
  constraint: {flexDirection: 'row', paddingLeft: 10, marginTop: 5, gap: 8},
  hard: {borderLeftColor: colors.absolute, borderLeftWidth: 6},
  soft: {borderLeftColor: colors.inkTertiary, borderLeftWidth: 6, borderStyle: 'dashed'},
  constraintKind: {color: colors.ink, fontFamily: typography.machine, fontSize: 19, fontWeight: '700'},
  constraintText: {color: colors.inkSecondary, fontSize: 20, lineHeight: 27, flex: 1},
  status: {color: colors.ink, fontSize: 21, lineHeight: 29},
  compactStatus: {lineHeight: compactSpine.statusLineHeight},
  affected: {borderColor: colors.signal, borderWidth: 3, backgroundColor: colors.panel, padding: 16, marginBottom: 12, gap: 6},
  affectedLabel: {color: colors.signal, fontFamily: typography.machine, fontSize: 20, letterSpacing: 2},
  preserved: {borderColor: colors.inactiveBorder, borderWidth: 1, backgroundColor: colors.recessedPanel, padding: 16, marginBottom: 12, gap: 6},
  compactScope: {paddingVertical: compactSpine.scopePaddingVertical, marginBottom: compactSpine.scopeMarginBottom},
  invalidated: {borderColor: colors.rule, borderWidth: 1, backgroundColor: colors.panel, borderLeftColor: colors.signal, borderLeftWidth: 8, padding: 16, gap: 6},
});
