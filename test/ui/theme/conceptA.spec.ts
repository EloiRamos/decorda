import {colors, compactSpine, focus, geometry, typography, verticalFit} from '../../../src/ui/theme/conceptA';

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(first: string, second: string): number {
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('approved Concept A tokens', () => {
  it('freezes the 1920x1080 television structure and type floor', () => {
    expect(geometry).toMatchObject({canvasWidth: 1920, canvasHeight: 1080, spineWidth: 544, stageGap: 56, paddingVertical: 52, paddingHorizontal: 64, radius: 0, focusReserve: 11});
    expect(typography.minimum).toBe(19);
    expect(typography.machine).toBe('monospace');
    expect(focus).toMatchObject({outerWidth: 5, gap: 6, standardScale: 1.02});
  });
  it('budgets four full candidate rows and three replacement rows within the fixed stage', () => {
    const stageHeight = geometry.canvasHeight - 2 * geometry.paddingVertical;
    expect(verticalFit).toMatchObject({stageGap: 8, rowPaddingVertical: 12, infeasibleContentGap: 0, infoGap: 2});
    // Budgets allow one extra note line in each unavailable row and include the
    // complete action frames; the section/header allowances include their text.
    const candidatesHeight = verticalFit.candidateHeaderBudget +
      2 * verticalFit.feasibleRowBudget + 2 * verticalFit.infeasibleRowBudget +
      5 * verticalFit.stageGap + geometry.focusReserve;
    const replacementsHeight = verticalFit.replanHeaderBudget +
      verticalFit.feasibleRowBudget + 2 * verticalFit.infeasibleRowBudget +
      5 * verticalFit.stageGap + geometry.focusReserve;
    expect(candidatesHeight).toBeLessThanOrEqual(stageHeight);
    expect(replacementsHeight).toBeLessThanOrEqual(stageHeight);
    expect(geometry.focusReserve).toBeGreaterThanOrEqual(focus.outerWidth + focus.gap);
    expect(Math.min(typography.minimum, typography.label, typography.badge, typography.metadata,
      typography.controlCompact, typography.controlStandard, typography.body)).toBeGreaterThanOrEqual(19);
  });
  it('freezes complete compact spine and two-stage replan allocations', () => {
    const candidates = compactSpine.candidates.base -
      compactSpine.candidates.paddedBlocks * 2 * (16 - compactSpine.blockPaddingVertical) -
      compactSpine.candidates.ordinaryGaps * (7 - compactSpine.blockGap) -
      (29 - compactSpine.statusLineHeight) +
      (compactSpine.candidates.statusLines - 1) * compactSpine.statusLineHeight +
      compactSpine.candidates.metricAllowance;
    const replan = compactSpine.replan.base -
      compactSpine.replan.paddedBlocks * 2 * (16 - compactSpine.blockPaddingVertical) -
      compactSpine.replan.ordinaryGaps * (7 - compactSpine.blockGap) -
      (29 - compactSpine.statusLineHeight) -
      compactSpine.replan.scopeBoxes * 2 * (16 - compactSpine.scopePaddingVertical) -
      compactSpine.replan.scopeBoxes * (12 - compactSpine.scopeMarginBottom) +
      (compactSpine.replan.statusLines - 1) * compactSpine.statusLineHeight +
      compactSpine.replan.metricAllowance;
    expect(candidates).toBe(969);
    expect(replan).toBe(970);
    expect(candidates).toBeLessThanOrEqual(verticalFit.safeBudget);
    expect(replan).toBeLessThanOrEqual(verticalFit.safeBudget);
    expect(candidates + compactSpine.statusLineHeight).toBeGreaterThan(verticalFit.safeBudget);
    expect(replan + compactSpine.statusLineHeight).toBeGreaterThan(verticalFit.safeBudget);
    const stageA = verticalFit.stageA;
    const stageB = verticalFit.stageB;
    expect(stageA.eyebrow + stageA.headline + stageA.note + stageA.selectedRow + stageA.unavailableRows + stageA.back + stageA.gaps * verticalFit.stageGap + verticalFit.bottomFocusReserve).toBe(963);
    expect(stageB.eyebrow + stageB.note + stageB.summary + stageB.consensus + stageB.participantGrid + stageB.actions + stageB.gaps * verticalFit.stageGap + verticalFit.bottomFocusReserve + stageB.extraFitReserve).toBe(959);
    expect(Math.min(...Object.values(typography).filter(value => typeof value === 'number') as number[])).toBe(19);
  });
  it('uses the thirteen approved product colors', () => {
    expect(colors).toEqual({
      ground: '#0E1116', panel: '#151A21', recessedPanel: '#11151B', rule: '#2A323D',
      ink: '#EDF0F3', inkSecondary: '#C9D4DE', inkTertiary: '#9FAEBD', signal: '#E8B44A',
      absolute: '#F2F5F8', actionInk: '#10131A', secondaryActionBackground: '#1B222B',
      secondaryActionBorder: '#47525F', inactiveBorder: '#5A6674',
    });
  });
  it('meets normal, large, focus, and disabled contrast thresholds', () => {
    expect(contrast(colors.ink, colors.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.inkSecondary, colors.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.inkTertiary, colors.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.actionInk, colors.signal)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.absolute, colors.panel)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.signal, colors.ground)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.inkTertiary, colors.secondaryActionBackground)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.inactiveBorder, colors.recessedPanel)).toBeGreaterThanOrEqual(3);
  });
});
