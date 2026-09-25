/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's geometry, measured in a real browser (#817): every body item —
 * row, group band, rail, gap band — renders at exactly the height the model
 * laid it out at (`rowHeight`, which each item carries as `data-plan-h`), for
 * every row kind the Plan examples draw, at each density, with chart rows at
 * rest and expanded, and under both row focuses (R1 rails and gap bands, R2
 * context strips and the grown focal row).
 *
 * The model and the recipe read ONE geometry table — the model directly, the
 * recipe through the CSS variables the canvas writes — so a mismatch here
 * means they parted: the paging ledger's "band px == rendered px" invariant
 * rests on this.
 *
 * Every measurement is polled until it holds, on a page at rest, never read
 * once after a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-geometry --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { printFor, variant } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { settled } from "./settle";

/** A row's element. `data-plan-row` holds the row's id as its canonical text
 *  (#822) — printed by East, so the selector is the id the example builds. */
const printId = printFor(Plan.Types.RowId);
const rowSel = (series: string, ...path: string[]) =>
    `[data-plan-row=${JSON.stringify(printId(variant("entry", { series, path }) as Parameters<typeof printId>[0]))}]`;

/** The Plan examples, between them every row kind, group strips, pinned
 *  rows, number and ordinal axes. */
const EXAMPLES = [
    "planTargetState", "planSpanRows", "planBucketRows", "planChartRows", "planHeatRows", "planTableRows",
    "planCardRows", "planEventRows", "planGroupedRows", "planSeriesData", "planLiteralRows", "planReview",
    "planExpand", "planNumberAxis", "planOrdinalAxis",
];

/** Open one example's page and return its entry (the virtualized doc row
 *  holding its anchor and its live canvas) — a Plan example unless another
 *  examples file is named. */
async function openExample(page: Page, name: string, file = "collections/plan"): Promise<Locator> {
    await page.goto(`/#${file}/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${file}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-plan-body]").first()).toBeVisible({ timeout: 20_000 });
    // Charts and collections measure their containers before they settle.
    await settled(page);
    return entry;
}

/** Every body item whose rendered height is not the model's. */
async function mismatches(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => [...root.querySelectorAll("[data-plan-h]")].flatMap((el) => {
        const model = Number(el.getAttribute("data-plan-h"));
        const rendered = el.getBoundingClientRect().height;
        if (Math.abs(model - rendered) <= 0.5) return [];
        const name = el.getAttribute("data-plan-row") ?? el.getAttribute("data-plan-group")
            ?? el.getAttribute("data-plan-rail") ?? `gap ${el.getAttribute("data-plan-gap")}`;
        return [`${name}: model ${model}px, rendered ${rendered}px`];
    }));
}

/** How many body items the entry measures. */
const measured = (entry: Locator) => entry.locator("[data-plan-h]").count();

/** Every row kind the Plan draws. */
const KINDS = ["buckets", "cards", "chart", "events", "heat", "span", "table"];

/** The row kinds among the entry's measured rows. */
async function kindsMeasured(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => [...new Set(
        [...root.querySelectorAll("[data-plan-h][data-plan-kind]")].map((el) => el.getAttribute("data-plan-kind") ?? ""),
    )].sort());
}

test.describe("Plan geometry (#817)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const name of EXAMPLES) {
        test(`${name}: every body item renders at its model height`, async ({ page }) => {
            const entry = await openExample(page, name);
            await expect.poll(() => measured(entry)).toBeGreaterThan(0);
            await expect.poll(() => mismatches(entry)).toEqual([]);
        });
    }

    test("chart rows hold at rest and expanded", async ({ page }) => {
        const entry = await openExample(page, "planChartRows");
        const spark = entry.locator(rowSel("spark", "spark"));
        const rest = Number(await spark.getAttribute("data-plan-h"));
        // The expandable spark's gutter is its toggle.
        await spark.locator("> :first-child").click();
        await expect(spark).not.toHaveAttribute("data-plan-h", String(rest));
        await expect.poll(() => mismatches(entry), "expanded").toEqual([]);
        await spark.locator("> :first-child").click();
        await expect(spark).toHaveAttribute("data-plan-h", String(rest));
        await expect.poll(() => mismatches(entry), "at rest").toEqual([]);
    });

    test("every row kind holds at every density, its chart at rest and expanded", async ({ page }) => {
        // The configurator's canvas holds every row kind, and its density
        // control re-rhythms them all.
        const entry = await openExample(page, "planVariants");
        // The configurator's preview pane is phone-width, so the canvas lays
        // out as narrow cards (§10) — which have no rows. Widen the canvas
        // itself: it measures its own container, and lays out rows.
        await page.addStyleTag({ content: "[data-plan-body] { min-width: 960px; }" });
        await expect(entry.locator("[data-plan-row]").first()).toBeVisible();
        const chart = entry.locator('[data-plan-kind="chart"]');
        // The widened canvas overflows the pane on both sides, so the gutter
        // lies outside the pane's clip and a pointer there lands on the
        // controls beside it — the toggle is dispatched to the gutter itself.
        // (Layout boxes, which is all this measures, are not clipped.)
        const toggleChart = () => chart.locator("> :first-child").dispatchEvent("click");
        // A one-line span row — the shared row, which density sets.
        const spanRow = entry.locator(rowSel("mach", "m04"));
        const rowAt: Record<string, number> = {};
        for (const density of ["COMFORTABLE", "CONDENSED", "COMPACT"]) {
            await entry.getByText(density, { exact: true }).click();
            await expect(entry.getByRole("radio", { name: density })).toBeChecked();
            await expect.poll(() => kindsMeasured(entry), density).toEqual(KINDS);
            await expect.poll(() => mismatches(entry), density).toEqual([]);
            rowAt[density] = Number(await spanRow.getAttribute("data-plan-h"));
            // The spark's gutter is its toggle: the chart expanded, then back.
            const rest = await chart.getAttribute("data-plan-h") ?? "";
            await toggleChart();
            await expect(chart).not.toHaveAttribute("data-plan-h", rest);
            await expect.poll(() => mismatches(entry), `${density} · chart expanded`).toEqual([]);
            await toggleChart();
            await expect(chart).toHaveAttribute("data-plan-h", rest);
            await expect.poll(() => mismatches(entry), `${density} · chart at rest`).toEqual([]);
        }
        // The sweep reached the canvas: compact tightens the shared row, and
        // condensed keeps the default rhythm.
        expect(rowAt.COMPACT).toBeLessThan(rowAt.COMFORTABLE!);
        expect(rowAt.CONDENSED).toBe(rowAt.COMFORTABLE);
    });

    test("row focus holds — rails and gap bands (R1), context strips and the grown focal row (R2)", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await entry.locator('[data-plan-control="links"]').first().click();
        // Rails and gap bands are measured items too — they carry the model's height.
        await expect(entry.locator("[data-plan-rail][data-plan-h], [data-plan-gap][data-plan-h]").first()).toBeVisible();
        await expect.poll(() => mismatches(entry), "R1").toEqual([]);
        await entry.locator("[data-plan-focusback]").click();
        await entry.locator('[data-plan-control="expand"]').first().click();
        await expect(entry.locator("[data-plan-row][data-ctx][data-plan-h]").first()).toBeVisible();
        await expect(entry.locator("[data-plan-row][data-expanded][data-plan-h]")).toHaveCount(1);
        await expect.poll(() => mismatches(entry), "R2").toEqual([]);
    });
});

/**
 * The toolbar's segments, against the `Plan Spec v2.html` §1 mock's toolbar
 * (#632): the GROUP · RESOURCE strip rides between the search and the range,
 * the WEEK · DAY strip after the range, and both are the mock's `.seg` — a
 * 25px strip of 23px segments. The grain it picks re-lays the body, whose
 * strips must hold their model heights like every other item.
 */
test.describe("Plan toolbar segments (#632)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("the grain segment sits between the search and the range, both strips at the mock's size; GROUP re-lays the body at its model heights", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const toolbar = entry.locator("[data-slot='toolbar']");
        const grain = toolbar.locator("[data-plan-seg='grain']");
        const resolution = toolbar.locator("[data-plan-seg='resolution']");
        await expect(grain.getByRole("radio")).toHaveText(["GROUP", "RESOURCE"]);
        await expect(grain.getByRole("radio", { name: "RESOURCE" })).toBeChecked();
        const layout = () => toolbar.evaluate((bar) => {
            const box = (el: Element | null) => (el === null ? null : el.getBoundingClientRect());
            const grainEl = bar.querySelector("[data-plan-seg='grain']")!;
            const resolutionEl = bar.querySelector("[data-plan-seg='resolution']")!;
            const cluster = box(bar.querySelector("[data-slot='toolbarCluster']"));
            // The range pill is the cluster between the two strips.
            const range = box(grainEl.nextElementSibling);
            const g = box(grainEl)!;
            const r = box(resolutionEl)!;
            const heights = [...bar.querySelectorAll("[data-plan-seg]")].map((s) => ({
                strip: s.getBoundingClientRect().height,
                segments: [...s.querySelectorAll("[role='radio']")].map((b) => b.getBoundingClientRect().height),
            }));
            return {
                order: cluster !== null && range !== null
                    && cluster.right <= g.left && g.right <= range.left && range.right <= r.left,
                heights,
            };
        });
        await expect.poll(layout).toEqual({
            order: true,
            heights: [{ strip: 25, segments: [23, 23] }, { strip: 25, segments: [23, 23, 23] }],
        });
        await expect(resolution.getByRole("radio")).toHaveText(["MONTH", "WEEK", "DAY"]);

        await grain.getByRole("radio", { name: "GROUP" }).click();
        await expect(grain.getByRole("radio", { name: "GROUP" })).toBeChecked();
        await expect(entry.locator("[data-slot='ruler'] > :first-child")).toHaveText("GROUP");
        await expect(entry.locator("[data-plan-group][aria-expanded='false']").first()).toBeVisible();
        await expect.poll(() => mismatches(entry), "GROUP grain").toEqual([]);
    });
});

/**
 * The links-focus ribbons are laid out from the model (#818) — the body's own
 * heights, the geometry table's bars, the scale across the plot — and never
 * measured. Here, in a real layout, each must still meet the bars it joins.
 */
test.describe("Plan link ribbons (#818)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    /** planSpanRows' rows the links join — each its series and path. */
    const M07 = rowSel("flavours", "L1-M07");
    const M09 = rowSel("detail", "L1-M09");
    const M03 = rowSel("rollup", "Program A", "L1-M03");
    const M11 = rowSel("rollup", "Program A", "L2-M11");
    const DSP = rowSel("despatch", "dsp");
    /** planSpanRows' six links, in order: [from row, run, to row, run], each
     *  row by its selector. Every routing case is among them — forward, the
     *  loopbacks, a same-row feed, and a landing past the window (dsp's run
     *  starts where it ends). */
    const LINKS = [
        [M07, "run", M09, "a"], [M09, "a", M09, "b"], [M09, "b", M03, "b221"],
        [M03, "b214", M11, "b241"], [M11, "b241", M09, "b"], [M09, "b", DSP, "d1"],
    ];

    /** Focus L1-M09's links — every link above touches its family — and let
     *  the focused canvas come to rest. */
    async function focusLinks(page: Page): Promise<Locator> {
        const entry = await openExample(page, "planSpanRows");
        await entry.locator(`${M09} [data-plan-control="links"]`).click();
        await expect(entry.locator("[data-plan-ribbons] [data-plan-link]")).toHaveCount(LINKS.length);
        await settled(page);
        return entry;
    }

    test("every ribbon leaves its source run's end and lands on its destination's start, at the bars' centres", async ({ page }) => {
        const entry = await focusLinks(page);
        const misses = () => entry.evaluate((root, links) => {
            const svg = root.querySelector("[data-plan-ribbons] svg")!.getBoundingClientRect();
            const nums = (d: string) => d.split(/[\sMLAZ]+/).filter((s) => s !== "").map(Number);
            const out: string[] = [];
            const near = (what: string, got: number, want: number) => {
                if (Math.abs(got - want) > 0.25) out.push(`${what}: ${got.toFixed(2)} ≠ ${want.toFixed(2)}`);
            };
            for (const g of root.querySelectorAll("[data-plan-link]")) {
                const [fromRow, fromRun, toRow, toRun] = links[Number(g.getAttribute("data-plan-link"))]!;
                const band = nums(g.querySelector("[data-plan-ribbon-band]")!.getAttribute("d")!);
                const tip = nums(g.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")!).slice(2, 4);
                const src = root.querySelector(`${fromRow} [data-run="${fromRun}"]`)!.getBoundingClientRect();
                const dst = root.querySelector(`${toRow} [data-run="${toRun}"]`)!.getBoundingClientRect();
                // A run starting past the window lands on the plot's edge.
                const plot = root.querySelector(toRow!)!.children[1]!.getBoundingClientRect();
                const edge = `link ${g.getAttribute("data-plan-link")} (${fromRun} → ${toRun})`;
                near(`${edge} start x`, svg.left + band[0]!, src.right);
                near(`${edge} start y`, svg.top + band[1]!, src.top + src.height / 2);
                near(`${edge} tip x`, svg.left + tip[0]!, Math.min(dst.left, plot.right));
                near(`${edge} tip y`, svg.top + tip[1]!, dst.top + dst.height / 2);
            }
            return out;
        }, LINKS);
        await expect.poll(misses).toEqual([]);
        // The landing past the window reads as the runoff fade.
        await expect(entry.locator('[data-plan-linkfade="right"]')).toHaveCount(1);
    });

    test("a ribbon takes the pointer along its band — it lights, rings its runs, and its label is the tooltip", async ({ page }) => {
        const entry = await focusLinks(page);
        // A point ON the band's centerline (the hit area is its stroke), in page px.
        const hit = entry.locator('[data-link="2"]');
        const at = await hit.evaluate((path: SVGPathElement) => {
            const p = path.getPointAtLength(path.getTotalLength() / 2);
            const svg = path.ownerSVGElement!.getBoundingClientRect();
            return { x: svg.left + p.x, y: svg.top + p.y };
        });
        await page.mouse.move(at.x, at.y);
        const g = entry.locator('[data-plan-link="2"]');
        await expect(g).toHaveAttribute("data-lit", "");
        await expect(g.locator("[data-plan-linkend]")).toHaveCount(2);
        await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText("88 t");
        // Off the band: it dims again.
        await page.mouse.move(at.x, at.y + 40);
        await expect(g).not.toHaveAttribute("data-lit", "");
    });
});

/**
 * A paged canvas pages block by block, each window holding its entries whole
 * (#823) — measured in a real layout. `pagedSourceBlocks` is two series over
 * one source of 3,000 units: two blocks of 3,000 32px rows, and every row sits
 * at its unit's offset in its block — its window's place in the ledger plus
 * its place in the window. That holds from the first landing, through a far
 * jump that evicts the head of the run into a band, and through a window
 * landing above the rows in view: nothing on screen moves.
 */
test.describe("Plan paged blocks (#823)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    const ROW = 32;
    /** One block: 3,000 rows. */
    const BLOCK = 3_000 * ROW;

    /** Every mounted row that is not where its unit puts it: the jobs block
     *  first, the loads block after it. */
    async function misplaced(entry: Locator): Promise<string[]> {
        return entry.evaluate((root, { row, block }) => {
            const extent = root.querySelector("[data-virtual-extent]")!;
            const origin = extent.getBoundingClientRect().top;
            return [...extent.querySelectorAll("[data-plan-row]")].flatMap((el) => {
                const key = el.getAttribute("data-plan-row")!;
                const series = /series="([^"]*)"/.exec(key)![1]!;
                const unit = Number(/"U(\d+)"/.exec(key)![1]) - 10_000;
                const want = (series === "loads" ? block : 0) + unit * row;
                const got = el.getBoundingClientRect().top - origin;
                return Math.abs(got - want) <= 0.5 ? [] : [`${series} U${unit + 10_000}: ${got} ≠ ${want}`];
            });
        }, { row: ROW, block: BLOCK });
    }

    test("every row sits at its unit's offset in its block — through a far jump that evicts the run's head, and a window landing above the rows in view", async ({ page }) => {
        const entry = await openExample(page, "pagedSourceBlocks", "collections/paged-source");
        const frame = entry.locator('[data-virtual-rows="bounded"]');
        const extent = entry.locator("[data-virtual-extent]");
        const transport = entry.locator('[data-slot="footerTransport"]');
        const scrollTo = (top: number) => frame.evaluate((el, at) => { el.scrollTop = at; }, top);
        await expect(transport).toHaveText("600 loaded of 3,000");
        // The document is both blocks whole from the first landing.
        await expect(extent).toHaveAttribute("data-virtual-extent", String(2 * BLOCK));
        await expect.poll(() => misplaced(entry), "first landing").toEqual([]);

        // Far into the jobs block's tail band, where the ledger puts unit
        // 2,000: its run rebases to window 10, and windows 0–2 leave it for
        // the head band.
        const far = 2_000 * ROW;
        await scrollTo(far);
        await expect(transport).toHaveText("elements 1,801–2,600 of 3,000");
        await expect(entry.locator(rowSel("jobs", "U10000"))).toHaveCount(0);
        await expect.poll(() => misplaced(entry), "after the jump").toEqual([]);
        await expect(extent).toHaveAttribute("data-virtual-extent", String(2 * BLOCK));
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(far);

        // Up to the run's first row, 10px into it: once the scroll settles,
        // window 8 lands above it — and the rows in view stay where they are.
        const first = 1_800 * ROW + 10;
        await scrollTo(first);
        await expect(transport).toHaveText("elements 1,601–2,600 of 3,000");
        await expect.poll(() => misplaced(entry), "after the landing").toEqual([]);
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(first);
    });
});
