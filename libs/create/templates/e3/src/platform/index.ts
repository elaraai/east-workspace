// Barrel for the project's TS-East platform functions (run on the east-node
// runtime). This module IS the package's `./platform` subpath export — its
// default export is the PlatformFunction[] that east-node-cli loads.
//
// To add a function: create a sibling file (e.g. ./discount.ts) exporting its
// declaration + `<name>Impl`, then add one re-export line and one array entry
// below.
import { exampleNodeImpl } from "./example.js";

// Re-export each declaration so e3 tasks (src/index.ts) can call them.
export { exampleNode } from "./example.js";

// The PlatformFunction[] the east-node runner loads via `./platform`.
export default [exampleNodeImpl];
