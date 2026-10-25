/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The footer's one loading line (#1398, CL3) in each builder that reads what
 * it shows a part at a time — the Sheet, the Plan, the Roster, the Calendar,
 * the Allocation and the Schematic — on the real in-page e3, at rest, with its frame 1440,
 * 768, 390 and 360px wide, in both themes: the rail is one line at every
 * width, never wrapped, its height its widest's and nothing past its edge;
 * the items it shows are whole and on its centre line; the units its fit cut
 * are the last ones, each hidden whole and taking no room, and the "…" ends
 * them; never more units at a narrower frame; and the line is one polite live
 * region that says nothing and takes no room once what the builder shows has
 * landed. The line and the "…" speak in the footer's voice — mono,
 * `label.md`, tabular, `fg.muted` — whatever voice the rail's own items take.
 * No item the fit weighs at a width of its own can shrink in the flex layout
 * but one marked as taking the rail's slack (`data-footer-slack`): an item
 * that shrinks as the fit chooses would measure differently at each choice,
 * and the fit would never settle (the Sheet's message, which looped it on a
 * phone, #1398).
 *
 * Nothing on a rail at rest is a control, so it is measured with a mouse
 * alone. The line's forms in flight — its words, its short form, its dot
 * alone, a failure's Retry — are `builder-footer-line-reads.spec.ts`'s, which
 * holds and fails the builders' reads through the showcase's e3 fault hook.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";

/** Each builder by its example: the root the box its example gives it holds, and its footer's rail. */
const BUILDERS = [
    { builder: "Sheet", route: "e3/sheet/sheet/sheetStress", root: "[data-builder-frame]", rail: "[data-frame-slot='footer'] [data-slot='footer']" },
    { builder: "Plan", route: "e3/plan/plan-windows/planWindows", root: "[data-plan-frame]", rail: "[data-frame-slot='footer'] [data-slot='footer']" },
    { builder: "Roster", route: "e3/roster/roster/rosterWarehouse", root: "[data-roster-frame]", rail: "[data-roster-footer]" },
    { builder: "Calendar", route: "e3/calendar/calendar/calendarOperations", root: "[data-calendar-frame]", rail: "[data-calendar-footer]" },
    { builder: "Allocation", route: "e3/allocation/allocation/allocationKilnYard", root: "[data-allocation-frame]", rail: "[data-allocation-footer]" },
    // The data centre, nothing live at rest: its notices one item of the rail, which takes the rail's slack.
    { builder: "Schematic", route: "e3/schematic/schematic/schematicDataCentre", root: "[data-schematic]", rail: "[data-schematic-footer]" },
] as const;

/** The frame's widths, widest first. */
const WIDTHS = [1440, 768, 390, 360] as const;

/** The footer's voice, as the page resolves its tokens: the line speaks in it. */
interface Voice {
    readonly family: string;
    readonly size: string;
    readonly color: string;
}

/** A rail at rest, as the page lays it out. */
interface RailAt {
    readonly wrap: string;
    readonly height: number;
    /** How far its content runs past its edge. */
    readonly overflow: number;
    /** Its legend's units — or its hints, or its counts — in order: each one's words, and whether its fit cut it. */
    readonly units: readonly { readonly text: string; readonly cut: boolean }[];
    /** Whether the "…" shows. */
    readonly more: boolean;
    /** The "…"'s voice, while it shows. */
    readonly moreVoice: Voice | null;
    /** Each item it shows, by its words, past its content box. */
    readonly outside: readonly string[];
    /** Each item it shows, by its words, off its centre line. */
    readonly offCentre: readonly string[];
    /** Each item it shows, by its words, cut inside them. */
    readonly clipped: readonly string[];
    /** Each item its fit cut, by its words, that still shows or still takes room in the flow. */
    readonly seen: readonly string[];
    /**
     * Each item the fit weighs at a width of its own — not a unit, the units, the "…" or the line — that the flex layout
     * could shrink below its words, by its tag and words, unless it takes the rail's slack.
     */
    readonly shrinking: readonly string[];
    /** How many loading lines it holds. */
    readonly lines: number;
    /** Its loading line as it stands. */
    readonly line: {
        readonly idle: boolean;
        readonly role: string | null;
        readonly live: string | null;
        readonly words: string;
        readonly width: number;
        readonly height: number;
        readonly family: string;
        readonly size: string;
        readonly numeric: string;
        readonly color: string;
    } | null;
}

/** The footer's voice: the mono family, `label.md` and `fg.muted`, as the page resolves them in its theme. */
function voiceOf(page: Page): Promise<Voice> {
    return page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.fontFamily = "var(--chakra-fonts-mono)";
        probe.style.fontSize = "var(--chakra-font-sizes-label-md)";
        probe.style.color = "var(--chakra-colors-fg-muted)";
        document.body.appendChild(probe);
        const style = getComputedStyle(probe);
        const voice = { family: style.fontFamily, size: style.fontSize, color: style.color };
        probe.remove();
        return voice;
    });
}

/** Reads a rail at rest. */
function railAt(rail: Locator): Promise<RailAt> {
    return rail.evaluate((el): RailAt => {
        const css = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const start = box.left + Number.parseFloat(css.paddingLeft) - 0.5;
        const end = box.right - Number.parseFloat(css.paddingRight) + 0.5;
        const centre = box.top + box.height / 2;
        const words = (item: Element) => (item.textContent ?? "").trim();
        const units = [...el.querySelectorAll(":scope > [data-footer-unit], :scope > [data-footer-units] > [data-footer-unit]")];
        const cut = [...el.querySelectorAll(":scope > [data-footer-cut], :scope > [data-footer-units] > [data-footer-cut]")];
        // What the rail shows: its items in the flow, each with a width — an empty message takes none.
        const shown = [...el.children].filter((item) => !item.hasAttribute("data-footer-cut") && !item.hasAttribute("data-idle")
            && item.getBoundingClientRect().width > 0);
        const more = el.querySelector(":scope > [data-footer-more]:not([data-footer-cut])");
        const moreStyle = more === null ? undefined : getComputedStyle(more);
        const line = el.querySelector(":scope > [data-footer-line]");
        const lineBox = line?.getBoundingClientRect();
        const lineStyle = line === null ? undefined : getComputedStyle(line);
        return {
            wrap: css.flexWrap,
            height: box.height,
            overflow: el.scrollWidth - el.clientWidth,
            units: units.map((unit) => ({ text: words(unit), cut: unit.hasAttribute("data-footer-cut") })),
            more: more !== null,
            moreVoice: moreStyle === undefined ? null : { family: moreStyle.fontFamily, size: moreStyle.fontSize, color: moreStyle.color },
            outside: shown.filter((item) => { const b = item.getBoundingClientRect(); return b.left < start || b.right > end; }).map(words),
            offCentre: shown.filter((item) => { const b = item.getBoundingClientRect(); return Math.abs(b.top + b.height / 2 - centre) > 1; }).map(words),
            clipped: shown.filter((item) => item.scrollWidth > item.clientWidth + 1).map(words),
            seen: cut.filter((item) => { const s = getComputedStyle(item); return s.visibility !== "hidden" || s.position !== "absolute"; }).map(words),
            // A flex item shrinks below its words when it may shrink and its floor is not its content: an explicit
            // min-width, or `auto` over an overflow it clips.
            shrinking: [...el.children].filter((item) => {
                if (item.matches("[data-footer-unit], [data-footer-units], [data-footer-more], [data-footer-line], [data-footer-cut], [data-footer-slack]")) return false;
                const s = getComputedStyle(item);
                if (s.display === "none" || s.position === "absolute" || s.position === "fixed") return false;
                return Number.parseFloat(s.flexShrink) > 0 && (s.minWidth !== "auto" || s.overflowX !== "visible");
            }).map((item) => `${item.getAttribute("data-slot") ?? item.tagName.toLowerCase()} '${words(item)}'`),
            lines: el.querySelectorAll(":scope > [data-footer-line]").length,
            line: line === null || lineBox === undefined || lineStyle === undefined ? null : {
                idle: line.hasAttribute("data-idle"),
                role: line.getAttribute("role"),
                live: line.getAttribute("aria-live"),
                words: line.textContent ?? "",
                width: lineBox.width,
                height: lineBox.height,
                family: lineStyle.fontFamily,
                size: lineStyle.fontSize,
                numeric: lineStyle.fontVariantNumeric,
                color: lineStyle.color,
            },
        };
    });
}

// A test a builder: each is an area of its own, whose workspace the page deploys the first time it shows (#1397).
for (const theme of ["light", "dark"] as const) {
    for (const { builder, route, root, rail: railSelector } of BUILDERS) {
        test(`the ${builder}'s footer stays one line at every width, its fit cutting units whole, and its loading line says nothing at rest, in the footer's voice (#1398, CL3) (${theme}) @desktop`, async ({ page }) => {
            await page.setViewportSize({ width: 1920, height: 1200 });
            const entry = await visitBuilder(page, route, root, theme);
            const voice = await voiceOf(page);
            const rail = entry.locator(railSelector).first();
            let widest: RailAt | undefined;
            let wider: RailAt | undefined;
            for (const width of WIDTHS) {
                await sizeBuilder(page, entry, root, width);
                const at = await railAt(rail);
                const where = `${builder} at ${width}px`;
                widest ??= at;
                // One line: never wrapped, as tall as at its widest, nothing past its edge.
                expect(at.wrap, where).toBe("nowrap");
                expect(at.height, `${where}: one line`).toBeCloseTo(widest.height, 0);
                expect(at.overflow, where).toBeLessThanOrEqual(1);
                expect(at.outside, `${where}: past the rail's content box`).toEqual([]);
                expect(at.offCentre, `${where}: off the rail's centre line`).toEqual([]);
                expect(at.clipped, `${where}: cut inside its words`).toEqual([]);
                // What the fit weighs never moves with the fit: no item it measures can shrink, but one taking the slack.
                expect(at.shrinking, `${where}: weighed by the fit, yet shrunk by the layout`).toEqual([]);
                // The units its fit cut are the last ones, each hidden whole, and the "…" ends them.
                const kept = at.units.filter((unit) => !unit.cut).length;
                expect(at.units.map((unit) => unit.cut), `${where}: the units cut`).toEqual(at.units.map((_, n) => n >= kept));
                expect(at.seen, `${where}: cut, yet seen`).toEqual([]);
                expect(at.more, `${where}: the "…"`).toBe(kept < at.units.length);
                if (at.more) expect(at.moreVoice, `${where}: the "…" in the footer's voice`).toEqual(voice);
                if (at.units.length > 0) expect(kept, `${where}: a unit kept`).toBeGreaterThan(0);
                // Never more units at a narrower frame holding the same ones.
                if (wider !== undefined && wider.units.map((unit) => unit.text).join("\n") === at.units.map((unit) => unit.text).join("\n")) {
                    expect(kept, `${where}: more units than the wider frame's`).toBeLessThanOrEqual(wider.units.filter((unit) => !unit.cut).length);
                }
                // The one loading line: a polite live region, saying nothing and taking no room, in the footer's voice.
                expect(at.lines, where).toBe(1);
                expect(at.line, where).toEqual({
                    idle: true, role: "status", live: "polite", words: "",
                    width: expect.any(Number), height: expect.any(Number),
                    family: voice.family, size: voice.size, numeric: expect.stringContaining("tabular-nums"), color: voice.color,
                });
                expect(at.line!.width, `${where}: the idle line's width`).toBeLessThanOrEqual(1);
                expect(at.line!.height, `${where}: the idle line's height`).toBeLessThanOrEqual(1);
                wider = at;
            }
        });
    }
}
