/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan canvas's rail on e3 itself (#1344, #1376): its one
 * `Slice.bindRecords` over the Plan's records as e3 serves them
 * (`plan/plan-records`) — each source a record narrowed through its indexes,
 * what it counts and its range's extent read from e3 — and the chrome over
 * it, as a Plan's root carries it. A file whose canvases narrow through a rail
 * deploys {@link RAIL_MODULES} with its harness, and binds each rail with
 * {@link bindRail}, which first installs the runtimes the rail reads through
 * over the test's workspace, as a mounted Plan's providers do. The canvas's
 * rows stay the test's own: inline, or a paged source it builds.
 *
 * @packageDocumentation
 */

import { East, StringType, equalFor, type SubtypeExprOrValue, type ValueTypeOf } from "@elaraai/east";
import {
    RecordSlicesChromeType, recordSlicesChrome, type RecordSliceAffordance, type RecordSliceBindType, type RecordSlicesBindType,
} from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import { currentHarness } from "../e3-web-mount.test-utils.js";

/** The e3-ui example module a canvas's rail reads: a file's harness deploys it. */
export const RAIL_MODULES = { "plan/plan-records": records } as const;

/** The rail's chrome, as a Plan's root carries it. */
export type RailChrome = ValueTypeOf<RecordSlicesChromeType>;
/** One source's part of the rail: its controls. */
export type RailPart = ValueTypeOf<RecordSliceBindType>;

/** A rail bound over e3, and what a test reads of it. */
export interface Rail {
    /** Its chrome, as a Plan's root carries it: `slice: some(rail.chrome)`. */
    readonly chrome: RailChrome;
    /**
     * A source's part, by its name.
     *
     * @param source - The source's name (`rows`)
     * @returns Its part
     * @throws {Error} When the rail has no source of that name
     */
    part(source: string): RailPart;
    /**
     * How many times a source's state has been written since the rail was
     * bound: each write a window, a choice or a resolution, and each window or
     * choice a new narrowing of its record.
     *
     * @param source - The source's name
     * @returns The writes
     */
    writes(source: string): number;
}

const stringEqual = equalFor(StringType);

/**
 * Binds a rail over e3: installs the runtimes its sources read through over
 * the test's workspace, as a mounted Plan's providers do, and evaluates its
 * chrome. A test binds one rail.
 *
 * @param slice - The rail's one `Slice.bindRecords`, as a Plan's author binds it: each source `Data.bindPaged` over one of the Plan's records (`plan/plan-records`), with the indexes its fields need
 * @param affordances - The controls it offers
 * @returns The rail
 */
export async function bindRail(slice: () => SubtypeExprOrValue<RecordSlicesBindType>, affordances: readonly RecordSliceAffordance[]): Promise<Rail> {
    const fn = East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({ slice: slice(), affordances })));
    await currentHarness().install({ fn });
    const chrome = East.compile(fn, getRegisteredPlatformImplementations())();
    const part = (source: string): RailPart => {
        const found = chrome.slice.parts.find((p) => stringEqual(p.source, source));
        if (found === undefined) throw new Error(`the rail has no source ${source}`);
        return found.slice;
    };
    // Each source's state as the rail was bound: what its writes are counted from.
    const bound = new Map(chrome.slice.parts.map((p) => [p.source, getStore().getKeyVersion(p.slice.key)] as const));
    return { chrome, part, writes: (source) => getStore().getKeyVersion(part(source).key) - (bound.get(source) ?? 0) };
}
