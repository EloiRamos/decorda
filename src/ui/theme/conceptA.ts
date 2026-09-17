/** Approved Concept A product-canvas tokens (the web review frame is excluded). */
export const colors = {
  ground: '#0E1116', panel: '#151A21', recessedPanel: '#11151B',
  rule: '#2A323D', ink: '#EDF0F3', inkSecondary: '#C9D4DE',
  inkTertiary: '#9FAEBD', signal: '#E8B44A', absolute: '#F2F5F8',
  actionInk: '#10131A', secondaryActionBackground: '#1B222B',
  secondaryActionBorder: '#47525F', inactiveBorder: '#5A6674',
} as const;

export const geometry = {
  canvasWidth: 1920, canvasHeight: 1080, paddingVertical: 52,
  paddingHorizontal: 64, spineWidth: 544, stageGap: 56,
  spineRightPadding: 48, radius: 0, focusReserve: 11,
} as const;

export const spacing = {
  xxs: 7, xs: 10, sm: 12, md: 14, lg: 16, card: 18,
  block: 20, section: 22, stage: 24, row: 26, column: 56,
} as const;

/** Conservative fixed-stage allocations at the 1920×1080 reference canvas. */
export const verticalFit = {
  stageGap: 8, rowPaddingVertical: 12, infeasibleContentGap: 0, infoGap: 2,
  candidateHeaderBudget: 150, replanHeaderBudget: 270,
  feasibleRowBudget: 130, infeasibleRowBudget: 245,
  safeBudget: 976, bottomFocusReserve: 11,
  replanEyebrowLineHeight: 30, replanConsensusLineHeight: 26,
  stageA: {eyebrow: 30, headline: 104, note: 62, selectedRow: 144, unavailableRows: 460, back: 104, gaps: 6},
  stageB: {eyebrow: 30, note: 62, summary: 144, consensus: 26, participantGrid: 442, actions: 104, gaps: 5, extraFitReserve: 100},
} as const;

export const compactSpine = {
  blockPaddingVertical: 2, versionsPaddingVertical: 2, blockGap: 3,
  statusLineHeight: 26, scopePaddingVertical: 4, scopeMarginBottom: 4,
  candidates: {base: 1118, paddedBlocks: 6, ordinaryGaps: 11, statusLines: 3, metricAllowance: 14},
  replan: {base: 1127, paddedBlocks: 5, ordinaryGaps: 4, scopeBoxes: 2, statusLines: 3, metricAllowance: 14},
} as const;

export const typography = {
  machine: 'monospace', minimum: 19, label: 19, small: 20,
  badge: 21, metadata: 22, stageLabel: 23, body: 24,
  controlCompact: 26, controlStandard: 28, participant: 34,
  candidate: 38, stageHeadline: 46, wordmark: 46,
  confirmed: 52, detailHeadline: 62,
} as const;

export const focus = {outerWidth: 5, gap: 6, standardScale: 1.02, compactScale: 1.03, smallScale: 1.04} as const;
