/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Studio's tile tests draw a page with (#1670, #1673), on e3 itself:
 * a source of the tile tests' own three orders, deployed with the Studio's
 * tiles examples (`tiles.examples.tsx`); a page of placements over it, mounted
 * as the showcase mounts the tiles' example; and the reader's filters of the
 * page set as its rail sets them — for the tests of a tile, of a page's
 * clicks and of a filter's conditions. A file that draws with them calls
 * {@link tileHarness} once, at its top.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { encodeBeast2For } from "@elaraai/east/internal";
import { StudioFiltersType, studioFiltersKey, type StudioCellType, type StudioKeyType, type StudioSourceType } from "@elaraai/e3-ui/internal";
import * as studio from "@elaraai/e3-ui/examples/studio/studio";
import * as tiles from "@elaraai/e3-ui/examples/studio/tiles";
import { StateRuntime, system } from "@elaraai/east-ui-components";
import { act, currentHarness, e3Harness, type E3Harness, type MountOptions } from "../e3-web-mount.test-utils.js";
import { condition } from "../query/visual/visual.test-utils.js";
import { StudioLayout } from "./page.js";

/**
 * The file's e3: the Studio's tiles examples deployed — the tile tests' own
 * data among them — with the Studio examples' orders the tiles' example
 * reads, a workspace of its own each test.
 *
 * @returns The harness
 */
export function tileHarness(): E3Harness {
    return e3Harness({ "studio/studio": studio, "studio/tiles": tiles }, { measure: false });
}

/** The tile tests' three orders, as a page lists them. */
export const SOURCE: ValueTypeOf<typeof StudioSourceType> = {
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", tiles.tileTestOrders.path), type: toEastTypeValue(tiles.tileTestOrders.type) },
    fields: [], range: some("ordered_at"),
};

/** The page the tiles are of. */
export const PAGE = { project: "Sales desk", page: "Orders" };
const encodeFilters = encodeBeast2For(StudioFiltersType);
/** Sets the reader's filters of the page, as its rail does: in the UI store, under the page's key. */
export async function filterPage(...conditions: string[]) {
    await act(async () => {
        StateRuntime.getStore().write(studioFiltersKey(PAGE), conditions.length === 0 ? undefined : encodeFilters(conditions.map((where) => ({ source: "orders", where: condition(where), from: none }))));
    });
}

/** A placement holding content. */
export function cell(key: string, content: ValueTypeOf<typeof StudioCellType>["content"]): ValueTypeOf<typeof StudioCellType> {
    return { key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content };
}

/**
 * Mounts what a page draws on e3, as the showcase mounts an example — the
 * test's workspace, its calls, its sources' status read from it — and settles
 * once it has rendered.
 *
 * @param view - What the page draws
 * @param host - What the host holds the page in, inside e3's providers: its own `E3Provider`, say
 * @returns What Testing Library rendered
 */
export function onE3(view: ReactNode, host?: MountOptions["host"]): Promise<RenderResult> {
    return currentHarness().mount(tiles.studioKpiSizes, { view, ...(host === undefined ? {} : { host }) });
}

/** A page of placements over the sources — the orders unless given — on e3, and who it tells a click opens another page. */
export function page(
    cells: ValueTypeOf<typeof StudioCellType>[], sources: ValueTypeOf<typeof StudioSourceType>[] = [SOURCE],
    onOpen?: (page: ValueTypeOf<typeof StudioKeyType>) => void,
): Promise<RenderResult> {
    return onE3(<StudioLayout cells={cells} components={[]} sources={sources} page={PAGE} storageKey="tile" onOpen={onOpen} />);
}

/** A page of placements drawn with no server to ask: in the theme alone, no calls at all. */
export function pageWithoutServer(cells: ValueTypeOf<typeof StudioCellType>[]): RenderResult {
    return render(<ChakraProvider value={system}><StudioLayout cells={cells} components={[]} sources={[SOURCE]} page={PAGE} storageKey="tile" /></ChakraProvider>);
}

/**
 * Runs a test with every element laid out 1200 × 600: a Table or a Matrix
 * virtualises its rows, drawing those its box has room for, which jsdom lays
 * out at 0.
 */
export async function sized(run: () => Promise<void>) {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1200 });
    try {
        await run();
    } finally {
        if (height !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
        if (width !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    }
}
