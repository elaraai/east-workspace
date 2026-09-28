/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Each live example's IR, built once.
 *
 * `<EastFunction>` keeps what it compiled by IR identity, so a row the doc
 * list remounts as it scrolls renders its example in the first paint, at the
 * size it had. A fresh IR per mount compiles again behind a skeleton, and
 * the virtualized doc list then chases the size change: it scrolls to hold
 * the rows below still, which remounts the row again.
 *
 * @packageDocumentation
 */

import type { EastFunctionProps } from "@elaraai/east-ui-components";
import type { LiveEntry } from "../catalog";

const irByExample = new WeakMap<LiveEntry, EastFunctionProps["ir"]>();

/**
 * The example's IR, the same object on every call.
 *
 * @param entry - A live catalog entry
 * @returns Its function's IR, built on first use
 */
export function exampleIr(entry: LiveEntry): EastFunctionProps["ir"] {
    let ir = irByExample.get(entry);
    if (ir === undefined) {
        /* `ExampleDef.fn`'s return type is erased to `EastType` at the package
         * boundary (to keep downstream `.d.ts` small); `<EastFunction>` needs
         * the precise `EastIR<[], UIComponentType>`. The cast narrows it back —
         * every live example in the showcase is a UI component by construction. */
        ir = entry.fn.toIR() as EastFunctionProps["ir"];
        irByExample.set(entry, ir);
    }
    return ir;
}
