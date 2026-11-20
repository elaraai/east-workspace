/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase's page of every form a Studio visual draws (#1671), opened for
 * the specs that measure it: its KPIs, its seven charts, its list and its
 * three tables, each answered by e3 in the page. A spec writes a page of its
 * own over it as another session's publish would — tiles in the
 * configurations it reads, or the page's own with two tiles after them that
 * cannot draw: a chart with no value yet, and a KPI of a field its source
 * lacks. The showcase's page holds neither.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { PatchType, SortedMap, compareFor, diffFor, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import * as studio from "@elaraai/e3-ui/examples/studio/studio";
import { installE3Faults, mutateE3 } from "./e3-faults";
import { settled } from "./settle";

/** A theme the page is read in. */
export type Mode = "light" | "dark";
/** Both themes. */
export const MODES = ["light", "dark"] as const satisfies readonly Mode[];

/** The showcase's page of visuals. */
export const HASH = "e3/studio/studio/studioVisuals";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
/** A Studio page: its title, its placements and its starting filters. */
export type StudioPage = ValueTypeOf<typeof Studio.Types.Page>;
/** A page's placements. */
export type Cells = StudioPage["cells"];

/** How many forms the page draws: two KPIs, seven charts, a list and three tables. */
const FORMS = 13;

/** What a drawn form is: a chart, a KPI, a list, a summary, a pivot, or records answered. */
const DRAWN = "[data-studio-chart], [data-studio-kpi], [data-studio-list], [data-studio-summary], [data-studio-pivot], [data-studio-records='']";

const vis = Studio.visual;

/** Two tiles that cannot draw, on a row of their own: a chart with no value yet, and a KPI of a field its source lacks. */
const CANNOT_DRAW: Cells = [
    { key: "v-empty", row: "r7", span: 6n, height: none, align: variant("stretch", null), title: none, content: vis.of("orders", vis.column({ x: vis.group("region"), values: [] })) },
    { key: "v-missing", row: "r7", span: 6n, height: none, align: variant("stretch", null), title: none, content: vis.of("orders", vis.kpi({ value: vis.sum("net_revenue") })) },
];

/** What each of them says in its place: the wells it needs, and the field its source lacks. */
const SAID = "[data-studio-visual=empty], [data-studio-visual=missing]";

/**
 * Writes a page over the page of visuals, as another session's publish would:
 * its draft and its live version, through its pages record's patch. The page's
 * e3 hook is installed before it loads (`installE3Faults`).
 *
 * @param page - The browser's page
 * @param write - The page written, from the page of visuals as it is seeded
 */
export async function writeVisuals(page: Page, write: (seeded: StudioPage) => StudioPage): Promise<void> {
    const { type, name, default: seeded } = studio.studioVisualPages;
    if (seeded === undefined) throw new Error("the visuals' pages are seeded");
    const before = new SortedMap<Key, Entry>(seeded, compareFor(Studio.Types.Key));
    const after = new SortedMap<Key, Entry>([...before].map(([key, entry]): [Key, Entry] => {
        if (entry.type !== "page") return [key, entry];
        const written = write(entry.value.draft);
        return [key, variant("page", { draft: written, live: some({ version: 2n, page: written }) })];
    }), compareFor(Studio.Types.Key));
    await mutateE3(page, "studio", name, "patch", [encodeBeast2For(PatchType(type))(diffFor(type)(before, after))]);
}

/**
 * Opens the page of visuals in a theme, every form drawn, at rest — and, where
 * a spec asks, the two tiles that cannot draw after its own, each saying why.
 *
 * @param page - The browser's page
 * @param mode - The theme
 * @param options - `cannotDraw`: the two tiles that cannot draw written after the page's own
 * @returns The page's grid
 */
export async function openVisuals(page: Page, mode: Mode, { cannotDraw = false }: { cannotDraw?: boolean } = {}): Promise<Locator> {
    if (cannotDraw) await installE3Faults(page);
    await page.goto(`/?theme=${mode}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 20_000 });
    if (cannotDraw) {
        await writeVisuals(page, (seeded) => ({ ...seeded, cells: [...seeded.cells, ...CANNOT_DRAW] }));
        await expect.poll(() => grid.evaluate((root, said) => root.querySelectorAll(said).length, SAID), { timeout: 60_000 }).toBe(CANNOT_DRAW.length);
    }
    // e3 in the page answers each visual's programs: every form drawn.
    await expect.poll(() => grid.evaluate((root, drawn) => root.querySelectorAll(drawn).length, DRAWN), { timeout: 60_000 }).toBe(FORMS);
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), `the page is in ${mode}`).toBe(mode === "dark");
    return grid;
}
