Bordered token chip for filters, applied selections, and small removable facts.

```jsx
<Chip>Region: APAC <span className="num">14</span></Chip>
<Chip variant="brand" onDismiss={fn}>Scenario B</Chip>
<Chip variant="dashed">unassigned</Chip>
<Chip caret>Last 30 days</Chip>
```

`brand` marks active/selected state (the only tinted background the system permits). `dashed` means ephemeral/partial per the dashed-hairline convention. Numerals inside chips use `className="num"`.
