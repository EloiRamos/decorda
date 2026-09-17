import React, {useEffect, useRef, useState} from 'react';
import {AppState, BackHandler, ScrollView, StyleSheet, Text, View, findNodeHandle} from 'react-native';
import {FocusManager} from '@amazon-devices/react-native-kepler';
import {evaluateConsensus} from '../../domain/consensus';
import {evaluateCandidates} from '../../domain/feasibility';
import {referenceCandidateOptions, referenceConstraints, referenceParticipants, syntheticContextChange} from '../../domain/fixtures';
import {referenceComponentLabel} from '../../domain/decisionScenario';
import type {CandidateOption, CandidateOptionId, PlanComponentId} from '../../domain/types';
import type {CanonicalDecisionState} from '../../application/decisionStore';
import type {DecisionSession, ScopedReplanResult} from '../../application/decisionSession';
import {createVersionScopedOperationId} from '../../application/decisionSession';
import {createDecisionRefreshController, type DecisionRefreshController} from '../../application/decisionRefresh';
import type {DurableScopedReplanFlow} from '../../application/replanningFlow';
import {recordDurableScopedResponse, selectDurableScopedReplacement} from '../../application/replanningFlow';
import FocusableControl from '../components/FocusableControl';
import DecisionDetailsScreen, {type DecisionDetailsContent} from './DecisionDetailsScreen';
import DecisionShell from '../components/DecisionShell';
import TruthSpine, {type StatusKind, type TruthSpineModel} from '../components/TruthSpine';
import {colors, geometry, typography, verticalFit} from '../theme/conceptA';

export const FOCUS_KEY_CONTEXT_CHANGE_TRIGGER = 'context-change-trigger';
export const FALLBACK_FOCUS_TARGET_KEY = 'fallback-first-action';
const RESTORATION_DELAY_MS = 100;
const MAX_AUTOMATIC_READS = 280;

const feasibilityResults = evaluateCandidates(referenceCandidateOptions, referenceConstraints);
const candidateById = new Map<CandidateOptionId, CandidateOption>(
  referenceCandidateOptions.map(candidate => [candidate.id, candidate]),
);

export type FocusTargetRegistry = Map<string, View | null>;
export function resolveFocusTarget(registry: FocusTargetRegistry, requested_key: string): View | null {
  return registry.get(requested_key) ?? registry.get(FALLBACK_FOCUS_TARGET_KEY) ?? null;
}

export type DecisionScreenProps = Readonly<{
  session: DecisionSession;
  clientId: string;
  expiresAtEpochSeconds: number;
}>;
type ScreenMode = 'overview' | 'details' | 'replanning' | 'left';

function statusText(result: Awaited<ReturnType<DecisionSession['open']>>): string {
  if (result.kind === 'CANONICAL') {
    switch (result.outcome) {
      case 'CREATED': return 'New fixture decision started.';
      case 'ALREADY_EXISTS': return 'Existing canonical decision opened.';
      case 'LOADED': return 'Canonical decision loaded.';
      case 'APPLIED': return `Saved at decision version ${result.committed_version}.`;
      case 'REPLAYED': return `Request already saved at decision version ${result.committed_version}.`;
      case 'STALE': return `Your request was stale. Showing canonical decision version ${result.canonical_state.version}.`;
      case 'NO_CHANGE': return 'That choice is already current; nothing was written.';
    }
  }
  if (result.kind === 'NOT_FOUND') return 'Decision not found. Start the fixture explicitly to continue.';
  if (result.kind === 'EXPIRED') return 'This bounded decision session has expired. No action was saved.';
  if (result.kind === 'REJECTED') {
    const labels: Record<typeof result.reason, string> = {
      ALREADY_CONFIRMED: 'The plan is already confirmed. Use the scoped context-change flow.',
      CANDIDATE_INFEASIBLE: 'That option is not feasible and was not saved.',
      CANDIDATE_UNKNOWN: 'That option is not part of this fixture.',
      CANDIDATE_REQUIRED: 'Select a feasible option first.',
      CONFIRMATION_NOT_READY: 'Confirmation needs four approvals and no rejection.',
      PARTICIPANT_UNKNOWN: 'That participant is not part of this decision.',
      PENDING_RESPONSE_NOT_ALLOWED: 'Choose approve or reject explicitly.',
    };
    return labels[result.reason];
  }
  if (result.kind === 'OPERATION_ID_CONFLICT') return `Request identity conflict. Nothing was retried. Canonical decision version ${result.canonical_state.version}.`;
  if (result.kind === 'LIMIT_EXCEEDED') return `Session limit reached (${result.reason}).`;
  return 'Decision service unavailable. Nothing was retried.';
}

function candidateSummary(candidate: CandidateOption): string {
  return `${candidate.cost_eur} EUR · returns ${candidate.return_time.display} · ${candidate.setting}`;
}
function candidateState(candidate: CandidateOption, selected: boolean): string {
  const feasibility = feasibilityResults[
    referenceCandidateOptions.findIndex(option => option.id === candidate.id)
  ];
  if (!feasibility.feasible) return `NOT FEASIBLE — ${feasibility.rejection_reasons.map(reason => reason.message).join(' ')}`;
  const notes = feasibility.soft_tradeoff_notes.map(note => note.note).join(' ');
  return `${selected ? 'SELECTED · ' : ''}FEASIBLE${notes ? ` · ${notes}` : ''}`;
}
function componentText(component_id: PlanComponentId, option_id: CandidateOptionId): string {
  const candidate = candidateById.get(option_id);
  if (component_id === syntheticContextChange.preserved_components[0].component_id) {
    return `${referenceComponentLabel(component_id)} · retained ${candidate?.return_time.display ?? 'fixture timing'}`;
  }
  return `${referenceComponentLabel(component_id)} · ${candidate?.title ?? option_id}`;
}

export default function DecisionScreen({session, clientId, expiresAtEpochSeconds}: DecisionScreenProps): React.JSX.Element {
  const [canonical, setCanonical] = useState<CanonicalDecisionState | null>(null);
  const [mode, setMode] = useState<ScreenMode>('overview');
  const [busy, setBusy] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [status, setStatus] = useState('Open the shared decision to load canonical state.');
  const [statusKind, setStatusKind] = useState<StatusKind>('neutral');
  const [statusLabel, setStatusLabel] = useState('');
  const [showCandidateChoice, setShowCandidateChoice] = useState(false);
  const [details, setDetails] = useState<DecisionDetailsContent | null>(null);
  const [flow, setFlow] = useState<DurableScopedReplanFlow | null>(null);
  const [draftInvalidated, setDraftInvalidated] = useState(false);
  const [pendingRestorationKey, setPendingRestorationKey] = useState<string | null>(null);
  const canonicalRef = useRef<CanonicalDecisionState | null>(null);
  const flowRef = useRef<DurableScopedReplanFlow | null>(null);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const focusTargets = useRef<FocusTargetRegistry>(new Map());
  const originFocusKey = useRef(FALLBACK_FOCUS_TARGET_KEY);
  const detailsReturnMode = useRef<ScreenMode>('overview');
  const refreshRef = useRef<DecisionRefreshController | null>(null);
  const automaticReadsRef = useRef(0);

  const adoptCanonical = (next: CanonicalDecisionState): void => {
    if (canonicalRef.current !== null && next.version < canonicalRef.current.version) return;
    if (flowRef.current !== null && next.version > flowRef.current.base_version) {
      flowRef.current = null;
      setFlow(null);
      setDraftInvalidated(true);
      setMode('overview');
    }
    canonicalRef.current = next;
    setCanonical(next);
  };
  const updateFlow = (next: DurableScopedReplanFlow | null): void => {
    flowRef.current = next;
    setFlow(next);
  };
  const registerFocusTarget = (keys: readonly string[]) => (instance: View | null): void => {
    for (const key of keys) instance === null ? focusTargets.current.delete(key) : focusTargets.current.set(key, instance);
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (mode !== 'details' && mode !== 'replanning') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const returnMode = mode === 'details' ? detailsReturnMode.current : 'overview';
      setDetails(null);
      if (returnMode !== 'replanning') updateFlow(null);
      setMode(returnMode);
      setPendingRestorationKey(originFocusKey.current);
      return true;
    });
    return () => subscription.remove();
  }, [mode]);
  useEffect(() => {
    if ((mode !== 'overview' && mode !== 'replanning') || pendingRestorationKey === null) return;
    const timer = setTimeout(() => {
      const target = resolveFocusTarget(focusTargets.current, pendingRestorationKey);
      setPendingRestorationKey(null);
      const handle = target === null ? null : findNodeHandle(target);
      if (handle != null) FocusManager.focus(handle);
    }, RESTORATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mode, pendingRestorationKey]);
  useEffect(() => {
    refreshRef.current?.stop();
    refreshRef.current = null;
    if (canonical === null || mode === 'left' || !foreground) return;
    const remaining = MAX_AUTOMATIC_READS - automaticReadsRef.current;
    if (remaining <= 0) return;
    const controller = createDecisionRefreshController({
      session,
      scheduler: {setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>)},
      now: () => Date.now(),
      expires_at_ms: expiresAtEpochSeconds * 1000,
      maximum_reads: remaining,
      initial_version: canonical.version,
      canRead: () => !busyRef.current,
      onCanonical: next => {adoptCanonical(next); setStatusKind('attention'); setStatusLabel('NEWER CANONICAL'); setStatus(`A newer canonical decision is available at version ${next.version}.`);},
      onStop: reason => {setStatusKind(reason === 'READ_LIMIT' ? 'limit' : 'terminal'); setStatusLabel(reason === 'READ_LIMIT' ? 'READ LIMIT' : reason === 'EXPIRED' ? 'EXPIRED' : 'UNAVAILABLE'); setStatus(reason === 'EXPIRED' ? 'This bounded session expired. Reopen is unavailable.' : reason === 'READ_LIMIT' ? 'Automatic refresh stopped at the session read limit.' : 'Automatic refresh stopped after a service error. Use Reload explicitly.');},
    });
    refreshRef.current = controller;
    controller.start();
    return () => {automaticReadsRef.current += controller.getReadCount(); controller.stop();};
  }, [canonical, expiresAtEpochSeconds, foreground, mode, session]);

  const run = async (action: () => Promise<Awaited<ReturnType<DecisionSession['open']>>>, onCanonical?: () => void): Promise<void> => {
    if (busyRef.current) return;
    const generation = generationRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await action();
      if (generation !== generationRef.current) return;
      if (result.kind === 'CANONICAL' || result.kind === 'REJECTED' || result.kind === 'OPERATION_ID_CONFLICT') adoptCanonical(result.canonical_state);
      setStatus(statusText(result));
      setStatusLabel(result.kind === 'NOT_FOUND' ? 'NOT FOUND' : result.kind === 'EXPIRED' ? 'EXPIRED' : result.kind === 'OPERATION_ID_CONFLICT' ? 'CONFLICT' : result.kind === 'LIMIT_EXCEEDED' ? 'LIMIT' : result.kind === 'INFRASTRUCTURE_ERROR' ? 'INFRASTRUCTURE ERROR' : result.kind === 'REJECTED' ? 'REJECTED' : result.outcome === 'STALE' ? 'STALE' : result.outcome === 'REPLAYED' ? 'REPLAYED' : result.outcome === 'NO_CHANGE' ? 'NO CHANGE' : 'CANONICAL');
      setStatusKind(result.kind === 'EXPIRED' || result.kind === 'INFRASTRUCTURE_ERROR' ? 'terminal' : result.kind === 'LIMIT_EXCEEDED' ? 'limit' : result.kind === 'NOT_FOUND' || result.kind === 'OPERATION_ID_CONFLICT' || result.kind === 'REJECTED' || result.kind === 'CANONICAL' && result.outcome === 'STALE' ? 'attention' : 'neutral');
      if (result.kind === 'CANONICAL' && (result.outcome === 'APPLIED' || result.outcome === 'NO_CHANGE' || result.outcome === 'REPLAYED')) onCanonical?.();
    } finally {
      if (generation === generationRef.current) {busyRef.current = false; setBusy(false);}
    }
  };
  const identity = (action: string, payload: string) => {
    const version = canonical?.version ?? 1;
    return {base_version: version, operation_id: createVersionScopedOperationId(clientId, version, action, payload)};
  };
  const openDetails = (content: DecisionDetailsContent, origin: string): void => {
    originFocusKey.current = origin;
    detailsReturnMode.current = mode;
    setDetails(content);
    setMode('details');
  };
  const closeChild = (): void => {
    const returnMode = mode === 'details' ? detailsReturnMode.current : 'overview';
    setDetails(null);
    if (returnMode !== 'replanning') updateFlow(null);
    setMode(returnMode);
    setPendingRestorationKey(originFocusKey.current);
  };
  const beginReplan = async (): Promise<void> => {
    if (busyRef.current) return;
    originFocusKey.current = FOCUS_KEY_CONTEXT_CHANGE_TRIGGER;
    busyRef.current = true; setBusy(true);
    const result = await session.beginScopedReplan();
    busyRef.current = false; setBusy(false);
    if (result.kind === 'REPLAN_READY') {updateFlow(result.flow); setShowCandidateChoice(false); setDraftInvalidated(false); setMode('replanning'); return;}
    setStatus(
      result.kind === 'CANONICAL'
        ? statusText(result.result)
        : `Context change unavailable: ${result.reason.replaceAll('_', ' ').toLowerCase()}.`,
    );
    setStatusKind('attention');
    setStatusLabel('CONTEXT CHANGE UNAVAILABLE');
  };
  const scopedConsensus = flow === null ? 'pending' : evaluateConsensus(flow.replan.renewed_responses);
  const selectedReplacement = flow?.replan.selected_replacements[0] ?? null;
  const replanStageA = selectedReplacement === null || showCandidateChoice;
  const selectedReplacementOption = selectedReplacement === null ? null : candidateById.get(selectedReplacement.option_id) ?? null;
  const responseByParticipant = new Map(flow?.replan.renewed_responses.map(response => [response.participant_id, response.response_state]) ?? []);
  const confirmReplan = async (): Promise<void> => {
    if (flow === null || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const operation_id = createVersionScopedOperationId(clientId, flow.base_version, 'replan', selectedReplacement?.option_id ?? 'none');
    const result: ScopedReplanResult = await session.confirmScopedReplan(operation_id, flow);
    busyRef.current = false; setBusy(false);
    if (result.kind === 'CANONICAL') {
      if (result.result.kind === 'CANONICAL' || result.result.kind === 'OPERATION_ID_CONFLICT') adoptCanonical(result.result.canonical_state);
      setStatus(statusText(result.result));
      setStatusLabel(result.result.kind === 'OPERATION_ID_CONFLICT' ? 'CONFLICT' : result.result.kind === 'CANONICAL' && result.result.outcome === 'STALE' ? 'STALE' : 'CANONICAL');
      setStatusKind(result.result.kind === 'OPERATION_ID_CONFLICT' || result.result.kind === 'CANONICAL' && result.result.outcome === 'STALE' ? 'attention' : 'neutral');
      updateFlow(null); setMode('overview'); setPendingRestorationKey(FOCUS_KEY_CONTEXT_CHANGE_TRIGGER);
    } else {setStatus('The scoped draft was rejected and nothing was saved.'); setStatusKind('attention'); setStatusLabel('REPLAN REJECTED');}
  };

  const selectedCandidate = canonical?.selected_candidate_id ? candidateById.get(canonical.selected_candidate_id) ?? null : null;
  const consensus = canonical === null ? 'pending' : evaluateConsensus(canonical.participant_responses);
  const readyToConfirm = canonical !== null && canonical.confirmed_plan === null && consensus === 'approved';
  const activeControlsDisabled = busy || canonical === null;

  const replanVisible = (mode === 'replanning' || mode === 'details' && detailsReturnMode.current === 'replanning') && flow !== null;
  const spineModel: TruthSpineModel = {
    sessionLabel: session.modeLabel,
    canonicalLabel: mode === 'left' ? 'Display released' : canonical === null ? 'Not opened' : canonical.confirmed_plan ? 'Plan confirmed' : 'Decision open',
    decisionVersion: canonical?.version ?? null,
    planVersion: canonical?.confirmed_plan?.version ?? null,
    responses: replanVisible ? flow.replan.renewed_responses : canonical?.participant_responses,
    status: busy ? `Working… ${status}` : mode === 'left' ? 'You left the shared decision. Displayed state was released and refresh is paused.' : status,
    statusKind: busy ? 'working' : statusKind,
    statusLabel: busy ? 'WORKING' : statusLabel,
    draftInvalidated,
    ...(replanVisible ? {
      affected: flow.replan.affected_components.map(component => componentText(component.component_id, component.option_id)),
      preserved: flow.replan.preserved_components.map(component => componentText(component.component_id, component.option_id)),
      scopedConsensus: scopedConsensus.toUpperCase(),
    } : {}),
  };
  if (mode === 'details' && details !== null) return <DecisionDetailsScreen content={details} onBack={closeChild} spineModel={{...spineModel, child: true}} />;

  const footer = mode === 'left' ? null : canonical !== null ? <View style={styles.spineActions}>
    <FocusableControl ref={registerFocusTarget([FALLBACK_FOCUS_TARGET_KEY])} label="Reload canonical decision" size="replanCompact" disabled={busy} onPress={() => void run(() => session.open())} />
    {canonical.confirmed_plan !== null && <FocusableControl label="Leave shared decision" size="replanCompact" disabled={busy} onPress={() => {generationRef.current += 1; busyRef.current = false; setBusy(false); canonicalRef.current = null; setCanonical(null); updateFlow(null); setMode('left');}} />}
  </View> : null;

  if (mode === 'left') return <DecisionShell spine={<TruthSpine model={spineModel} />}><View style={styles.stageContent}>
    <Text style={styles.eyebrow}>SESSION LEFT</Text><Text accessibilityRole="header" style={styles.headline}>The displayed record was released</Text>
    <Text style={styles.body}>Refresh is paused. Reopening reads the latest canonical decision without writing.</Text>
    <FocusableControl label="Reopen canonical decision" variant="primary" onPress={() => {setMode('overview'); void run(() => session.open());}} preferredInitialFocus />
  </View></DecisionShell>;

  const stage = replanVisible ? 'replan' : canonical === null ? 'open' : canonical.confirmed_plan ? 'confirmed' : selectedCandidate !== null && !showCandidateChoice ? 'responses' : 'candidates';
  const spineOriginKey = stage === 'replan' ? (replanStageA ? 'replan-stage-a' : 'replan-stage-b') : 'outside-replan';
  return <DecisionShell spine={<TruthSpine model={spineModel} footer={footer} compactFit={stage === 'candidates' || stage === 'replan'} originKey={spineOriginKey} />}>
    <ScrollView style={styles.stageScroll} contentContainerStyle={[styles.stageContent, (stage === 'candidates' || stage === 'replan') && styles.candidateStageContent]} showsVerticalScrollIndicator={false}>
      {stage === 'open' && <>
        <Text style={styles.eyebrow}>STEP 1 · OPEN</Text>
        <Text accessibilityRole="header" style={styles.headline}>Nothing is created until someone asks for it</Text>
        <View style={styles.actions}>
          <FocusableControl ref={registerFocusTarget([FALLBACK_FOCUS_TARGET_KEY])} label="Open shared decision" variant="primary" disabled={busy} onPress={() => void run(() => session.open())} preferredInitialFocus />
          {/not found/i.test(status) && <FocusableControl label="Start new fixture decision" disabled={busy} onPress={() => void run(() => session.startFixture())} />}
        </View>
        {statusKind !== 'neutral' && <View style={styles.statusPanel}><Text style={styles.statusHeading}>{statusKind === 'terminal' ? '■' : statusKind === 'limit' ? '◌' : '▲'} {statusLabel}</Text><Text style={styles.body}>{status}</Text></View>}
      </>}

      {stage === 'candidates' && <>
        <Text style={styles.eyebrow}>STEP 2 · CHOOSE A FEASIBLE OPTION</Text>
        <Text accessibilityRole="header" style={styles.headline}>{feasibilityResults.filter(result => result.feasible).length} of {referenceCandidateOptions.length} options clear the hard constraints</Text>
        <Text accessibilityRole="header" style={styles.sectionHeader}>CANDIDATE OPTIONS</Text>
        {referenceCandidateOptions.map((candidate, index) => {
          const feasible = feasibilityResults[index].feasible;
          const selected = canonical?.selected_candidate_id === candidate.id;
          return <View key={candidate.id} style={[styles.candidateRow, !feasible && styles.infeasibleRow, selected && styles.selectedRow]}>
            <View style={[styles.candidateInfo, !feasible && styles.infeasibleInfo]}>
              <View style={styles.titleLine}><Text style={styles.candidateTitle}>{candidate.title}</Text><Text style={[styles.badge, !feasible && styles.badgeDisabled]}>{feasible ? selected ? '✓ SELECTED · FEASIBLE' : '✓ FEASIBLE' : '✕ NOT FEASIBLE'}</Text></View>
              <Text style={styles.metrics}>{candidateSummary(candidate)}</Text>
              <Text style={styles.note}>{candidateState(candidate, Boolean(selected))}</Text>
            </View>
            <View style={[styles.actions, !feasible && styles.infeasibleActions]}>
              <FocusableControl label="Inspect" accessibilityLabel={`Inspect ${candidate.title} tradeoffs`} size="compact" disabled={!feasible} onPress={() => openDetails({kind: 'candidate', candidate}, `inspect-${candidate.id}`)} ref={registerFocusTarget([`inspect-${candidate.id}`])} />
              <FocusableControl label="Select" accessibilityLabel={`Select candidate ${candidate.title}`} size="compact" variant="primary" disabled={!feasible || activeControlsDisabled || canonical?.confirmed_plan !== null} selected={selected} onPress={() => void run(() => session.selectCandidate(identity('select', candidate.id), candidate.id), () => setShowCandidateChoice(false))} />
            </View>
          </View>;
        })}
        {selectedCandidate && <FocusableControl label="Return to individual responses" size="compact" onPress={() => setShowCandidateChoice(false)} />}
      </>}

      {stage === 'responses' && <>
        <Text style={styles.eyebrow}>STEP 3 · INDIVIDUAL RESPONSES</Text>
        <Text accessibilityRole="header" style={styles.headline}>{selectedCandidate?.title}</Text>
        <View style={[styles.consensusPanel, readyToConfirm && styles.readyPanel]}><Text style={styles.consensus}>CONSENSUS · {consensus.toUpperCase()}{readyToConfirm ? ' · READY TO CONFIRM' : ''}</Text><Text style={styles.body}>Four approvals mean ready. Only the Confirm action commits a plan.</Text></View>
        <View style={styles.responseGrid}>{referenceParticipants.map(participant => {
          const response = canonical?.participant_responses.find(item => item.participant_id === participant.id)?.response_state ?? 'pending';
          return <View key={participant.id} style={styles.responseCard}>
            <View><Text style={styles.participant}>{participant.display_name}</Text><Text style={styles.responseState}>{response === 'approved' ? '✓ ' : response === 'rejected' ? '✕ ' : '– '}{response.toUpperCase()}</Text></View>
            <View style={styles.actions}>{(['approved', 'rejected'] as const).map(next => <FocusableControl key={next} label={next === 'approved' ? 'Approve' : 'Reject'} accessibilityLabel={`${participant.display_name} ${next === 'approved' ? 'approves' : 'rejects'} the selected activity`} size="replanCompact" variant={response === next ? 'absolute' : 'secondary'} disabled={activeControlsDisabled || selectedCandidate === null || canonical?.confirmed_plan !== null} selected={response === next} onPress={() => void run(() => session.setParticipantResponse(identity('response', `${participant.id}-${next}`), participant.id, next))} />)}</View>
          </View>;
        })}</View>
        <View style={styles.actions}><FocusableControl label="Confirm selected plan" variant="primary" disabled={!readyToConfirm || busy} onPress={() => void run(() => session.confirmPlan(identity('confirm', 'plan-saturday-activity')))} /><FocusableControl label="Change selected candidate" size="compact" onPress={() => setShowCandidateChoice(true)} /></View>
      </>}

      {stage === 'confirmed' && canonical?.confirmed_plan && <>
        <View style={styles.confirmedBanner}><Text style={styles.confirmedTitle}>✓ PLAN CONFIRMED</Text></View>
        <Text style={styles.body}>Saved as canonical state at decision version {canonical.version}. This is what the record now says.</Text>
        <Text style={styles.versionSummary}>Decision version {canonical.version} · Plan version {canonical.confirmed_plan.version}</Text>
        <View style={styles.componentPanel}>{canonical.confirmed_plan.selected_components.map(component => <View key={component.component_id} style={styles.componentRow}><Text style={styles.componentLabel}>{referenceComponentLabel(component.component_id).toUpperCase()}</Text><Text style={styles.componentValue}>{componentText(component.component_id, component.option_id)}</Text></View>)}</View>
        <View style={styles.actions}><FocusableControl label="Inspect confirmed components" onPress={() => openDetails({kind: 'confirmed', plan: canonical.confirmed_plan!}, 'confirmed-details')} ref={registerFocusTarget(['confirmed-details'])} /><FocusableControl ref={registerFocusTarget([FOCUS_KEY_CONTEXT_CHANGE_TRIGGER])} label="Reopen the affected part of the plan" variant="primary" disabled={busy} onPress={() => void beginReplan()} /></View>
        <View style={styles.statusPanel}><Text style={styles.statusHeading}>LEAVE / REOPEN POSTURE</Text><Text style={styles.body}>Leaving releases displayed state and pauses refresh. Reopening reads the latest canonical decision and confirmed plan without writing.</Text></View>
      </>}

      {stage === 'replan' && flow && <>
        <Text style={[styles.eyebrow, styles.replanEyebrow]}>REPLANNING · SCOPED REAPPROVAL</Text>
        {replanStageA && <Text accessibilityRole="header" style={styles.headline}>{flow.replan.impact.reason}</Text>}
        <Text style={styles.note}>Deterministic synthetic fixture condition, not live weather. Only the affected activity can change; preserved components stay saved.</Text>
        {replanStageA && referenceCandidateOptions.filter(candidate => candidate.id !== flow.canonical_state.selected_candidate_id).map(candidate => {
          const eligible = flow.replan.eligible_replacements.includes(candidate.id);
          const selected = selectedReplacement?.option_id === candidate.id;
          const result = feasibilityResults[referenceCandidateOptions.findIndex(option => option.id === candidate.id)];
          return <View key={`replacement-${candidate.id}`} style={[styles.candidateRow, styles.replanRow, !eligible && styles.infeasibleRow, selected && styles.selectedRow]}>
            <View style={[styles.candidateInfo, !eligible && styles.infeasibleInfo]}><View style={styles.titleLine}><Text style={styles.candidateTitle}>{candidate.title}</Text><Text style={[styles.badge, !eligible && styles.badgeDisabled]}>{eligible ? selected ? '✓ SELECTED' : '✓ ELIGIBLE' : '✕ NOT ELIGIBLE'}</Text></View><Text style={styles.metrics}>{candidateSummary(candidate)}</Text><Text style={styles.note}>{eligible ? result.soft_tradeoff_notes.map(note => note.note).join(' ') : result.rejection_reasons.map(reason => reason.message).join(' ')}</Text></View>
            <View style={[styles.actions, !eligible && styles.infeasibleActions]}><FocusableControl ref={registerFocusTarget([`replacement-details-${candidate.id}`])} label="Inspect" accessibilityLabel={`Inspect replacement ${candidate.title}`} size="replanCompact" disabled={!eligible} onPress={() => openDetails({kind: 'replacement', candidate}, `replacement-details-${candidate.id}`)} /><FocusableControl label="Select replacement" accessibilityLabel={`Choose replacement ${candidate.title}`} size="replanCompact" variant="primary" disabled={!eligible} selected={selected} onPress={() => {const component = flow.replan.affected_components[0]; if (!component) return; const selectionOutcome = selectDurableScopedReplacement(flow, component.component_id, candidate.id); if (selectionOutcome.kind === 'REPLACEMENT_SELECTED') {updateFlow(selectionOutcome.flow); setShowCandidateChoice(false); setPendingRestorationKey('scoped-response-participant-alex-approved');}}} /></View>
          </View>;
        })}
        {!replanStageA && selectedReplacementOption && <View style={[styles.candidateRow, styles.replanRow, styles.selectedRow]}>
          <View style={styles.candidateInfo}><View style={styles.titleLine}><Text style={styles.candidateTitle}>{selectedReplacementOption.title}</Text><Text style={styles.badge}>✓ SELECTED</Text></View><Text style={styles.metrics}>{candidateSummary(selectedReplacementOption)}</Text><Text style={styles.note}>{feasibilityResults[referenceCandidateOptions.findIndex(option => option.id === selectedReplacementOption.id)].soft_tradeoff_notes.map(note => note.note).join(' ')}</Text></View>
          <View style={styles.actions}><FocusableControl ref={registerFocusTarget([`replacement-details-${selectedReplacementOption.id}`])} label="Inspect" accessibilityLabel={`Inspect replacement ${selectedReplacementOption.title}`} size="replanCompact" onPress={() => openDetails({kind: 'replacement', candidate: selectedReplacementOption}, `replacement-details-${selectedReplacementOption.id}`)} /><FocusableControl label="Change replacement" size="replanCompact" onPress={() => {setShowCandidateChoice(true); setPendingRestorationKey(`replacement-details-${selectedReplacementOption.id}`);}} /></View>
        </View>}
        {!replanStageA && <Text style={[styles.sectionHeader, styles.replanConsensus]}>SCOPED CONSENSUS · {scopedConsensus.toUpperCase()}{scopedConsensus === 'approved' ? ' · READY TO CONFIRM' : ''}</Text>}
        {!replanStageA && <View style={styles.responseGrid}>{referenceParticipants.map(participant => {
          const response = responseByParticipant.get(participant.id) ?? 'pending';
          return <View key={`scoped-${participant.id}`} style={styles.responseCard}><View><Text style={styles.participant}>{participant.display_name}</Text><Text style={styles.responseState}>{response.toUpperCase()}</Text></View><View style={styles.actions}>{(['approved', 'rejected'] as const).map(next => <FocusableControl key={next} ref={next === 'approved' ? registerFocusTarget([`scoped-response-${participant.id}-approved`]) : undefined} label={next === 'approved' ? 'Approve' : 'Reject'} accessibilityLabel={`${participant.display_name} — ${next === 'approved' ? 'Approve replacement' : 'Reject replacement'}`} size="replanCompact" variant={response === next ? 'absolute' : 'secondary'} disabled={selectedReplacement === null} selected={response === next} onPress={() => {const result = recordDurableScopedResponse(flow, participant.id, next); if (result.kind === 'RESPONSE_RECORDED') updateFlow(result.flow);}} />)}</View></View>;
        })}</View>}
        {replanStageA ? <FocusableControl label="Back without saving replan" onPress={closeChild} /> : <View style={styles.actions}><FocusableControl label="Confirm replanned plan" variant="primary" disabled={scopedConsensus !== 'approved' || busy} onPress={() => void confirmReplan()} /><FocusableControl label="Back without saving replan" onPress={closeChild} /></View>}
      </>}
    </ScrollView>
  </DecisionShell>;
}

const styles = StyleSheet.create({
  stageScroll: {flex: 1},
  stageContent: {gap: 18, paddingBottom: geometry.focusReserve, paddingHorizontal: geometry.focusReserve},
  candidateStageContent: {gap: verticalFit.stageGap},
  eyebrow: {color: colors.signal, fontFamily: typography.machine, fontSize: typography.stageLabel, letterSpacing: 4},
  replanEyebrow: {lineHeight: verticalFit.replanEyebrowLineHeight},
  headline: {color: colors.ink, fontSize: typography.stageHeadline, fontWeight: '600', lineHeight: 52},
  sectionHeader: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: typography.small, letterSpacing: 2},
  replanConsensus: {lineHeight: verticalFit.replanConsensusLineHeight},
  body: {color: colors.inkSecondary, fontSize: typography.body, lineHeight: 34},
  note: {color: colors.inkTertiary, fontSize: 23, lineHeight: 31},
  actions: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4},
  spineActions: {gap: 4, marginTop: 8},
  statusPanel: {backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, borderLeftColor: colors.signal, borderLeftWidth: 8, padding: 24, gap: 10},
  statusHeading: {color: colors.signal, fontFamily: typography.machine, fontSize: 21, letterSpacing: 3},
  candidateRow: {backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, paddingVertical: verticalFit.rowPaddingVertical, paddingHorizontal: 26, flexDirection: 'row', alignItems: 'center', gap: 26},
  replanRow: {gap: 24},
  infeasibleRow: {backgroundColor: colors.recessedPanel, borderColor: colors.inactiveBorder, borderStyle: 'dashed', flexDirection: 'column', alignItems: 'stretch', gap: verticalFit.infeasibleContentGap},
  infeasibleInfo: {flex: 0},
  infeasibleActions: {justifyContent: 'flex-end'},
  selectedRow: {borderColor: colors.signal, borderWidth: 3},
  candidateInfo: {flex: 1, minWidth: 0, gap: verticalFit.infoGap},
  titleLine: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center'},
  candidateTitle: {color: colors.ink, fontSize: typography.candidate, fontWeight: '600'},
  badge: {color: colors.absolute, borderColor: colors.absolute, borderWidth: 2, fontFamily: typography.machine, fontSize: 19, paddingHorizontal: 8, paddingVertical: 3},
  badgeDisabled: {borderStyle: 'dashed', color: colors.inkSecondary},
  metrics: {color: colors.inkSecondary, fontFamily: typography.machine, fontSize: 23},
  consensusPanel: {backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, padding: 22, gap: 6},
  readyPanel: {borderColor: colors.absolute, borderWidth: 3},
  consensus: {color: colors.ink, fontSize: 32, fontWeight: '600'},
  responseGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 18},
  responseCard: {width: '49%', backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, paddingVertical: 20, paddingHorizontal: 24, gap: 4},
  participant: {color: colors.ink, fontSize: typography.participant, fontWeight: '600'},
  responseState: {color: colors.inkSecondary, fontFamily: typography.machine, fontSize: 23},
  confirmedBanner: {backgroundColor: colors.panel, borderColor: colors.absolute, borderWidth: 4, padding: 24},
  confirmedTitle: {color: colors.absolute, fontSize: typography.confirmed, fontWeight: '600', letterSpacing: 2},
  versionSummary: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: 21},
  componentPanel: {backgroundColor: colors.panel, borderColor: colors.rule, borderWidth: 1, padding: 28, gap: 22},
  componentRow: {borderLeftColor: colors.signal, borderLeftWidth: 8, paddingLeft: 18, gap: 8},
  componentLabel: {color: colors.inkTertiary, fontFamily: typography.machine, fontSize: 21, letterSpacing: 2},
  componentValue: {color: colors.ink, fontSize: 46, fontWeight: '600'},
});
