/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Browser-safe slice of `@elaraai/e3` for the snapshot harness.
 *
 * The full `@elaraai/e3` entry pulls in yazl (→ node `stream`/`events`/
 * `util`), which Vite externalizes and breaks in the browser. The example
 * files only need `e3.input(...)` + the `DatasetDef` type, both of which
 * are pure. The snapshot vite config aliases `@elaraai/e3` to this module
 * (scoped to the harness — the Node-side showcase emitter is unaffected).
 *
 * @packageDocumentation
 */

export { input } from '../../../../e3/packages/e3/src/input.ts';
export type { DatasetDef } from '../../../../e3/packages/e3/src/types.ts';
