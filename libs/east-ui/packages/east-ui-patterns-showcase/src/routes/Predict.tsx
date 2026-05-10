import { Text } from '@chakra-ui/react'
import { PlaceholderMode } from '../spec/Placeholder'

export default function PredictRoute() {
  return (
    <PlaceholderMode
      modeId="predict"
      modeNumber="2.2"
      modeName="Predict"
      question="If I act vs do nothing — what changes?"
      anchorPatternName="Predict.BaselineVsAction"
      intro={
        <>
          <Text>
            Predict is the <strong>decision-relevant</strong> view of the model's forecast. The
            anchor pattern is <code>Predict.BaselineVsAction</code> — two trajectories on one chart
            (do nothing vs follow the rec) with the gap labelled as the value of acting.
          </Text>
          <Text mt={3}>
            Forecasts as decision inputs, not pretty curves. A frontline manager doesn't need to
            audit p10/p90 envelopes; they need to know <em>"if I do this, here's where we land vs
            if I don't"</em>. Other Predict patterns layer in robustness across plausible futures,
            outcome-range framing in business language, and uncertainty calibration.
          </Text>
          <Text mt={3}>
            <strong>What this mode does NOT cover:</strong> raw timeseries dashboards (those belong
            in analyst tools, not the decision-maker's surface), or modelling internals.
          </Text>
        </>
      }
      patterns={[
        {
          anchor: '2.2.1', name: 'Predict.BaselineVsAction', family: 'Predict.*', isAnchor: true,
          purpose: 'Two trajectories overlaid: do nothing vs follow the rec. Gap labelled as "value of acting" in the user\'s currency. Replaces ProjectionToTarget as the Predict headline.',
        },
        {
          anchor: '2.2.2', name: 'Predict.OutcomeRange', family: 'Predict.*',
          purpose: '"Likely $1.9–2.0M; plausible $1.7–2.2M; extreme $1.5–2.4M" in business language, not p-values. The user-friendly version of a confidence band.',
        },
        {
          anchor: '2.2.3', name: 'Predict.ScenarioReadiness', family: 'Predict.*',
          purpose: '"The rec stays good across 4 of 5 plausible scenarios" — flags the scenario where it breaks down. Robustness, not point estimate.',
        },
        {
          anchor: '2.2.4', name: 'UncertaintyBadge',
          purpose: '"82% conf." / "± 6h" / "p < 0.05". With optional historicalAccuracy: hover reveals "model was right 87% on 241 comparable cases in 90d". Inline chip used inside Briefings.',
        },
        {
          anchor: '2.2.5', name: 'ForecastView',
          purpose: 'Observed history + forecast band + p10/p90 envelope on a shared time axis. Used as deep-dive surface (not the headline — BaselineVsAction is). Lives here for analytical consumers.',
        },
        {
          anchor: '2.2.6', name: 'ProjectionToTarget',
          purpose: 'Trajectory vs committed target with surplus/shortfall shading. Companion to BaselineVsAction when the user has an explicit target.',
        },
      ]}
    />
  )
}
