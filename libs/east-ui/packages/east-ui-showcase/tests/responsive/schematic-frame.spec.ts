/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic in its frame, measured in a real browser (#1387, `Schematic
 * Builder Spec.md` §6, SC24, SC26, SC31), on the data centre floor and on the
 * floor of shaped units: a borderless `BuilderFrame` filling the box its
 * example gives it — one 44px toolbar row, the library's pane at the start of
 * the body (#1389) and the inspector's at its end (#1391), the canvas filling
 * main between them with the scale bar on it and no control of its own, the
 * footer's counts along the foot. The toolbar
 * folds by one ladder (SC24): the rail first, in its own
 * order, then its summary, then the Schematic's own — the tools' words, Find's
 * box, the tools' strip — and last the tools, the zoom, Fit and Find into the
 * View, one move; one row at 1440, 1024 and 768px and in every box from 1600px
 * — unfolded there — to a 294px parent, nothing past its edge, a narrower row
 * never folding less;
 * on a phone, 390px and 360px wide, the row holds the rail's icon, the View and
 * the history (#1388), and the View holds the tools, the zoom and Fit over
 * Find's box. The canvas
 * draws in the design system's tokens and its mono font, read through the
 * recipe's probe, and an item's card dot is the colour its marks draw in on the
 * canvas — a theme colour token resolved, a value naming none its tone (SC26) —
 * in both themes; its cursor follows the tool held; and nothing in it sets a
 * style inline but geometry (SC31). Every measurement is polled until it holds,
 * on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-frame`.
 */

import { test, expect, type Locator } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { DATA_CENTRE, SHAPES, collapseInspector, openSchematic, sizeTo } from "./schematic-page";
import { settled } from "./settle";

/** The Schematic's own fold steps, after every step of its rail and its summary's, in order — the history's, which the data centre edits, last (#1388). */
const OWN = ["tools>1", "seek>1", "tools>2", "tools>3", "zoom>1", "seek>2", "history>1"];

/** What the toolbar says of itself: each item's form of its forms, the ladder, how many steps it took. */
function toolbarOf(root: Locator) {
    return root.evaluate((el) => {
        const bar = el.querySelector("[data-frame-slot='toolbar'] [data-toolbar]")!;
        return {
            state: Object.fromEntries((bar.getAttribute("data-toolbar-state") ?? "").split(";").filter((p) => p !== "").map((part) => {
                const [key, of] = part.split("=");
                return [key!, Number(of!.split("/")[0])] as const;
            })) as Record<string, number>,
            ladder: (bar.getAttribute("data-toolbar-ladder") ?? "").split(" ").filter((s) => s !== ""),
            folds: Number(bar.getAttribute("data-toolbar-folds")),
        };
    });
}

/** What is wrong with the row's folds: each item where its ladder's first steps put it, the rail's steps first, the Schematic's own after them in order. */
async function ladderFaults(root: Locator): Promise<string[]> {
    const { state, ladder, folds } = await toolbarOf(root);
    const bad: string[] = [];
    const own = ladder.filter((step) => !step.startsWith("record-"));
    if (own.join(" ") !== OWN.join(" ")) bad.push(`its own steps are ${own.join(" ")}`);
    if (ladder.slice(0, ladder.length - own.length).some((step) => !step.startsWith("record-"))) bad.push(`the rail's steps do not come first: ${ladder.join(" ")}`);
    const prefix = ladder.slice(0, folds);
    for (const [key, form] of Object.entries(state)) {
        const want = prefix.filter((step) => step.startsWith(`${key}>`)).length;
        if (form !== want) bad.push(`${key} at form ${form}, where the ladder's first ${folds} steps put it at ${want}`);
    }
    return bad;
}

/** A phone's row: the rail's icon, the View and the history; no tools, zoom or steps of their own, no summary. */
async function expectPhoneRow(root: Locator, at: string): Promise<void> {
    await expect.poll(() => toolbarFaults(root), { message: at }).toEqual([]);
    await expect.poll(() => ladderFaults(root), { message: at }).toEqual([]);
    const { state } = await toolbarOf(root);
    expect({ tools: state["tools"], zoom: state["zoom"], seek: state["seek"] }, at).toEqual({ tools: 3, zoom: 1, seek: 2 });
    await expect(root.locator("[data-toolbar-item='history']"), at).toBeVisible();
    await expect(root.locator("[data-toolbar-item='record-slices'] [data-rail-rung='icon']"), at).toBeVisible();
    await expect(root.locator("[data-toolbar-item='seek'] [data-key-search='icon']"), at).toHaveAttribute("aria-label", "View");
    await expect(root.locator("[data-frame-slot='toolbar'] [data-schematic-tools], [data-frame-slot='toolbar'] [data-schematic-zoom]"), at).toHaveCount(0);
}

test.describe("The Schematic's frame (#1387)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop widths; the phone's below");

    for (const theme of ["light", "dark"] as const) {
        test(`a borderless frame filling its box: one 44px toolbar row, the library's pane and the inspector's either side of main, the canvas filling main with the scale bar on it and no control of its own, the footer along the foot (${theme})`, async ({ page }) => {
            const root = await openSchematic(page, DATA_CENTRE, theme);
            await expect.poll(() => root.evaluate((el) => {
                const round = (n: number) => Math.round(n * 10) / 10;
                const frame = el.querySelector("[data-builder-frame]")!;
                const host = el.parentElement!.getBoundingClientRect();
                const r = el.getBoundingClientRect();
                const f = frame.getBoundingClientRect();
                const border = (s: CSSStyleDeclaration) => [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth];
                const canvas = frame.querySelector("[data-schematic-canvas]")!.getBoundingClientRect();
                const scale = frame.querySelector("[data-schematic-scale]")!.getBoundingClientRect();
                return {
                    // The root fills the example's box, and the frame the root.
                    root: [r.left - host.left, r.top - host.top, r.width - host.width, r.height - host.height].map(round),
                    frame: [f.left - r.left, f.top - r.top, f.width - r.width, f.height - r.height].map(round),
                    border: [...border(getComputedStyle(el)), ...border(getComputedStyle(frame))],
                    rows: frame.querySelectorAll("[data-frame-slot='toolbar'] [data-toolbar]").length,
                    // No control of its own: what was its control column is the toolbar's.
                    controls: frame.querySelectorAll("[data-schematic-canvas] button, [data-schematic-canvas] [role='button'], [data-schematic-canvas] input").length,
                    // The scale bar on the canvas, at its bottom-right.
                    scale: scale.right <= canvas.right && scale.bottom <= canvas.bottom && scale.left >= canvas.left + canvas.width / 2 && scale.top >= canvas.top + canvas.height / 2,
                };
            })).toEqual({ root: [0, 0, 0, 0], frame: [0, 0, 0, 0], border: Array.from({ length: 8 }, () => "0px"), rows: 1, controls: 0, scale: true });
            const read = await root.evaluate((el) => {
                const f = el.querySelector("[data-builder-frame]")!.getBoundingClientRect();
                const at = (sel: string) => {
                    const b = el.querySelector(sel)!.getBoundingClientRect();
                    return [Math.round(b.left - f.left), Math.round(b.top - f.top), Math.round(b.width), Math.round(b.height)];
                };
                return {
                    w: Math.round(f.width), h: Math.round(f.height),
                    toolbar: at("[data-frame-slot='toolbar']"), start: at("[data-frame-slot='start']"), main: at("[data-frame-slot='main']"),
                    end: at("[data-frame-slot='end']"), canvas: at("[data-schematic-canvas]"), footer: at("[data-frame-slot='footer']"),
                    counts: [...el.querySelectorAll("[data-schematic-footer] [data-schematic-count]")].map((line) => line.textContent),
                };
            });
            expect(read.toolbar).toEqual([0, 0, read.w, 44]);
            expect(read.canvas).toEqual(read.main);
            // The library's pane at the start of the body and the inspector's at its end, and main between them, each from
            // the toolbar to the footer.
            expect([read.start[0], read.start[1], read.start[1]! + read.start[3]!]).toEqual([0, 44, read.footer[1]]);
            expect([read.end[0]! + read.end[2]!, read.end[1], read.end[1]! + read.end[3]!]).toEqual([read.w, 44, read.footer[1]]);
            expect([read.main[0], read.main[1], read.main[0]! + read.main[2]!, read.main[1]! + read.main[3]!])
                .toEqual([read.start[0]! + read.start[2]!, 44, read.end[0], read.footer[1]]);
            expect([read.footer[0], read.footer[2], read.footer[1]! + read.footer[3]!]).toEqual([0, read.w, read.h]);
            expect(read.counts).toEqual(["Rack 5 of 7", "Network frame 3", "Cooling unit 3", "Power distribution unit 2", "5 zones", "6 links", "2 nets"]);
        });

        test(`the toolbar folds by one ladder — the rail first, then its summary, then the tools' words, Find's box and the tools' strip, the View last — one row at 1440, 1024 and 768px and in every box from 1600px to a 294px parent, nothing past its edge (SC24, ${theme})`, async ({ page }) => {
            const root = await openSchematic(page, DATA_CENTRE, theme);
            for (const width of [1440, 1024, 768]) {
                await page.setViewportSize({ width, height: 900 });
                await settled(page);
                await expect.poll(() => toolbarFaults(root), { message: `at a ${width}px viewport` }).toEqual([]);
                await expect.poll(() => ladderFaults(root), { message: `at a ${width}px viewport` }).toEqual([]);
            }
            await page.setViewportSize({ width: 1600, height: 900 });
            const seen: number[] = [];
            // Room for every item at its widest is 1600px: the history item takes its place on the row (#1388).
            for (const width of [1600, 1440, 1200, 1024, 900, 768, 640, 480, 390, 360, 320, 294]) {
                await sizeTo(page, root, width);
                await expect.poll(() => toolbarFaults(root), { message: `in a ${width}px box` }).toEqual([]);
                await expect.poll(() => ladderFaults(root), { message: `in a ${width}px box` }).toEqual([]);
                seen.push((await toolbarOf(root)).folds);
            }
            // Unfolded with room; a narrower row never folds less; in a 294px parent, a phone's row.
            expect(seen[0]).toBe(0);
            for (let i = 1; i < seen.length; i++) expect(seen[i]!, `the ${i}th width`).toBeGreaterThanOrEqual(seen[i - 1]!);
            await expectPhoneRow(root, "in a 294px parent");
        });

        test(`the canvas draws in the design system's tokens and its mono font, read through the recipe's probe; a card's dot is its marks' colour, a theme token resolved, and a value naming none draws its tone (SC26, ${theme})`, async ({ page }) => {
            const root = await openSchematic(page, SHAPES, theme);
            // Tall enough a box for the units to draw as their cards.
            await sizeTo(page, root, 1100, 900);
            await expect(root.locator("[data-card-key] [data-surface]").first()).toBeVisible();
            const read = await root.evaluate((el) => {
                /** Any colour the page computes, as sRGBA channels: drawn on a one-pixel canvas and read back, so every format reads alike. */
                const pixel = document.createElement("canvas");
                pixel.width = 1;
                pixel.height = 1;
                const ink = pixel.getContext("2d", { willReadFrequently: true })!;
                const rgba = (c: string) => {
                    ink.clearRect(0, 0, 1, 1);
                    ink.fillStyle = "#000000";
                    ink.fillStyle = c;
                    ink.fillRect(0, 0, 1, 1);
                    return [...ink.getImageData(0, 0, 1, 1).data].join(",");
                };
                /** A token's colour as the page resolves it in this theme. */
                const token = (name: string) => {
                    const probe = document.createElement("div");
                    probe.style.color = `var(${name})`;
                    el.appendChild(probe);
                    const c = getComputedStyle(probe).color;
                    probe.remove();
                    return rgba(c);
                };
                const probe = el.querySelector("[data-schematic-probe]")!;
                const role = (name: string) => rgba(getComputedStyle(probe.querySelector(`[data-role='${name}']`)!).color);
                /** The probe's colour for what an element names: the canvas's colour for it. */
                const tinted = (of: Element) => {
                    const names = ["data-surface", "data-color", "data-tone", "data-status", "data-pattern"];
                    const same = [...probe.querySelectorAll("[data-tint]")].find((t) => names.every((n) => t.getAttribute(n) === of.getAttribute(n)));
                    return same === undefined ? "absent" : rgba(getComputedStyle(same).color);
                };
                const dot = (label: string) => [...el.querySelectorAll("[data-card-key]")]
                    .find((card) => (card.textContent ?? "").includes(label))!.querySelector("[data-surface]")!;
                // A colour naming no theme token beside its tone: the chain draws the tone.
                const lost = document.createElement("span");
                for (const [name, value] of [["data-tint", "test"], ["data-surface", "item"], ["data-color", "no.such.token"], ["data-tone", "danger"]]) lost.setAttribute(name!, value!);
                probe.appendChild(lost);
                const fallback = rgba(getComputedStyle(lost).color);
                lost.remove();
                const font = (which: string) => {
                    const s = getComputedStyle(probe.querySelector(`[data-font='${which}']`)!);
                    return [s.fontFamily, s.fontSize, s.fontWeight];
                };
                const mono = (() => {
                    const p = document.createElement("div");
                    p.style.fontFamily = "var(--chakra-fonts-mono)";
                    p.style.fontSize = "var(--chakra-font-sizes-label-sm)";
                    el.appendChild(p);
                    const s = getComputedStyle(p);
                    const out = [s.fontFamily, s.fontSize];
                    p.remove();
                    return out;
                })();
                return {
                    roles: {
                        brandSolid: [role("brandSolid"), token("--chakra-colors-brand-solid")],
                        brandMark: [role("brandMark"), token("--chakra-colors-brand-mark")],
                        brandTint: [role("brandTint"), token("--chakra-colors-brand-tint")],
                        fgMuted: [role("fgMuted"), token("--chakra-colors-fg-muted")],
                        fgSubtle: [role("fgSubtle"), token("--chakra-colors-fg-subtle")],
                        bgSurface: [role("bgSurface"), token("--chakra-colors-bg-surface")],
                        bgCanvas: [role("bgCanvas"), token("--chakra-colors-bg-canvas")],
                        borderStrong: [role("borderStrong"), token("--chakra-colors-border-strong")],
                        statusNeg: [role("statusNeg"), token("--chakra-colors-status-neg")],
                        statusInfo: [role("statusInfo"), token("--chakra-colors-status-info")],
                    },
                    // CRAH-1 names status.info, CT-2 heat.3: its card's dot, the canvas's colour for it, and the token.
                    crah: [rgba(getComputedStyle(dot("CRAH-1")).backgroundColor), tinted(dot("CRAH-1")), token("--chakra-colors-status-info")],
                    tower: [rgba(getComputedStyle(dot("CT-2")).backgroundColor), tinted(dot("CT-2")), token("--chakra-colors-heat-3")],
                    fallback: [fallback, token("--chakra-colors-status-neg")],
                    label: font("label"),
                    eyebrow: font("eyebrow"),
                    mono,
                    canvasGround: rgba(getComputedStyle(el.querySelector("[data-schematic-canvas]")!).backgroundColor),
                    cardGround: rgba(getComputedStyle(el.querySelector("[data-card-key]")!).backgroundColor),
                };
            });
            for (const [name, [probed, want]] of Object.entries(read.roles)) expect(probed, name).toBe(want);
            expect(new Set(read.crah).size, `CRAH-1: ${read.crah.join(" · ")}`).toBe(1);
            expect(new Set(read.tower).size, `CT-2: ${read.tower.join(" · ")}`).toBe(1);
            expect(read.fallback[0]).toBe(read.fallback[1]);
            // The canvas's labels and eyebrows in the design system's mono face, the labels at label.sm, semibold.
            expect(read.label[0]).toBe(read.mono[0]);
            expect(read.eyebrow[0]).toBe(read.mono[0]);
            expect(read.label[1]).toBe(read.mono[1]);
            expect(read.label[2]).toBe("600");
            expect(read.canvasGround).toBe(read.roles.bgCanvas[1]);
            expect(read.cardGround).toBe(read.roles.bgSurface[1]);
        });

        test(`nothing in the canvas, its cards, its probe or the footer sets a style inline but geometry, and the canvas's cursor follows the tool held, through the recipe (SC31, ${theme})`, async ({ page }) => {
            const root = await openSchematic(page, DATA_CENTRE, theme);
            // Wide enough a box for every tool's word on the row, and — the inspector collapsed to its rail (#1391) — the
            // racks to draw as their cards.
            await sizeTo(page, root, 1440);
            await collapseInspector(page, root);
            await expect(root.locator("[data-card-key]").first()).toBeVisible();
            const read = await root.evaluate((el) => {
                // Geometry: positions and sizes, the grid's pattern — its size, and its position, which the page lists as its two
                // longhands — and the camera's, a layer's and the widest card's custom properties.
                const geometry = new Set([
                    "left", "top", "width", "height", "transform", "background-size", "background-position-x", "background-position-y",
                    "--cam-ppu", "--cam-tx", "--cam-ty", "--schematic-layer-opacity", "--schematic-card-max",
                ]);
                const styled = [...el.querySelectorAll<HTMLElement>("[data-schematic-canvas], [data-schematic-canvas] [style], [data-schematic-footer], [data-schematic-footer] [style]")];
                return {
                    styled: styled.length,
                    outside: styled.flatMap((s) => Array.from({ length: s.style.length }, (_, i) => s.style.item(i)).filter((p) => !geometry.has(p))
                        .map((p) => `${s.getAttribute("data-card-key") ?? s.tagName.toLowerCase()}: ${p}`)),
                };
            });
            expect(read.styled).toBeGreaterThan(5);
            expect(read.outside).toEqual([]);
            // The widest card (#1393): a card is no wider than the card layer's figure, its label ending in an ellipsis inside
            // it; one at its item's own width keeps that width, its label cut inside it too. A rack's card, cloned with a label
            // longer than any card and laid out beside it — boxed as drawn, and with its own width taken off — then taken away.
            const widest = await root.evaluate((el) => {
                const real = el.querySelector<HTMLElement>("[data-card-key][data-boxed]")!;
                const layer = real.parentElement!;
                const probe = (boxed: boolean) => {
                    const clone = real.cloneNode(true) as HTMLElement;
                    clone.removeAttribute("data-card-key");
                    if (!boxed) {
                        clone.removeAttribute("data-boxed");
                        clone.style.removeProperty("width");
                    }
                    const label = clone.querySelector<HTMLElement>("[data-card-label]")!;
                    label.textContent = "R".repeat(120);
                    layer.appendChild(clone);
                    const box = clone.getBoundingClientRect(), words = label.getBoundingClientRect();
                    const read = {
                        width: Math.round(box.width),
                        maxWidth: getComputedStyle(clone).maxWidth,
                        cut: label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === "ellipsis",
                        inside: words.left >= box.left && words.right <= box.right,
                    };
                    clone.remove();
                    return read;
                };
                return { figure: layer.style.getPropertyValue("--schematic-card-max"), drawn: Math.round(real.getBoundingClientRect().width), held: probe(false), boxed: probe(true) };
            });
            expect(widest.figure).toBe("200px");
            expect(widest.held).toEqual({ width: 200, maxWidth: "200px", cut: true, inside: true });
            expect(widest.boxed).toEqual({ width: widest.drawn, maxWidth: "none", cut: true, inside: true });
            const canvas = root.locator("[data-schematic-canvas]");
            await expect(canvas).toHaveCSS("cursor", "grab");
            for (const [tool, cursor] of [["Marquee", "crosshair"], ["Zoom box", "crosshair"], ["Connect", "crosshair"], ["Move", "move"], ["Select", "grab"]] as const) {
                await root.locator("[data-frame-slot='toolbar']").getByRole("radio", { name: tool }).click();
                await expect(canvas, tool).toHaveAttribute("data-tool", tool === "Zoom box" ? "zoom" : tool.toLowerCase());
                await expect(canvas, tool).toHaveCSS("cursor", cursor);
            }
        });
    }
});

test.describe("The Schematic's frame on a phone (#1387)", () => {
    test.skip(({ isMobile }) => !isMobile, "the phone projects");

    for (const theme of ["light", "dark"] as const) {
        test(`on a phone 390px and 360px wide, and in a 294px parent, the row holds the rail's icon, the View and the history, and the View holds the tools, the zoom and Fit over Find's box (SC24, ${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const root = await openSchematic(page, DATA_CENTRE, theme);
            await expectPhoneRow(root, "at 390px");
            await page.setViewportSize({ width: 360, height: 740 });
            await settled(page);
            await expectPhoneRow(root, "at 360px");
            await sizeTo(page, root, 294);
            await expectPhoneRow(root, "in a 294px parent");
            // The View, tapped open: the tools, each its icon named by its word; the zoom and Fit; Find's box under them.
            const view = root.locator("[data-toolbar-item='seek'] [data-key-search='icon']");
            await view.tap();
            const controls = page.locator("[data-schematic-view]");
            await expect(controls).toBeVisible();
            expect(await controls.locator("[data-schematic-seg='tools'] [role='radio']").evaluateAll((radios) => radios.map((radio) => radio.getAttribute("aria-label"))))
                .toEqual(["Select", "Zoom box", "Marquee", "Connect", "Move"]);
            await expect(controls.locator("[data-schematic-zoom] button")).toHaveCount(3);
            await expect(page.locator("[data-key-search='popover'] input")).toBeVisible();
            // A tool picked there closes it, and the canvas takes the next gesture with it.
            await controls.locator("[aria-label='Marquee']").tap();
            await expect(view).toHaveAttribute("data-state", "closed");
            await expect(root.locator("[data-schematic-canvas]")).toHaveAttribute("data-tool", "marquee");
        });
    }
});
