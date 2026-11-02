---
type: llm
focus:
  source: file
  path: "src/view.tsx"
weight: 1
---
The file builds the UI with east-ui JSX tags. The three KPI tiles are Stat components laid out side by side in a horizontal row above the table, each given its raw number with a format spec (Format.Currency with currency AUD for Revenue, a percent format for Margin) rather than a pre-formatted string. The table's revenue column carries an AUD currency format and its change column a percent format, on raw fractional numbers (0.031, -0.012, ...).
