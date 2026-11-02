---
type: llm
focus:
  source: file
  path: "src/index.tsx"
weight: 1
---
The UI task is declared with e3-ui's ui() and reads the price through Data.bind(price) inside a <Reactive>{$ => ...}</Reactive> block, in direct mode — the default, so no `mode` option at all is right. The slider's value is the binding's read() and its onChange writes through the binding. The stat's value is computed in East from read() (times 1.1), not a constant.
