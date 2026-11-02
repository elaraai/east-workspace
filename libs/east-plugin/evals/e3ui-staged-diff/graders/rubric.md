---
type: llm
focus:
  source: file
  path: "src/index.tsx"
weight: 2
---
The limits are bound with Data.bind(limits, { mode: "staged" }) inside a <Reactive> block; the controls write the edited struct through the binding; Apply calls the binding's commit() and Discard its discard(); and the review is e3-ui's <Diff bindings={[binding.binding]} />. Pending changes are not hand-tracked in separate state.
