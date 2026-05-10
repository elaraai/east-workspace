import { Text } from '@chakra-ui/react'
import { PlaceholderMode } from '../spec/Placeholder'

export default function ObserveRoute() {
  return (
    <PlaceholderMode
      modeId="observe"
      modeNumber="2.1"
      modeName="Observe"
      question="What needs my attention?"
      anchorPatternName="Decision.Queue"
      intro={
        <>
          <Text>
            Observe is the user's <strong>landing surface</strong>. A frontline manager spends most
            of their day in queue triage, not analytical dashboards. The anchor pattern is
            <code> Decision.Queue</code> — the prioritised list of decisions awaiting action,
            sorted by stakes × urgency, with bulk-accept on routine items.
          </Text>
          <Text mt={3}>
            Other Observe patterns serve the <em>check-in</em> sub-task ("is everything OK at a
            glance?"): KPI tiles, anomaly lists, threshold bands, partial-results notices,
            first-run states. They support the queue rather than competing with it.
          </Text>
          <Text mt={3}>
            <strong>What this mode does NOT cover:</strong> deep analytical drill-down (that's
            Diagnose), forecasting (Predict), or comparison (Compare). If a user lands on Observe
            and immediately needs to compare or explain, the mode is too cluttered.
          </Text>
        </>
      }
      patterns={[
        {
          anchor: '2.1.1', name: 'Decision.Queue', family: 'Decision.*', isAnchor: true,
          purpose: 'Prioritised list of decisions awaiting action. Sorted by stakes × urgency. Routine items can be bulk-accepted with one click; exceptions expand inline. Replaces dashboard-as-landing-page.',
        },
        {
          anchor: '2.1.2', name: 'StatCard',
          purpose: 'Single-metric tile: label + mono value + baseline + delta + sparkline. Layout: vertical | horizontal | trend-led. For quick-glance check-ins, not analysis.',
        },
        {
          anchor: '2.1.3', name: 'StatGrid',
          purpose: 'N×M grid of StatCards with shared border-only frame. For dashboard-style overviews.',
        },
        {
          anchor: '2.1.4', name: 'MetricRail',
          purpose: 'Horizontal pill rail of compact metrics — for headers / filter chips.',
        },
        {
          anchor: '2.1.5', name: 'AnomalyList',
          purpose: '"Things drifting from expected" — anomalies sorted by severity with chips + drill-through. Distinct from Decision.Queue (which is action-required, not just unusual).',
        },
        {
          anchor: '2.1.6', name: 'AttentionList',
          purpose: 'Prioritised list of items requiring user attention but not necessarily decisions. Lighter weight than Decision.Queue. May be merged into Decision.Queue depending on app.',
        },
        {
          anchor: '2.1.7', name: 'ThresholdBand',
          purpose: 'Coloured bands behind a chart axis (good / acceptable / bad). Used as overlay on Predict charts; lives here for the visual primitive.',
        },
        {
          anchor: '2.1.8', name: 'FreshDecisionsCount',
          purpose: '"7 new decisions waiting · 3 past SLA" — tiny header strip that anchors the user when they land. Surfaces queue depth without the queue itself.',
        },
        {
          anchor: '2.1.9', name: 'PartialResultsNotice', family: 'Banner.*',
          purpose: '"We could only get N of M sources" — inline notice when data is incomplete. Pairs with retry. Banner family member.',
        },
        {
          anchor: '2.1.10', name: 'FirstRunState',
          purpose: 'Empty / zero-state shell with checklist of next steps. For new users, post-data-loss recovery, etc.',
        },
      ]}
    />
  )
}
