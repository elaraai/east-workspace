---
type: llm
focus:
  source: file
  path: "src/view.tsx"
weight: 2
---
The component re-renders on its own state: the select and the table are returned from a <Reactive>{$ => ...}</Reactive> block, the selection is held by State.bind with a string key and the default "All", the Select's items are the four categories and its onChange writes the bound state, and inside the reactive block the table's data is the six products filtered by the state's read() — every product when it is All, else those whose category equals it. The filtering is an East expression, not TypeScript evaluated once at build time; building the Select's fixed items in TypeScript (a .map over the four names) is fine.
