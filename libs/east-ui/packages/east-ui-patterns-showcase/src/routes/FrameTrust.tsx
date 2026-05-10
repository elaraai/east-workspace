import { Text } from '@chakra-ui/react'
import { PlaceholderMode } from '../spec/Placeholder'

export default function FrameTrustRoute() {
  return (
    <PlaceholderMode
      modeId="frame-trust"
      modeNumber="2.8"
      modeName="Frame & trust"
      question="Should I trust this; can I defend my decision later?"
      anchorPatternName="Trust.Stamp + Decision.Journal"
      intro={
        <>
          <Text>
            Frame &amp; trust is the chrome that makes the rest of the system credible:
            navigation header, freshness indicators, provenance / lineage trails, audit logs,
            permission gates, and the user's own decision journal. <strong>Two anchor
            patterns</strong> here: <code>Trust.Stamp</code> (inline freshness + version chip) and
            <code> Decision.Journal</code> (the user's record in their own voice).
          </Text>
          <Text mt={3}>
            Several patterns here are recipes / specialisations rather than standalone — Banner.*
            is one primitive with named recipes (stale data, partial results, change since last
            visit, guardrails). Trust.* is one chip family at four densities (chip → stamp →
            footer → trail).
          </Text>
        </>
      }
      patterns={[
        {
          anchor: '2.8.1', name: 'Header',
          purpose: 'Breadcrumb + title + meta + actions. level: section | subsection (no "page" — host owns that).',
        },
        {
          anchor: '2.8.2', name: 'Trust.Chip', family: 'Trust.*',
          purpose: 'Coloured dot + label + optional pulse + timestamp. state: ok | running | dirty | error.',
        },
        {
          anchor: '2.8.3', name: 'Trust.Stamp', family: 'Trust.*', isAnchor: true,
          purpose: 'Inline "model v3.4 · updated 2m ago" chip with hover-card detail. Anchor for inline trust signalling.',
        },
        {
          anchor: '2.8.4', name: 'Trust.Footer', family: 'Trust.*',
          purpose: 'Long-form footer: model version + per-source freshness with latency pills + audit / lineage / methodology links.',
        },
        {
          anchor: '2.8.5', name: 'Trust.Trail', family: 'Trust.*',
          purpose: 'Horizontal/vertical chain: [source] → [transform] → [model] → [output]. Per-node issue tint (stale / missing / error).',
        },
        {
          anchor: '2.8.6', name: 'Banner.Stale', family: 'Banner.*',
          purpose: 'Region-top warning when ageMs > threshold. Optional autoRefreshAt countdown pill.',
        },
        {
          anchor: '2.8.7', name: 'Banner.ChangeSinceLastVisit', family: 'Banner.*',
          purpose: '"3 changes since you last visited" strip. Diffs current state against a checkpoint.',
        },
        {
          anchor: '2.8.8', name: 'Banner.Guardrail', family: 'Banner.*',
          purpose: 'Structured warning. severity: info | warning | danger. Optional blockCommit disables the parent\'s submit.',
        },
        {
          anchor: '2.8.9', name: 'AuditTrail',
          purpose: 'Timeline of committed patches. onRevert synthesises the inverse via East.invertPatch — no separate undo state. Composable for "what changed in this window" diffs.',
        },
        {
          anchor: '2.8.10', name: 'Decision.Journal', family: 'Decision.*', isAnchor: true,
          purpose: 'The user\'s record of decisions in their own voice. "Approved Cho shift swap. Going with model — Patel hours legitimate concern." Distinct from AuditTrail (system record).',
        },
        {
          anchor: '2.8.11', name: 'PermissionGate',
          purpose: 'View-rights gate. PermissionGate({ has, fallback?, children }) + AccessDeniedState canonical fallback.',
        },
        {
          anchor: '2.8.12', name: 'CommitApproval',
          purpose: 'Threshold-gated commit-rights flow. Approvers see the DiffView before signing. Emits onAllApproved(patch) when the gate clears.',
        },
        {
          anchor: '2.8.13', name: 'ComputeError',
          purpose: 'Solver / data / unknown failure surface. Structured summary + inputRef + logsLink + retry.',
        },
        {
          anchor: '2.8.14', name: 'KeyboardShortcutsOverlay',
          purpose: '⌘/ or ? modal of shortcuts grouped by area. Search filters as you type.',
        },
        {
          anchor: '2.8.15', name: 'Communicate.Message', family: 'Communicate.*',
          purpose: 'Compose decision message (rec + rationale + approve link) directly to boss / team / customer.',
        },
        {
          anchor: '2.8.16', name: 'Communicate.Handoff', family: 'Communicate.*',
          purpose: 'Surfaces the work that someone else now has to do as a result of the user\'s decision.',
        },
      ]}
    />
  )
}
