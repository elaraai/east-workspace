import { Text } from '@chakra-ui/react'
import { PlaceholderMode } from '../spec/Placeholder'

export default function CompareRoute() {
  return (
    <PlaceholderMode
      modeId="compare"
      modeNumber="2.5"
      modeName="Compare"
      question="How does this differ from last time / from the runner-up?"
      anchorPatternName="Recommendation.WhatChanged"
      intro={
        <>
          <Text>
            Compare answers two questions: <em>"what changed since last cycle?"</em> and <em>"how does
            this rec differ from the runner-up?"</em>. The anchor pattern is
            <code> Recommendation.WhatChanged</code> — narrative summary of differences, not a tree
            view.
          </Text>
          <Text mt={3}>
            Structural diff (full DiffView) is for the Strategic archetype where the user really
            does want to see a tree of changes. For Routine and Exception, narrative summary is
            faster and more defensible.
          </Text>
        </>
      }
      patterns={[
        {
          anchor: '2.5.1', name: 'Recommendation.WhatChanged', family: 'Recommendation.*', isAnchor: true,
          purpose: '"vs last week: 3 SE shifts moved to VIC; promo extended; 2 workers off." Natural-language Compare summary for routine and exception archetypes.',
        },
        {
          anchor: '2.5.2', name: 'RecVsRunnerUp',
          purpose: '"This rec scored 84; the runner-up scored 81; the difference is [factor]." Decision-maker version of trade-off / Pareto, narrative-shaped.',
        },
        {
          anchor: '2.5.3', name: 'DiffView',
          purpose: 'Full structural diff for any state. Recursive depth-based indentation; per-row × discard, per-section discard-all, footer Apply/Discard. 3-way merge with chooser cards. Used for Strategic decisions where the user really wants the tree.',
        },
        {
          anchor: '2.5.4', name: 'DeltaPill',
          purpose: 'Inline directional-delta chip. magnitude: higher-is-better | lower-is-better | { kind: target-is-best, target, tolerance }. Optional ci and significant decorations.',
        },
        {
          anchor: '2.5.5', name: 'ContextSelector',
          purpose: 'Labelled chip that opens a rich picker — scenario / period / region. Cross-cutting; lives here as the Compare-mode anchor for "which context am I viewing".',
        },
        {
          anchor: '2.5.6', name: 'VersusHeader',
          purpose: '"A vs B" header with hot-swap dropdowns + delta slot. Scaffolding for two-way comparison views.',
        },
        {
          anchor: '2.5.7', name: 'BeforeAfterTimeline',
          purpose: 'Richer DiffView for time-series state: see when a change took effect, not just what changed.',
        },
      ]}
    />
  )
}
