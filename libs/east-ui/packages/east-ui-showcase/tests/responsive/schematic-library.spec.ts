/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's library pane, measured in a real browser (#1389,
 * `Schematic Builder Spec.md` §8, SC4, SC27), on the data centre floor in
 * both themes. On a desktop the pane is pinned beside main, 272px, its tab
 * row 44px, its tabs in `library`'s order each with its count, every card
 * inside it and none scrolling sideways; collapsed, a 44px rail counting the
 * backlog. The Index's rows are the design system's tree row — 36px, 24px a
 * level, the chevron 14 in its 16, a zone's count 16px tall on the third paper
 * in the strong ink and the mono face, a selected row on the third paper, the
 * zone the viewport is in named at 600 — and the row the tree points at wears
 * the inset focus ring under the keyboard. The Layers tab's rows are the
 * pick-panel row — 44px, a hairline between, each swatch its layer's colour
 * token, the name 12.5px at 600 in the ink and a hidden layer's in the faint
 * ink at 500, never by opacity; Isolate, Lock and Show 24px, the brand's while
 * on and the faint ink while off; Show all under the rows. A hidden layer's
 * cards go, and a locked one's take no pointer. Nothing in the Index's or the
 * Layers' rows sets a style inline but a row's indent. On a phone, 390px and
 * 360px wide and in a 294px parent, the pane opens over main with a strip of
 * main beside it; the Index's rows are 44px and the layers' 44px at least,
 * each toggle a 44px square edge to edge with the next and the chevron a 44px
 * target by its halo, nothing past the pane's edge. Every measurement is read
 * on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-library`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { DATA_CENTRE, card, centred, openSchematic, openTab, pane, sizeTo } from "./schematic-page";
import { settled } from "./settle";
import { token } from "./tokens";

/** The open tab's panel. */
const panel = (root: Locator) => pane(root).locator("[role='tabpanel']:not([hidden])");

/** Every tab's name with its count, in order: the row's, then those its `+n` menu holds. */
async function tabNames(page: Page, root: Locator): Promise<string[]> {
    const onRow = await pane(root).getByRole("tab").allTextContents();
    const more = pane(root).locator("[data-dock-more]");
    if (await more.count() === 0) return onRow;
    await more.click();
    const inMenu = await page.getByRole("menuitem").allTextContents();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    return [...onRow, ...inMenu];
}

/** An Index row, by its name. */
const indexRow = (root: Locator, name: string) => panel(root).locator("[role='treeitem']")
    .filter({ has: root.page().locator("[data-index-name]", { hasText: new RegExp(`^${name}$`) }) });

/** A layer's toggle, by its layer's key. */
const layerToggle = (root: Locator, layer: string, toggle: "isolate" | "lock" | "show") =>
    panel(root).locator(`[data-schematic-layer="${layer}"] [data-layer-toggle="${toggle}"]`);

/** What in a panel sets a style inline, other than a row's indent: each element's attribute and the property. */
function inlineFaults(root: Locator): Promise<string[]> {
    return panel(root).evaluate((el) => [...el.querySelectorAll<HTMLElement>("[role='treeitem'], [role='treeitem'] [style], [data-schematic-layer], [data-schematic-layer] [style]")]
        .flatMap((node) => Array.from({ length: node.style.length }, (_, i) => node.style.item(i)).filter((property) => property !== "--index-depth")
            .map((property) => `${node.getAttribute("data-index-key") ?? node.getAttribute("data-schematic-layer") ?? node.tagName.toLowerCase()}: ${property}`)));
}

test.describe("The Schematic's library (#1389)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop widths; the phone's below");

    for (const theme of ["light", "dark"] as const) {
        test(`the pane: 272px pinned beside main, its tab row 44px, its tabs in \`library\`'s order each with its count, every card inside it and none scrolling sideways; collapsed, a 44px rail counting the backlog (${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 1600, height: 1000 });
            const root = await openSchematic(page, DATA_CENTRE, theme);
            const start = pane(root);
            expect(await start.evaluate((el) => [el.getAttribute("data-pane-mode"), Math.round(el.getBoundingClientRect().width)])).toEqual(["pinned", 272]);
            expect(await tabNames(page, root)).toEqual(["Templates 5", "Backlog 2", "Index 5", "Layers 4", "Owners 3"]);
            expect(await start.locator("[data-dock-tabs]").evaluate((el) => Math.round(el.parentElement!.getBoundingClientRect().height))).toBe(44);
            for (const [tab, count] of [["Templates", 5], ["Backlog", 2]] as const) {
                await openTab(page, root, tab);
                await expect(panel(root).locator("[data-library-item]"), tab).toHaveCount(count);
                expect(await panel(root).evaluate((el) => {
                    const p = el.getBoundingClientRect();
                    const faults = [...el.querySelectorAll("[data-library-item]")].flatMap((item) => {
                        const c = item.getBoundingClientRect();
                        return c.left < p.left - 0.5 || c.right > p.right + 0.5 ? [`${item.getAttribute("data-library-item")} leaves the pane`] : [];
                    });
                    const body = el.querySelector("[data-library] [data-scrollable]");
                    if (body !== null && body.scrollWidth - body.clientWidth > 1) faults.push("the cards scroll sideways");
                    return faults;
                }), tab).toEqual([]);
            }
            await start.getByRole("button", { name: "Collapse Library" }).click();
            await settled(page);
            expect(await start.evaluate((el) => [Math.round(el.getBoundingClientRect().width), el.querySelector("[data-dock-badge]")?.textContent])).toEqual([44, "2"]);
            await start.getByRole("button", { name: "Expand Library" }).click();
            await settled(page);
            expect(await start.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(272);
        });

        test(`the Index's rows are the design system's tree row: 36px, 24px a level, the chevron 14 in its 16, a zone's count 16px on the third paper in the strong ink and the mono face, a selected row on the third paper, the zone in view named at 600; the row the tree points at wears the inset ring under the keyboard (${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 1600, height: 1000 });
            const root = await openSchematic(page, DATA_CENTRE, theme);
            await openTab(page, root, "Index");
            // The meet-me room, clicked: the camera flies into it, and it opens — its layer locked by its author, it is
            // not selected (SC27); its frame, clicked: flown to and selected, the viewport still in the room.
            await indexRow(root, "Meet-me room").click();
            await expect(indexRow(root, "Meet-me room")).toHaveAttribute("data-current", "");
            await indexRow(root, "MMR-1").click();
            await expect(indexRow(root, "MMR-1")).toHaveAttribute("data-selected", "");
            await page.mouse.move(0, 0);
            await settled(page);
            await expect(indexRow(root, "Meet-me room")).toHaveAttribute("data-current", "");
            const read = await panel(root).evaluate((el) => {
                const row = (name: string) => [...el.querySelectorAll("[role='treeitem']")].find((r) => r.querySelector("[data-index-name]")!.textContent === name)!;
                const zone = row("Meet-me room"), item = row("MMR-1"), other = row("Network room");
                const box = (e: Element) => e.getBoundingClientRect();
                const style = (e: Element) => getComputedStyle(e);
                const count = zone.querySelector("[data-index-count]")!;
                const chevron = zone.firstElementChild!;
                const mono = document.createElement("span");
                mono.style.fontFamily = "var(--chakra-fonts-mono)";
                el.appendChild(mono);
                const monoFamily = style(mono).fontFamily;
                mono.remove();
                return {
                    heights: [zone, item, other].map((r) => Math.round(box(r).height)),
                    // An item's chevron slot, a level in from its zone's chevron.
                    indent: Math.round(box(item.firstElementChild!).left - box(chevron).left),
                    chevron: [Math.round(box(chevron).width), Math.round(box(chevron.querySelector("svg")!).height)],
                    count: [Math.round(box(count).height), style(count).backgroundColor, style(count).color, style(count).fontFamily === monoFamily],
                    selected: style(item).backgroundColor,
                    current: style(zone.querySelector("[data-index-name]")!).fontWeight,
                    plain: [style(other).backgroundColor, style(other.querySelector("[data-index-name]")!).fontWeight],
                };
            });
            expect(read.heights).toEqual([36, 36, 36]);
            expect(read.indent).toBe(24);
            expect(read.chevron).toEqual([16, 14]);
            expect(read.count).toEqual([16, await token(page, "bg-subtle"), await token(page, "fg-strong"), true]);
            expect(read.selected).toBe(await token(page, "bg-subtle"));
            expect(read.current).toBe("600");
            expect(read.plain).toEqual(["rgba(0, 0, 0, 0)", "500"]);
            // Into the tree by the keyboard, from its search box: the row it points at — the frame clicked last — wears the
            // design system's inset ring, and the tree draws no outline of its own.
            await panel(root).getByRole("textbox", { name: "Search items" }).focus();
            await page.keyboard.press("Tab");
            await expect(panel(root).getByRole("tree")).toBeFocused();
            const ring = await panel(root).evaluate((el) => {
                const tree = el.querySelector("[role='tree']")!;
                const active = document.getElementById(tree.getAttribute("aria-activedescendant")!)!;
                const probe = document.createElement("span");
                probe.style.boxShadow = "var(--chakra-shadows-focus-inset)";
                el.appendChild(probe);
                const want = getComputedStyle(probe).boxShadow;
                probe.remove();
                return { active: active.querySelector("[data-index-name]")!.textContent, shadow: getComputedStyle(active).boxShadow === want, outline: getComputedStyle(tree).outlineStyle };
            });
            expect(ring).toEqual({ active: "MMR-1", shadow: true, outline: "none" });
            expect(await inlineFaults(root)).toEqual([]);
        });

        test(`the Layers tab's rows are the pick-panel row: 44px, a hairline between, each swatch its layer's colour token, the name 12.5px at 600 in the ink and a hidden layer's in the faint ink at 500, never by opacity; Isolate, Lock and Show 24px, the brand's while on; Show all under the rows; a hidden layer's cards go, a locked one's take no pointer (SC27, ${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 1600, height: 1000 });
            const root = await openSchematic(page, DATA_CENTRE, theme);
            // A box wide enough, beside the pane, for the racks to draw as their cards.
            await sizeTo(page, root, 1440);
            await expect(card(root, "racks", "A01")).toBeVisible();
            await openTab(page, root, "Layers");
            // Power hidden: its racks' cards go, and Show all offers itself under the rows.
            await layerToggle(root, "power", "show").click();
            await expect(card(root, "racks", "A01")).toHaveCount(0);
            await page.mouse.move(0, 0);
            await settled(page);
            const read = await panel(root).evaluate((el) => {
                const rows = [...el.querySelectorAll("[data-schematic-layer]")];
                const style = (e: Element) => getComputedStyle(e);
                const size = document.createElement("span");
                size.style.fontSize = "var(--chakra-font-sizes-body-sm)";
                el.appendChild(size);
                const bodySm = style(size).fontSize;
                size.remove();
                const last = rows.at(-1)!.getBoundingClientRect();
                const foot = el.querySelector("[data-layers-show-all]")!.getBoundingClientRect();
                return {
                    rows: rows.map((row) => {
                        const name = row.children[1]!;
                        return {
                            key: row.getAttribute("data-schematic-layer"),
                            height: Math.round(row.getBoundingClientRect().height),
                            rule: [style(row).borderBottomWidth, style(row).borderBottomColor],
                            swatch: style(row.firstElementChild!).backgroundColor,
                            name: [style(name).fontSize === bodySm, style(name).fontWeight, style(name).color],
                            opacity: [style(row).opacity, style(name).opacity],
                            toggles: [...row.querySelectorAll("[data-layer-toggle]")].map((t) => {
                                const b = t.getBoundingClientRect(), glyph = t.querySelector("svg")!.getBoundingClientRect();
                                return [t.getAttribute("data-layer-toggle"), Math.round(b.width), Math.round(b.height), t.hasAttribute("data-on"), style(t).color,
                                    `${Math.round(glyph.width)}×${Math.round(glyph.height)}`];
                            }),
                        };
                    }),
                    footUnder: foot.top >= last.bottom - 0.5,
                };
            });
            const [subtle, fg, faint, brand] = await Promise.all(["border-subtle", "fg", "fg-subtle", "brand-solid"].map((name) => token(page, name)));
            const swatches = await Promise.all(["fg-muted", "status-warn", "brand-solid", "status-pos"].map((name) => token(page, name)));
            expect(read.rows.map((row) => row.key)).toEqual(["structure", "power", "cooling", "network"]);
            expect(read.rows.map((row) => row.height)).toEqual([44, 44, 44, 44]);
            expect(read.rows.map((row) => row.rule)).toEqual([["1px", subtle], ["1px", subtle], ["1px", subtle], ["0px", subtle]]);
            expect(read.rows.map((row) => row.swatch)).toEqual(swatches);
            expect(read.rows.map((row) => row.name)).toEqual([[true, "600", fg], [true, "500", faint], [true, "600", fg], [true, "600", fg]]);
            expect(read.rows.map((row) => row.opacity)).toEqual(Array.from({ length: 4 }, () => ["1", "1"]));
            // Each toggle a glyph of 12 in 24px, the brand's while on and the faint ink while off: Structure's lock its author's, Power's eye shut.
            for (const row of read.rows) {
                for (const [which, w, h, on, colour, glyph] of row.toggles) {
                    expect([w, h, glyph], `${row.key}'s ${which}`).toEqual([24, 24, "12×12"]);
                    expect(colour, `${row.key}'s ${which}`).toBe(on === true ? brand : faint);
                }
            }
            expect(read.rows.map((row) => row.toggles.filter((t) => t[3] === true).map((t) => t[0]))).toEqual([["lock", "show"], [], ["show"], ["show"]]);
            expect(read.footUnder).toBe(true);
            // Show all, then Power locked: its racks draw again, and take no pointer.
            await panel(root).locator("[data-layers-show-all]").click();
            await layerToggle(root, "power", "lock").click();
            await expect(card(root, "racks", "A01")).toHaveAttribute("data-locked", "");
            await expect(card(root, "racks", "A01")).toHaveCSS("pointer-events", "none");
            await expect(card(root, "network", "MMR-1")).toHaveCSS("pointer-events", "auto");
            expect(await inlineFaults(root)).toEqual([]);
        });
    }
});

test.describe("The Schematic's library on a phone (#1389)", () => {
    test.skip(({ isMobile }) => !isMobile, "the phone projects");

    for (const theme of ["light", "dark"] as const) {
        test(`on a phone 390px and 360px wide, and in a 294px parent, the library opens over main with a strip of main beside it; the Index's rows 44px and the layers' 44px at least, each toggle a 44px square and the chevron a 44px target by its halo, nothing past the pane's edge (${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const root = await openSchematic(page, DATA_CENTRE, theme);
            for (const at of ["at 390px", "at 360px", "in a 294px parent"] as const) {
                if (at === "at 360px") {
                    await page.setViewportSize({ width: 360, height: 740 });
                    await settled(page);
                }
                if (at === "in a 294px parent") await sizeTo(page, root, 294);
                // In the window's middle: a narrower page reflows what lies above the Schematic, and a point is hit only in view.
                await centred(page, root);
                const start = pane(root);
                await expect(start, at).toHaveAttribute("data-pane-mode", "overlay");
                await start.getByRole("button", { name: "Expand Library" }).tap();
                await settled(page);
                const sheet = await root.evaluate((el) => {
                    const frame = el.querySelector("[data-builder-frame]")!.getBoundingClientRect();
                    const open = el.querySelector("[data-frame-slot='start'] > *")!.getBoundingClientRect();
                    return { strip: Math.round(frame.right - open.right), inside: open.left >= frame.left - 0.5 };
                });
                expect(sheet.strip, at).toBeGreaterThanOrEqual(48);
                expect(sheet.inside, at).toBe(true);
                // The Index: each row 44px; a zone's chevron a 44px target by its halo — a tap 21px above or below its
                // middle, on its column, lands on it — and the row a tap beside it.
                await openTab(page, root, "Index");
                const index = await panel(root).evaluate((el) => {
                    const rows = [...el.querySelectorAll("[role='treeitem']")];
                    const chevron = rows[0]!.firstElementChild!;
                    const c = chevron.getBoundingClientRect(), x = c.left + c.width / 2, y = c.top + c.height / 2;
                    const lands = (dy: number) => document.elementFromPoint(x, y + dy)?.closest("button") === chevron;
                    const p = el.getBoundingClientRect();
                    return {
                        heights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
                        halo: [lands(-21), lands(21)],
                        inside: rows.every((r) => r.getBoundingClientRect().right <= p.right + 0.5),
                    };
                });
                expect(index, at).toEqual({ heights: [44], halo: [true, true], inside: true });
                // The Layers: each row 44px at least — its toggles' squares and its hairline — each toggle a 44px square,
                // edge to edge, and nothing past the pane's edge.
                await openTab(page, root, "Layers");
                const layers = await panel(root).evaluate((el) => {
                    const p = el.getBoundingClientRect();
                    const rows = [...el.querySelectorAll("[data-schematic-layer]")];
                    return {
                        shortest: Math.min(...rows.map((r) => Math.round(r.getBoundingClientRect().height))),
                        toggles: [...new Set([...el.querySelectorAll("[data-layer-toggle]")].map((t) => {
                            const b = t.getBoundingClientRect();
                            return `${Math.round(b.width)}×${Math.round(b.height)}`;
                        }))],
                        // Each toggle's neighbour starts where it ends: a tap just inside one's edge is its own.
                        apart: rows.flatMap((row) => {
                            const t = [...row.querySelectorAll("[data-layer-toggle]")].map((b) => b.getBoundingClientRect());
                            return t.slice(1).map((b, i) => Math.round(b.left - t[i]!.right));
                        }),
                        outside: rows.flatMap((row) => [...row.querySelectorAll("*")].filter((part) => part.getBoundingClientRect().right > Math.min(p.right, row.getBoundingClientRect().right) + 0.5)
                            .map((part) => `${row.getAttribute("data-schematic-layer")}: ${part.tagName.toLowerCase()}`)),
                    };
                });
                expect(layers.shortest, at).toBeGreaterThanOrEqual(44);
                expect({ toggles: layers.toggles, apart: [...new Set(layers.apart)], outside: layers.outside }, at).toEqual({ toggles: ["44×44"], apart: [0], outside: [] });
                await start.getByRole("button", { name: "Collapse Library" }).tap();
                await settled(page);
            }
        });
    }
});
