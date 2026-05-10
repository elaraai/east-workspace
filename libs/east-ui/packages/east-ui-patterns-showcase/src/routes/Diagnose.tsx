import { Text } from '@chakra-ui/react'
import { PlaceholderMode } from '../spec/Placeholder'

export default function DiagnoseRoute() {
  return (
    <PlaceholderMode
      modeId="diagnose"
      modeNumber="2.4"
      modeName="Diagnose"
      question="Why is the rec what it is?"
      anchorPatternName="Recommendation.WhyThisRec"
      intro={
        <>
          <Text>
            Diagnose explains the model's reasoning in <strong>narrative</strong>, not DAGs. The
            anchor pattern is <code>Recommendation.WhyThisRec</code> — a structured paragraph
            naming the dominant drivers, what would flip the rec, and what changed since last cycle.
          </Text>
          <Text mt={3}>
            Frontline managers don't read shadow-price tables for fun. They want to verify the
            model's claim, identify which input matters most, and feel confident the model isn't
            hallucinating. Patterns here serve that — not analyst deep-dive.
          </Text>
          <Text mt={3}>
            <strong>What this mode does NOT cover:</strong> raw causal DAGs, LP duality, or
            constraint-binding analysis (those belong in analyst tools).
          </Text>
        </>
      }
      patterns={[
        {
          anchor: '2.4.1', name: 'Recommendation.WhyThisRec', family: 'Recommendation.*', isAnchor: true,
          purpose: 'Narrative explanation: "this rec is driven primarily by [factor], with [factor 2] secondary. If [factor] were [different], we\'d recommend [other]." Standalone deep-dive for users who want more than the Briefing\'s 3 because-bullets.',
        },
        {
          anchor: '2.4.2', name: 'DriverList',
          purpose: 'Top-N contributing factors: label · observed-vs-expected · contribution bar · %. Direction-coloured. Used as evidence supporting the WhyThisRec claim, not as a standalone analytical view.',
        },
        {
          anchor: '2.4.3', name: 'ChangedSinceLastTime',
          purpose: 'When the rec is different from last week\'s, this surfaces what changed in the inputs. "Forecast +14%, weather -2°C, no other material change."',
        },
        {
          anchor: '2.4.4', name: 'DeltaBreakdown', isRecipe: true,
          purpose: 'Recipe (not pattern): Table with current/baseline/Δ/Δ%/narrative columns. Total row tinted. Used for period-over-period decomposition.',
        },
      ]}
    />
  )
}
