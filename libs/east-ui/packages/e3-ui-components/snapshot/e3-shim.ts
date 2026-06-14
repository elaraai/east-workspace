/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Browser-safe slice of `@elaraai/e3` for the snapshot harness.
 *
 * The full `@elaraai/e3` entry pulls in yazl (→ node `stream`/`events`/
 * `util`), which Vite externalizes and breaks in the browser. The example
 * files only need `e3.input(...)` / `e3.function(...)` + def types — but the
 * public `@elaraai/e3-ui` entry re-exports `ui()`, which imports `task`, so
 * the shim must carry `task` too for the bundle to resolve. All are pure.
 * The snapshot vite config aliases `@elaraai/e3` to this module (scoped to
 * the harness — the Node-side showcase emitter is unaffected).
 *
 * Mirrors the real package's surface: named exports AND the `e3` default
 * object, so examples written as `import e3 from '@elaraai/e3'`
 * (`e3.function(...)`, the documented surface) bundle unchanged.
 *
 * @packageDocumentation
 */

import { input } from '../../../../e3/packages/e3/src/input.ts';
import { task } from '../../../../e3/packages/e3/src/task.ts';
import { function_ } from '../../../../e3/packages/e3/src/function.ts';
import { record } from '../../../../e3/packages/e3/src/record.ts';
import { mutation } from '../../../../e3/packages/e3/src/mutation.ts';

export { input, task, record, mutation };
export { function_ };
export type { DatasetDef, FunctionDef, RecordDef, MutationDef } from '../../../../e3/packages/e3/src/types.ts';

/** Default-export surface, matching `@elaraai/e3`'s `e3` object for the
 *  members the browser harness can support. `record` / `mutation` are pure
 *  (they only touch `@elaraai/east`), so the `Record.bind` examples bundle. */
const e3 = {
    input,
    task,
    function: function_,
    record,
    mutation,
} as const;

export default e3;
