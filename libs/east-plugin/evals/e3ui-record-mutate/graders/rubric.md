---
type: llm
focus:
  source: file
  path: "src/index.tsx"
weight: 2
---
The record is one e3.record with a `receive` mutation written with mutation.edit (touching one entry through edit.set), not a reduce over the whole dict. The UI task binds it with Record.bind(stock, ["receive"]) inside a <Reactive> block; the button's onClick calls mutate.receive("pear", 3n); the total is computed from the bound record's read(); and the status shown comes from mutate.status() (with pending() or error() where used).
