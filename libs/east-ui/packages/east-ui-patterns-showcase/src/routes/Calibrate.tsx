import { Text } from '@chakra-ui/react'
import { PlaceholderMode } from '../spec/Placeholder'

export default function CalibrateRoute() {
  return (
    <PlaceholderMode
      modeId="calibrate"
      modeNumber="2.6"
      modeName="Calibrate"
      question="Was my judgement right? Was the model's? Where do I add value?"
      anchorPatternName="Track.Scorecard"
      intro={
        <>
          <Text>
            Calibrate is about <strong>the user's track record</strong>, not just the model's.
            Where did <em>they</em> add value? Where did they over-trust? Which kinds of recs
            should they trust more vs less? The anchor pattern is <code>Track.Scorecard</code>.
          </Text>
          <Text mt={3}>
            Most Calibrate literature is built for the model side: residual plots, calibration
            curves, accuracy stats. We have those, but we frame them as <em>tiles within the user's
            scorecard</em>, not the headline. The user is the protagonist; the model is one
            instrument they wield.
          </Text>
          <Text mt={3}>
            <strong>Compounds over time.</strong> A frontline manager with a clear scorecard knows
            where to trust their gut and where to defer. That's the most underused
            decision-quality lever in the platform.
          </Text>
        </>
      }
      patterns={[
        {
          anchor: '2.6.1', name: 'Track.Scorecard', family: 'Track.*', isAnchor: true,
          purpose: 'The user\'s accept/override rate, right rate, where they outperform vs underperform the model. Headline pattern. Renders OutcomeScorecard + ActualVsPredictedChart as tiles, plus user-side aggregates.',
        },
        {
          anchor: '2.6.2', name: 'Track.Lesson', family: 'Track.*',
          purpose: 'Surfaced inline when the type of decision has been wrong for the user before. "Last time you saw a rec like this, it was wrong because [reason]."',
        },
        {
          anchor: '2.6.3', name: 'Track.ModelLimits', family: 'Track.*',
          purpose: 'When has the model been worst, and why. Timeline of clusters of past errors, click to filter the queue to similar cases.',
        },
        {
          anchor: '2.6.4', name: 'Track.Annotate', family: 'Track.*',
          purpose: 'Let the user (or auditor) tag a past decision with what actually happened. "As expected / slightly off / off by a lot" + optional note. Feeds the loop.',
        },
        {
          anchor: '2.6.5', name: 'Track.Retrain', family: 'Track.*',
          purpose: 'When calibration drifts, surface a "flag for retraining" affordance. Closes the prescriptive loop. Flag-not-action; humans approve actual retrain.',
        },
        {
          anchor: '2.6.6', name: 'OutcomeScorecard',
          purpose: 'Recent-window summary of model performance: hit-rate / MAE / MAPE / RMSE + trend pill + sample size. Tile within Track.Scorecard.',
        },
        {
          anchor: '2.6.7', name: 'ActualVsPredictedChart',
          purpose: 'Scatter or time-series of predicted vs observed. Click a point to see the originating decision and who made it. Tile within Track.Scorecard.',
        },
        {
          anchor: '2.6.8', name: 'CalibrationCurve',
          purpose: '"When the model says 80% confident, is it actually right 80% of the time?" Reliability diagram. Analyst-facing; tile within Track.Scorecard.',
        },
      ]}
    />
  )
}
