---
type: llm
focus:
  source: file
  path: "src/index.tsx"
weight: 1
---
The UI task renders e3-ui's <Plan> with a time axis (Plan.axis) over the week, the machines as rows through Schedule.resources and the jobs as an event kind through Schedule.events over Record.bind(jobs), naming the title, start and end fields and the machine as the resource field of the machines kind; the jobs record declares a patch mutation for the Plan to save through.
