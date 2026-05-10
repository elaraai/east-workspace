import { Text } from '@chakra-ui/react'
import { PlaceholderMode } from '../spec/Placeholder'

export default function ConfigureRoute() {
  return (
    <PlaceholderMode
      modeId="configure"
      modeNumber="2.7"
      modeName="Configure"
      question="What inputs drive this view?"
      anchorPatternName="InputBand.Assumptions"
      intro={
        <>
          <Text>
            Configure is the <strong>edit-the-inputs</strong> mode. The anchor is the
            <code> InputBand</code> family — assumption chips, filter chips, parameter forms — all
            sharing one contract: editable inputs that emit a Patch.
          </Text>
          <Text mt={3}>
            Configure has the most patterns of any mode because the inputs to a decision span many
            shapes — calendar cells, value matrices, drag-drop assignment grids, source libraries.
            Each is mode-specific scaffolding for a particular input shape.
          </Text>
          <Text mt={3}>
            <strong>What this mode does NOT cover:</strong> solver internals (those are for
            implementers). The user configures inputs; they don't tune solver parameters.
          </Text>
        </>
      }
      patterns={[
        {
          anchor: '2.7.1', name: 'InputBand.Assumptions', family: 'InputBand.*', isAnchor: true,
          purpose: 'Horizontal chip row of scenario assumptions. Each chip opens an edit popover; emits Patch<TAssumptions>.',
        },
        {
          anchor: '2.7.2', name: 'InputBand.Filter', family: 'InputBand.*',
          purpose: 'Faceted filters for queries / lists. Each filter is a chip; selection composes a query patch.',
        },
        {
          anchor: '2.7.3', name: 'InputBand.Parameters', family: 'InputBand.*',
          purpose: 'Card-wrapped labelled inputs + guardrails. Each field edit emits a patch; the section composes a draft.',
        },
        {
          anchor: '2.7.4', name: 'AssumptionConfidence',
          purpose: '"How sure am I about this?" slider alongside each assumption in InputBand.Assumptions. Frontline managers know which of their assumptions are firm vs guesses; the system records both.',
        },
        {
          anchor: '2.7.5', name: 'CalendarHeatmap',
          purpose: 'Calendar grid + multi-select + legend. Each cell carries an intensity (0–4). CalendarHeatmap.Weekly is the 7-column preset.',
        },
        {
          anchor: '2.7.6', name: 'PresetPicker',
          purpose: '"Conservative / Balanced / Aggressive" radio cards. A preset is a named patch; selecting one applies preset.patch.',
        },
        {
          anchor: '2.7.7', name: 'ValueMatrixEditor',
          purpose: 'Editable grid with row/column totals. Per-cell patch emit; row chips via SumCheckBadge. Keyboard contract per §0.2.',
        },
        {
          anchor: '2.7.8', name: 'SensitivityView',
          purpose: 'Workbench: AssumptionsBar + WhatIfList + PresetPicker side-by-side, with per-assumption elasticity / flip-point.',
        },
        {
          anchor: '2.7.9', name: 'AssignmentBoard',
          purpose: 'Generic drag-to-assign grid (worker→shift, order→truck, lead→owner). Drop emits a patch. validateDrop shows valid/invalid targets in flight.',
        },
        {
          anchor: '2.7.10', name: 'UnassignedTray',
          purpose: 'Sidebar of draggable orphan items; first-class empty states (clean vs zero).',
        },
        {
          anchor: '2.7.11', name: 'SourceLibrary',
          purpose: 'Catalogue of draggable templates grouped by category. onApplyBulk for multi-template apply.',
        },
        {
          anchor: '2.7.12', name: 'ConflictAnnotator', isRecipe: true,
          purpose: 'Recipe: per offending grid cell, render a Status chip + Tooltip with rule explanation.',
        },
        {
          anchor: '2.7.13', name: 'SwapRequest',
          purpose: 'Peer-to-peer reassignment. Propose = patch; accept = apply; decline = discard. State drives dialog tone.',
        },
        {
          anchor: '2.7.14', name: 'SupplyDemandView',
          purpose: 'Generic supply-vs-demand alignment: roster/demand, inventory/forecast, budget/burn, capacity/orders. axis: time | category.',
        },
        {
          anchor: '2.7.15', name: 'SumCheckBadge',
          purpose: 'Total-vs-target validation chip. Tolerance band tints neutral / warn / err.',
        },
        {
          anchor: '2.7.16', name: 'IndicatorCluster',
          purpose: 'Pass / warn / fail / unknown checks as readiness gates. orientation: row | column, style: compact | detailed.',
        },
      ]}
    />
  )
}
