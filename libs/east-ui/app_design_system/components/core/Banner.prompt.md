Inline notice band for guardrails, staleness, partial data, pending changes, and errors.

```jsx
<Banner kind="guard" title="Outside guardrail.">Utilisation exceeds 92% in week 3.</Banner>
<Banner kind="stale">Snapshot from 06:40 — run refresh for live figures.</Banner>
<Banner kind="change" title="4 staged changes" actions={<Button variant="primary" compact>Apply</Button>} />
```

`stale` renders dashed (ephemeral convention). Keep washes subtle; never stack more than one banner per surface region.
