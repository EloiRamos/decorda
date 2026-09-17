import React from 'react';
import {ScrollView, Text, findNodeHandle} from 'react-native';
import {FocusManager} from '@amazon-devices/react-native-kepler';
import {act, fireEvent, render} from '@testing-library/react-native';
import type {ReactTestInstance} from 'react-test-renderer';
import DecisionScreen, {FALLBACK_FOCUS_TARGET_KEY, resolveFocusTarget} from '../../../src/ui/screens/DecisionScreen';
import {createStoreDecisionSession} from '../../../src/application/decisionSession';
import {InMemoryDecisionStore} from '../../../src/infrastructure/persistence/inMemoryDecisionStore';
import {compactSpine, geometry, verticalFit} from '../../../src/ui/theme/conceptA';

let mockBackCallback: (() => boolean) | null = null;
const mockFocus = jest.fn();
Object.assign(FocusManager, {focus: mockFocus});
jest.mock('@amazon-devices/react-native-kepler', () => {
  const actual = jest.requireActual('@amazon-devices/react-native-kepler') as Record<string, unknown>;
  const namespace: Record<string, unknown> = {__esModule: true};
  const overrides: Record<string, unknown> = {
    AppState: {currentState: 'active', addEventListener: jest.fn().mockReturnValue({remove: jest.fn()})},
    BackHandler: {addEventListener: jest.fn((_name, callback) => {mockBackCallback = callback; return {remove: jest.fn()};}), exitApp: jest.fn()},
    FocusManager: {focus: mockFocus, blur: jest.fn(), getFocused: jest.fn()},
    findNodeHandle: jest.fn(() => 121),
  };
  for (const key of Object.getOwnPropertyNames(actual)) {
    if (key === '__esModule' || key in overrides) continue;
    Object.defineProperty(namespace, key, {enumerable: true, configurable: true, get: () => actual[key]});
  }
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(namespace, key, {enumerable: true, configurable: true, value});
  return namespace;
});

function press(control: ReactTestInstance): void {fireEvent(control, 'pressIn'); fireEvent(control, 'pressOut');}
function mergedStyle(value: Record<string, unknown> | Array<Record<string, unknown> | false | null>): Record<string, unknown> {
  return Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean)) : value;
}
async function activate(control: ReactTestInstance): Promise<void> {await act(async () => {press(control); await Promise.resolve(); await Promise.resolve();});}

function renderScreen() {
  const store = new InMemoryDecisionStore({now: () => 100});
  const session = createStoreDecisionSession({store, expires_at: 1000});
  return {screen: render(<DecisionScreen session={session} clientId="test-tv" expiresAtEpochSeconds={1000} />), store};
}

async function openedScreen() {
  const result = renderScreen();
  await activate(result.screen.getByRole('button', {name: 'Open shared decision'}));
  await activate(result.screen.getByRole('button', {name: 'Start new fixture decision'}));
  return result;
}

async function selectedScreen() {
  const result = await openedScreen();
  await activate(result.screen.getByRole('button', {name: 'Select candidate Riverside Picnic'}));
  return result;
}

async function confirmedScreen() {
  const result = await selectedScreen();
  for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) await activate(result.screen.getByRole('button', {name: `${name} approves the selected activity`}));
  await activate(result.screen.getByRole('button', {name: 'Confirm selected plan'}));
  return result;
}

describe('canonical TV decision screen', () => {
  afterEach(() => {jest.useRealTimers(); mockBackCallback = null; mockFocus.mockClear();});

  it('shows the Concept A brand, spine, four profiles, provenance and constraints before opening', () => {
    const {screen} = renderScreen();
    expect(screen.getByText('DECORDA')).toBeTruthy();
    expect(screen.getByText('STEP 1 · OPEN')).toBeTruthy();
    expect(screen.getByText('DECISION VERSION · CAS')).toBeTruthy();
    expect(screen.getByText('PLAN VERSION')).toBeTruthy();
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByText('PENDING').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/human-confirmed fixture provenance/)).toBeTruthy();
    expect(screen.getAllByText('HARD')).toHaveLength(2);
    expect(screen.getByText('SOFT')).toBeTruthy();
    expect(screen.getByText('Total activity budget is at most 60 EUR')).toBeTruthy();
  });

  it('loads without mutation and starts a missing fixture only on explicit action', async () => {
    const {screen, store} = renderScreen();
    await activate(screen.getByRole('button', {name: 'Open shared decision'}));
    expect(screen.getAllByText(/Decision not found/).length).toBeGreaterThan(0);
    expect((await store.loadDecision('decision-saturday-activity')).kind).toBe('NOT_FOUND');
    await activate(screen.getByRole('button', {name: 'Start new fixture decision'}));
    expect(screen.getByText('STEP 2 · CHOOSE A FEASIBLE OPTION')).toBeTruthy();
    expect(screen.getByText('DECISION VERSION · CAS')).toBeTruthy();
    expect(screen.getByText(/Costs 72 EUR, above the 60 EUR limit/)).toBeTruthy();
  });

  it('keeps typed not-found, expiry, limit, and infrastructure failures distinct', async () => {
    const outcomes = [
      {result: {kind: 'NOT_FOUND', decision_id: 'decision-saturday-activity'} as const, label: 'NOT FOUND'},
      {result: {kind: 'EXPIRED'} as const, label: 'EXPIRED'},
      {result: {kind: 'LIMIT_EXCEEDED', reason: 'OPERATION_COUNT'} as const, label: 'LIMIT'},
      {result: {kind: 'INFRASTRUCTURE_ERROR', retryable: false, safe_code: 'SERVICE'} as const, label: 'INFRASTRUCTURE ERROR'},
    ];
    for (const item of outcomes) {
      const store = new InMemoryDecisionStore({now: () => 100});
      const session = {...createStoreDecisionSession({store, expires_at: 1000}), open: jest.fn().mockResolvedValue(item.result)};
      const screen = render(<DecisionScreen session={session} clientId="status-tv" expiresAtEpochSeconds={1000} />);
      await activate(screen.getByRole('button', {name: 'Open shared decision'}));
      expect(screen.getAllByText(new RegExp(item.label)).length).toBeGreaterThan(0);
      expect(session.open).toHaveBeenCalledTimes(1);
      screen.unmount();
    }
  });

  it('distinguishes stale, conflict, replay, and no-change canonical outcomes', async () => {
    const store = new InMemoryDecisionStore({now: () => 100});
    const base = createStoreDecisionSession({store, expires_at: 1000});
    const created = await base.startFixture();
    if (created.kind !== 'CANONICAL') throw new Error('fixture did not start');
    const canonical_state = created.canonical_state;
    const outcomes = [
      {result: {kind: 'CANONICAL', outcome: 'STALE', canonical_state} as const, label: 'STALE'},
      {result: {kind: 'OPERATION_ID_CONFLICT', canonical_state} as const, label: 'CONFLICT'},
      {result: {kind: 'CANONICAL', outcome: 'REPLAYED', canonical_state, committed_version: 1} as const, label: 'REPLAYED'},
      {result: {kind: 'CANONICAL', outcome: 'NO_CHANGE', canonical_state} as const, label: 'NO CHANGE'},
    ];
    for (const item of outcomes) {
      const session = {...base, open: jest.fn().mockResolvedValue(item.result)};
      const screen = render(<DecisionScreen session={session} clientId="status-tv" expiresAtEpochSeconds={1000} />);
      await activate(screen.getByRole('button', {name: 'Open shared decision'}));
      expect(screen.getByText(new RegExp(item.label))).toBeTruthy();
      screen.unmount();
    }
  });

  it('inspects tradeoffs and Back restores the semantic origin', async () => {
    jest.useFakeTimers();
    const {screen} = await openedScreen();
    await activate(screen.getByRole('button', {name: 'Inspect Riverside Picnic tradeoffs'}));
    expect(screen.getByText('DECISION DETAILS')).toBeTruthy();
    await activate(screen.getByRole('button', {name: 'Back to decision'}));
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText('CANDIDATE OPTIONS')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Inspect Riverside Picnic tradeoffs'})).toBeTruthy();
  });

  it('persists response choices and requires explicit confirmation after four approvals', async () => {
    const {screen, store} = await selectedScreen();
    for (const name of ['Alex', 'Blair', 'Casey']) await activate(screen.getByRole('button', {name: `${name} approves the selected activity`}));
    expect(screen.getByText('CONSENSUS · PENDING')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Confirm selected plan', disabled: true})).toBeTruthy();
    await activate(screen.getByRole('button', {name: 'Devon approves the selected activity'}));
    expect(screen.getByText(/READY TO CONFIRM/)).toBeTruthy();
    const ready = await store.loadDecision('decision-saturday-activity');
    expect(ready.kind === 'FOUND' && ready.canonical_state.confirmed_plan).toBeNull();
    expect(screen.queryByText('PLAN CONFIRMED')).toBeNull();
    await activate(screen.getByRole('button', {name: 'Confirm selected plan'}));
    expect(screen.getByText('✓ PLAN CONFIRMED')).toBeTruthy();
    expect(screen.getByText(/Plan version 1/)).toBeTruthy();
    expect(screen.getByText(/Return-by-18:00 arrangement · retained 17:00/)).toBeTruthy();
  });

  it('returns to candidate choice without a write and keeps the selected row identified', async () => {
    const {screen, store} = await selectedScreen();
    const before = await store.loadDecision('decision-saturday-activity');
    await activate(screen.getByRole('button', {name: 'Change selected candidate'}));
    expect(screen.getByText('STEP 2 · CHOOSE A FEASIBLE OPTION')).toBeTruthy();
    expect(screen.getByText('✓ SELECTED · FEASIBLE')).toBeTruthy();
    expect(await store.loadDecision('decision-saturday-activity')).toEqual(before);
    await activate(screen.getByRole('button', {name: 'Select candidate Museum Workshop'}));
    expect(screen.getByText('STEP 3 · INDIVIDUAL RESPONSES')).toBeTruthy();
    expect(screen.getByText('Museum Workshop')).toBeTruthy();
  });

  it('shows real feasible, infeasible, disabled, and trade-off candidate states', async () => {
    const {screen} = await openedScreen();
    expect(screen.getAllByText('✓ FEASIBLE')).toHaveLength(2);
    expect(screen.getAllByText('✕ NOT FEASIBLE')).toHaveLength(2);
    expect(screen.getByText(/Costs 72 EUR, above the 60 EUR limit/)).toBeTruthy();
    expect(screen.getByText(/Does not match the outdoor preference/)).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Select candidate Forest Activity Course', disabled: true}).props.focusable).toBe(false);
  });

  it('gives unavailable candidate text full row width and retains the bottom focus reserve', async () => {
    const {screen} = await openedScreen();
    const row = screen.getByText('Forest Activity Course').parent?.parent?.parent?.parent?.parent?.parent;
    expect(row).toBeTruthy();
    expect(mergedStyle(row!.props.style)).toMatchObject({
      flexDirection: 'column', alignItems: 'stretch', paddingVertical: verticalFit.rowPaddingVertical,
      gap: verticalFit.infeasibleContentGap,
    });
    expect(mergedStyle((row!.children[0] as ReactTestInstance).props.style)).toMatchObject({flex: 0, gap: verticalFit.infoGap});
    expect(screen.UNSAFE_getAllByType(ScrollView).some(stage => {
      const style = mergedStyle(stage.props.contentContainerStyle);
      return style.gap === verticalFit.stageGap && style.paddingBottom === geometry.focusReserve;
    })).toBe(true);
  });

  it('uses the same compact full-width geometry for unavailable replacements', async () => {
    const {screen} = await confirmedScreen();
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    const row = screen.getByText('Forest Activity Course').parent?.parent?.parent?.parent?.parent?.parent;
    expect(row).toBeTruthy();
    expect(mergedStyle(row!.props.style)).toMatchObject({
      flexDirection: 'column', alignItems: 'stretch', paddingVertical: verticalFit.rowPaddingVertical,
      gap: verticalFit.infeasibleContentGap,
    });
    expect(mergedStyle((row!.children[0] as ReactTestInstance).props.style)).toMatchObject({flex: 0, gap: verticalFit.infoGap});
    expect(screen.UNSAFE_getAllByType(ScrollView).some(stage => {
      const style = mergedStyle(stage.props.contentContainerStyle);
      return style.gap === verticalFit.stageGap && style.paddingBottom === geometry.focusReserve;
    })).toBe(true);
  });

  it('renders the complete compact candidate and Replan spines with actual fit styles', async () => {
    const {screen} = await openedScreen();
    for (const label of ['SESSION MODE', 'CANONICAL STATE', 'PARTICIPANTS', 'CONSTRAINT WALL', 'LIVE STATUS', 'DECISION VERSION · CAS', 'PLAN VERSION']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Reload canonical decision'})).toBeTruthy();
    expect(mergedStyle(screen.getByText('SESSION MODE').parent!.parent!.props.style)).toMatchObject({paddingVertical: compactSpine.blockPaddingVertical, gap: compactSpine.blockGap});
    expect(mergedStyle(screen.getByText('LIVE STATUS').parent!.parent!.props.style)).toMatchObject({paddingVertical: compactSpine.blockPaddingVertical});
    expect(mergedStyle(screen.getByText(/New fixture decision started/).props.style)).toMatchObject({lineHeight: compactSpine.statusLineHeight});
    const candidateFonts = screen.UNSAFE_getAllByType(Text).map(node => mergedStyle(node.props.style ?? {}).fontSize).filter((size): size is number => typeof size === 'number');
    expect(Math.min(...candidateFonts)).toBeGreaterThanOrEqual(19);
    await activate(screen.getByRole('button', {name: 'Select candidate Riverside Picnic'}));
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) await activate(screen.getByRole('button', {name: `${name} approves the selected activity`}));
    await activate(screen.getByRole('button', {name: 'Confirm selected plan'}));
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    for (const label of ['SESSION MODE', 'CANONICAL STATE', 'DECISION VERSION · CAS', 'PLAN VERSION', '◆ AFFECTED · MAY CHANGE', '▣ PRESERVED · STAYS AS SAVED', 'SCOPED CONSENSUS', 'LIVE STATUS']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Reload canonical decision'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Leave shared decision'})).toBeTruthy();
    for (const label of ['◆ AFFECTED · MAY CHANGE', '▣ PRESERVED · STAYS AS SAVED']) expect(mergedStyle(screen.getByText(label).parent!.parent!.props.style)).toMatchObject({paddingVertical: compactSpine.scopePaddingVertical, marginBottom: compactSpine.scopeMarginBottom});
    const replanFonts = screen.UNSAFE_getAllByType(Text).map(node => mergedStyle(node.props.style ?? {}).fontSize).filter((size): size is number => typeof size === 'number');
    expect(Math.min(...replanFonts)).toBeGreaterThanOrEqual(19);
  });

  it('presents Stage A and Stage B from a real write-free selection and retains the draft on Change', async () => {
    const {screen, store} = await confirmedScreen();
    const before = await store.loadDecision('decision-saturday-activity');
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    expect(screen.getByText(/Synthetic/)).toBeTruthy();
    expect(screen.getAllByRole('button', {name: /Inspect replacement/})).toHaveLength(3);
    expect(screen.getAllByRole('button', {name: /Choose replacement/})).toHaveLength(3);
    expect(screen.queryByRole('button', {name: 'Alex — Approve replacement'})).toBeNull();
    expect(screen.queryByRole('button', {name: /Confirm replanned plan/})).toBeNull();
    await activate(screen.getByRole('button', {name: 'Choose replacement Museum Workshop'}));
    expect(screen.getByText('✓ SELECTED')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Change replacement'})).toBeTruthy();
    expect(mergedStyle(screen.getByText('REPLANNING · SCOPED REAPPROVAL').props.style)).toMatchObject({lineHeight: verticalFit.replanEyebrowLineHeight});
    expect(mergedStyle(screen.getByText('SCOPED CONSENSUS · PENDING').props.style)).toMatchObject({lineHeight: verticalFit.replanConsensusLineHeight});
    expect(screen.getAllByRole('button', {name: /Inspect replacement/})).toHaveLength(1);
    expect(screen.queryByRole('button', {name: /Choose replacement/})).toBeNull();
    expect(screen.queryByText(/Synthetic/)).toBeNull();
    expect(screen.getByRole('button', {name: 'Confirm replanned plan', disabled: true})).toBeTruthy();
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) {
      expect(screen.getByRole('button', {name: `${name} — Approve replacement`, disabled: false})).toBeTruthy();
      expect(screen.getByRole('button', {name: `${name} — Reject replacement`, disabled: false})).toBeTruthy();
    }
    await activate(screen.getByRole('button', {name: 'Alex — Approve replacement'}));
    await activate(screen.getByRole('button', {name: 'Change replacement'}));
    expect(screen.getAllByRole('button', {name: /Inspect replacement/})).toHaveLength(3);
    expect(screen.getByText('✓ SELECTED')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Alex — Approve replacement'})).toBeNull();
    await activate(screen.getByRole('button', {name: 'Choose replacement Museum Workshop'}));
    expect(screen.getByText('APPROVED')).toBeTruthy();
    expect(await store.loadDecision('decision-saturday-activity')).toEqual(before);
  });

  it('restores mounted focus across both stages and detail returns without activating controls', async () => {
    jest.useFakeTimers();
    const {screen, store} = await confirmedScreen();
    const before = await store.loadDecision('decision-saturday-activity');
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    await activate(screen.getByRole('button', {name: 'Inspect replacement Museum Workshop'}));
    await activate(screen.getByRole('button', {name: 'Back to decision'}));
    act(() => jest.advanceTimersByTime(100));
    expect(findNodeHandle).toHaveBeenCalled();
    expect(findNodeHandle).toHaveBeenLastCalledWith(expect.objectContaining({props: expect.objectContaining({accessibilityLabel: 'Inspect replacement Museum Workshop'})}));
    expect(mockFocus).toHaveBeenLastCalledWith(121);
    mockFocus.mockClear();
    await activate(screen.getByRole('button', {name: 'Choose replacement Museum Workshop'}));
    act(() => jest.advanceTimersByTime(100));
    expect(findNodeHandle).toHaveBeenLastCalledWith(expect.objectContaining({props: expect.objectContaining({accessibilityLabel: 'Alex — Approve replacement'})}));
    expect(mockFocus).toHaveBeenLastCalledWith(121);
    expect(screen.getAllByText('PENDING').length).toBeGreaterThanOrEqual(4);
    mockFocus.mockClear();
    await activate(screen.getByRole('button', {name: 'Change replacement'}));
    act(() => jest.advanceTimersByTime(100));
    expect(findNodeHandle).toHaveBeenLastCalledWith(expect.objectContaining({props: expect.objectContaining({accessibilityLabel: 'Inspect replacement Museum Workshop'})}));
    expect(mockFocus).toHaveBeenLastCalledWith(121);
    await activate(screen.getByRole('button', {name: 'Choose replacement Museum Workshop'}));
    await activate(screen.getByRole('button', {name: 'Inspect replacement Museum Workshop'}));
    await activate(screen.getByRole('button', {name: 'Back to decision'}));
    act(() => jest.advanceTimersByTime(100));
    expect(findNodeHandle).toHaveBeenLastCalledWith(expect.objectContaining({props: expect.objectContaining({accessibilityLabel: 'Inspect replacement Museum Workshop'})}));
    expect(mockFocus).toHaveBeenLastCalledWith(121);
    expect(await store.loadDecision('decision-saturday-activity')).toEqual(before);
  });

  it('fits the selected-response grid with rejection and keeps explicit READY confirmation', async () => {
    const {screen, store} = await confirmedScreen();
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    await activate(screen.getByRole('button', {name: 'Choose replacement Museum Workshop'}));
    for (const name of ['Alex', 'Blair', 'Casey']) await activate(screen.getByRole('button', {name: `${name} — Approve replacement`}));
    await activate(screen.getByRole('button', {name: 'Devon — Reject replacement'}));
    expect(screen.getByText('SCOPED CONSENSUS · REJECTED')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Confirm replanned plan', disabled: true})).toBeTruthy();
    expect(screen.getByText('Confirm replanned plan · UNAVAILABLE')).toBeTruthy();
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) {
      const selected = screen.getByRole('button', {name: `${name} — ${name === 'Devon' ? 'Reject' : 'Approve'} replacement`});
      expect(selected.props.accessibilityState.selected).toBe(true);
      expect(selected.props.accessibilityState.disabled).toBe(false);
    }
    let card: ReactTestInstance | null = screen.getByText('Alex');
    while (card && mergedStyle(card.props.style ?? {}).width !== '49%') card = card.parent;
    expect(card).not.toBeNull();
    expect(mergedStyle(card!.props.style)).toMatchObject({width: '49%', paddingVertical: 20, paddingHorizontal: 24, gap: 4});
    expect(mergedStyle(card!.parent!.parent!.props.style)).toMatchObject({gap: 18});
    const before = await store.loadDecision('decision-saturday-activity');
    await activate(screen.getByRole('button', {name: 'Devon — Approve replacement'}));
    expect(screen.getByText('SCOPED CONSENSUS · APPROVED · READY TO CONFIRM')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Confirm replanned plan', disabled: false})).toBeTruthy();
    expect(await store.loadDecision('decision-saturday-activity')).toEqual(before);
  });

  it('disables duplicate activation while a command is pending', async () => {
    const {screen} = await openedScreen();
    const select = screen.getByRole('button', {name: 'Select candidate Riverside Picnic'});
    await act(async () => {press(select); press(select); await Promise.resolve(); await Promise.resolve();});
    expect(screen.getByText(/Saved at decision version 2/)).toBeTruthy();
  });

  it('leaves, releases displayed state, and reopens the canonical plan read-only', async () => {
    const {screen} = await confirmedScreen();
    await activate(screen.getByRole('button', {name: 'Leave shared decision'}));
    expect(screen.getByText(/Displayed state was released/)).toBeTruthy();
    await activate(screen.getByRole('button', {name: 'Reopen canonical decision'}));
    expect(screen.getByText('✓ PLAN CONFIRMED')).toBeTruthy();
    expect(screen.getByText(/Decision version 7 · Plan version 1/)).toBeTruthy();
  });

  it('shows confirmed details and restores the confirmed origin', async () => {
    jest.useFakeTimers();
    const {screen} = await confirmedScreen();
    await activate(screen.getByRole('button', {name: 'Inspect confirmed components'}));
    expect(screen.getByText('Confirmed plan version 1')).toBeTruthy();
    expect(screen.getByText('Return-by-18:00 arrangement')).toBeTruthy();
    await activate(screen.getByRole('button', {name: 'Back to decision'}));
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByRole('button', {name: 'Inspect confirmed components'})).toBeTruthy();
  });

  it('enters scoped replan from the confirmed canonical plan and Back writes nothing', async () => {
    const {screen, store} = await confirmedScreen();
    const before = await store.loadDecision('decision-saturday-activity');
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    expect(screen.getByText('REPLANNING · SCOPED REAPPROVAL')).toBeTruthy();
    expect(screen.getByText('◆ AFFECTED · MAY CHANGE')).toBeTruthy();
    expect(screen.getByText('▣ PRESERVED · STAYS AS SAVED')).toBeTruthy();
    expect(screen.getByText(/Saturday activity · Riverside Picnic/)).toBeTruthy();
    expect(screen.getByText(/Return-by-18:00 arrangement · retained 17:00/)).toBeTruthy();
    act(() => expect(mockBackCallback?.()).toBe(true));
    expect(await store.loadDecision('decision-saturday-activity')).toEqual(before);
  });

  it('returns from replacement details to the scoped draft without changing it', async () => {
    jest.useFakeTimers();
    const {screen, store} = await confirmedScreen();
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    const before = await store.loadDecision('decision-saturday-activity');
    await activate(screen.getByRole('button', {name: 'Inspect replacement Museum Workshop'}));
    expect(screen.getByText('Museum Workshop')).toBeTruthy();
    await activate(screen.getByRole('button', {name: 'Back to decision'}));
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText('REPLANNING · SCOPED REAPPROVAL')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Inspect replacement Museum Workshop'})).toBeTruthy();
    expect(await store.loadDecision('decision-saturday-activity')).toEqual(before);
  });

  it('finalizes scoped approval once and displays the latest canonical versions', async () => {
    const {screen} = await confirmedScreen();
    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    await activate(screen.getByRole('button', {name: 'Choose replacement Museum Workshop'}));
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) await activate(screen.getByRole('button', {name: `${name} — Approve replacement`}));
    await activate(screen.getByRole('button', {name: 'Confirm replanned plan'}));
    expect(screen.getByText(/Decision version 8 · Plan version 2/)).toBeTruthy();
    expect(screen.getByText(/Saturday activity · Museum Workshop/)).toBeTruthy();
    expect(screen.getByText(/Return-by-18:00 arrangement · retained 17:00/)).toBeTruthy();
  });

  it('uses accessible button roles and readable live status', () => {
    const {screen} = renderScreen();
    expect(screen.getByText(/Open the shared decision/).props.accessibilityLiveRegion).toBe('polite');
    for (const button of screen.getAllByRole('button')) {
      expect(button.props.accessible).toBe(true);
      expect(button.props.accessibilityState).toEqual(expect.objectContaining({disabled: expect.any(Boolean)}));
    }
  });

  it('uses deterministic fallback focus when an origin is absent', () => {
    const fallback = {} as never;
    expect(resolveFocusTarget(new Map([[FALLBACK_FOCUS_TARGET_KEY, fallback]]), 'missing')).toBe(fallback);
  });

  it('returns the truth spine to scroll origin on Replan entry and on every Stage A/B transition without focus or product effects', async () => {
    const spineScrollTo = (ScrollView as unknown as {prototype: {scrollTo: jest.Mock}}).prototype.scrollTo;
    const {screen, store} = await confirmedScreen();
    const before = await store.loadDecision('decision-saturday-activity');
    spineScrollTo.mockClear();
    mockFocus.mockClear();

    await activate(screen.getByRole('button', {name: 'Reopen the affected part of the plan'}));
    expect(screen.getAllByRole('button', {name: /Choose replacement/})).toHaveLength(3);
    expect(spineScrollTo.mock.calls).toEqual([[{y: 0, animated: false}]]);

    spineScrollTo.mockClear();
    await activate(screen.getByRole('button', {name: 'Choose replacement Museum Workshop'}));
    expect(screen.getByRole('button', {name: 'Change replacement'})).toBeTruthy();
    expect(spineScrollTo.mock.calls).toEqual([[{y: 0, animated: false}]]);

    spineScrollTo.mockClear();
    await activate(screen.getByRole('button', {name: 'Change replacement'}));
    expect(screen.getAllByRole('button', {name: /Choose replacement/})).toHaveLength(3);
    expect(spineScrollTo.mock.calls).toEqual([[{y: 0, animated: false}]]);

    expect(mockFocus).not.toHaveBeenCalled();
    expect(await store.loadDecision('decision-saturday-activity')).toEqual(before);
  });

  it('leaves the truth spine untouched across unrelated non-Replan stage transitions', async () => {
    const spineScrollTo = (ScrollView as unknown as {prototype: {scrollTo: jest.Mock}}).prototype.scrollTo;
    spineScrollTo.mockClear();
    const {screen} = renderScreen();
    spineScrollTo.mockClear();
    await activate(screen.getByRole('button', {name: 'Open shared decision'}));
    await activate(screen.getByRole('button', {name: 'Start new fixture decision'}));
    await activate(screen.getByRole('button', {name: 'Select candidate Riverside Picnic'}));
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) await activate(screen.getByRole('button', {name: `${name} approves the selected activity`}));
    await activate(screen.getByRole('button', {name: 'Confirm selected plan'}));
    expect(screen.getByRole('button', {name: 'Reopen the affected part of the plan'})).toBeTruthy();
    expect(spineScrollTo).not.toHaveBeenCalled();
  });
});
