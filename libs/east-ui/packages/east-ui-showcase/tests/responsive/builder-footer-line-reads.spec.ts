/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The footer's one loading line in flight and failed (#1398, CL3, CL11), in
 * the builders that read what they show a part at a time — the Sheet and the
 * Plan as they scroll, the Calendar, the Roster and the Allocation as they
 * step — on the real in-page e3, its
 * reads held and failed through the showcase's e3 fault hook (`e3-faults.ts`),
 * with the frame 1440, 768, 390 and 360px wide, in both themes, as
 * `builder-footer-line.spec.ts` measures the rail at rest:
 *
 * - While a read is held, the line says what is read, one line in its own slot
 *   at the rail's trailing end: its full text, else its short form, else its
 *   dot alone, each whole, never a word cut, and never a fuller form at a
 *   narrower frame but where the legend itself is cut — then its short form,
 *   the fit's last rule; the rail as tall as at rest, nothing past its edge; its
 *   dot the brand's mark, its words the footer's voice, what it names the
 *   strong ink.
 * - Once a read fails, the line says so at once — its words the danger ink,
 *   its dot `status.neg` — then "· Retry", the brand's link; its floor is the
 *   dot and Retry, "● Retry".
 * - Retry, the fault gone, asks again at once — never held back by the gap a
 *   read alone waits after a failure — and the line goes idle.
 * - On a touch screen Retry is a 44px tap target by its halo, never by a
 *   taller rail: the rail sits at its frame's foot, which clips what passes
 *   it, so the target rises from there — a tap 21px or 29px above Retry's
 *   middle, at the rail's foot, or 21px either side of it, lands on it — at
 *   each width the touch screen's preview box holds.
 *
 * Over the builders and the four widths, each form is seen: the full text,
 * the short form and the dot alone.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { RECORD_READS, failE3, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { token } from "./tokens";

/** How a builder is made to ask for what it has not read yet: its `n`-th new read. */
type Read = (page: Page, entry: Locator, n: number) => Promise<void>;

/** A builder that reads a part at a time, by its example, and how it is made to read. */
interface Reader {
    readonly builder: string;
    readonly route: string;
    /** What the builder's root is, in its entry. */
    readonly root: string;
    /** Its footer's rail. */
    readonly rail: string;
    readonly read: Read;
}

/**
 * A paged builder's scroller sent past what it has read: to its middle, then
 * to its end — the farthest from the start it read as it opened, from the
 * middle and from the windows either side it read ahead.
 */
const scrolled: Read = async (_page, entry, n) => {
    await entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first()
        .evaluate((el, at) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * at; }, n === 0 ? 0.5 : 1);
};

/** A period builder stepped on twice by its toolbar's Next: past the period it read ahead, to one it has not read. */
const stepped: Read = async (_page, entry) => {
    const next = entry.locator("[data-frame-slot='toolbar']").getByRole("button", { name: /^Next (day|week|month)$/ }).first();
    await next.click();
    await next.click();
};

/**
 * The Roster stepped on to the same day two weeks on, past the week it read ahead, to one it has not read: what it reads
 * is the week, whichever view steps it — fourteen steps of its Day view, two of its Week view.
 */
const steppedTwoWeeks: Read = async (_page, entry) => {
    const next = entry.locator("[data-frame-slot='toolbar']").getByRole("button", { name: /^Next (day|week)$/ }).first();
    const name = (await next.getAttribute("aria-label")) ?? (await next.textContent()) ?? "";
    for (let step = 0, steps = name.endsWith("day") ? 14 : 2; step < steps; step++) await next.click();
};

const READERS: readonly Reader[] = [
    { builder: "Sheet", route: "e3/sheet/sheet-records/sheetRecordIndexes", root: "[data-builder-frame]", rail: "[data-frame-slot='footer'] [data-slot='footer']", read: scrolled },
    { builder: "Plan", route: "e3/plan/plan-windows/planWindows", root: "[data-plan-frame]", rail: "[data-frame-slot='footer'] [data-slot='footer']", read: scrolled },
    { builder: "Calendar", route: "e3/calendar/calendar/calendarOperations", root: "[data-calendar-frame]", rail: "[data-calendar-footer]", read: stepped },
    { builder: "Roster", route: "e3/roster/roster/rosterWindowed", root: "[data-roster-frame]", rail: "[data-roster-footer]", read: steppedTwoWeeks },
    { builder: "Allocation", route: "e3/allocation/allocation/allocationKilnYard", root: "[data-allocation-frame]", rail: "[data-allocation-footer]", read: stepped },
];

/** The frame's widths, widest first. */
const WIDTHS = [1440, 768, 390, 360] as const;

/** The page: wide enough that a 1440px frame keeps clear of the doc column's "On this page" beside it. */
const PAGE = { width: 2560, height: 1200 } as const;

/** The widths a touch screen's preview box holds whole: its box clips a frame wider than it, so 1440 is the desktop's alone. */
const TOUCH_WIDTHS = [768, 390, 360] as const;

/** A form's fullness: never fuller at a narrower frame. */
const FULLNESS: Record<string, number> = { full: 2, short: 1, dot: 0 };

/** The colours the line takes, as the page resolves the theme's tokens. */
interface Inks {
    readonly mark: string;
    readonly neg: string;
    readonly muted: string;
    readonly danger: string;
    readonly strong: string;
    readonly link: string;
}

async function inksOf(page: Page): Promise<Inks> {
    return {
        mark: await token(page, "brand-mark"), neg: await token(page, "status-neg"), muted: await token(page, "fg-muted"),
        danger: await token(page, "fg-danger"), strong: await token(page, "fg"), link: await token(page, "brand-solid"),
    };
}

/** A part of the line: whether it shows, whether its words are cut, and its ink. */
interface Part {
    readonly shown: boolean;
    readonly clipped: boolean;
    readonly color: string;
}

/** The rail and its line in flight or failed, as the page lays them out. */
interface LineAt {
    readonly kind: string | null;
    readonly form: string | null;
    readonly failed: boolean;
    readonly role: string | null;
    readonly live: string | null;
    readonly rail: { readonly height: number; readonly wrap: string; readonly overflow: number };
    /** Whether the line sits inside the rail's content box. */
    readonly inside: boolean;
    readonly dot: { readonly width: number; readonly height: number; readonly color: string };
    readonly text: Part;
    readonly short: Part;
    /** The ink of what the full text names, where it names a range or a period. */
    readonly strong: string | null;
    readonly sep: boolean;
    readonly retry: Part | null;
    readonly color: string;
    /** The rail's legend units — or hints, or counts — and how many of them its fit keeps. */
    readonly units: number;
    readonly kept: number;
}

function lineAt(rail: Locator): Promise<LineAt> {
    return rail.evaluate((el): LineAt => {
        const css = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const line = el.querySelector<HTMLElement>(":scope > [data-footer-line]")!;
        const lineBox = line.getBoundingClientRect();
        const part = (selector: string): Part => {
            const node = line.querySelector<HTMLElement>(`:scope > ${selector}`);
            if (node === null) return { shown: false, clipped: false, color: "" };
            const r = node.getBoundingClientRect();
            return { shown: r.width > 1 && r.height > 1, clipped: node.scrollWidth > node.clientWidth + 1, color: getComputedStyle(node).color };
        };
        const dot = line.querySelector<HTMLElement>(":scope > [data-line-dot]")!;
        const dotBox = dot.getBoundingClientRect();
        const strong = line.querySelector<HTMLElement>(":scope > [data-line-text] b");
        const sep = [...line.children].find((child) => child.textContent === "·");
        const retry = line.querySelector(":scope > [data-line-retry]");
        const units = [...el.querySelectorAll(":scope > [data-footer-unit], :scope > [data-footer-units] > [data-footer-unit]")];
        return {
            units: units.length,
            kept: units.filter((unit) => !unit.hasAttribute("data-footer-cut")).length,
            kind: line.getAttribute("data-loading-line"),
            form: line.getAttribute("data-form"),
            failed: line.hasAttribute("data-failed"),
            role: line.getAttribute("role"),
            live: line.getAttribute("aria-live"),
            rail: { height: box.height, wrap: css.flexWrap, overflow: el.scrollWidth - el.clientWidth },
            inside: lineBox.left >= box.left + Number.parseFloat(css.paddingLeft) - 0.5 && lineBox.right <= box.right - Number.parseFloat(css.paddingRight) + 0.5,
            dot: { width: dotBox.width, height: dotBox.height, color: getComputedStyle(dot).backgroundColor },
            text: part("[data-line-text]"),
            short: part("[data-line-short]"),
            strong: strong === null ? null : getComputedStyle(strong).color,
            sep: sep !== undefined && sep.getBoundingClientRect().width > 0,
            retry: retry === null ? null : part("[data-line-retry]"),
            color: getComputedStyle(line).color,
        };
    });
}

/** The rail's height at rest: one line, as `builder-footer-line.spec.ts` holds it. */
function railHeight(rail: Locator): Promise<number> {
    return rail.evaluate((el) => el.getBoundingClientRect().height);
}

/** What is wrong with the line at a width, in words. */
function faults(at: LineAt, rest: number, inks: Inks, failed: boolean): string[] {
    const bad: string[] = [];
    if (at.kind !== (failed ? "failed" : "loading")) bad.push(`its kind is ${at.kind}`);
    if (at.role !== "status" || at.live !== "polite") bad.push(`role ${at.role}, aria-live ${at.live}`);
    if (at.rail.wrap !== "nowrap" || Math.abs(at.rail.height - rest) > 0.5) bad.push(`the rail ${at.rail.height}px tall, ${at.rail.wrap}, at rest ${rest}px`);
    if (at.rail.overflow > 1) bad.push(`the rail overflows by ${at.rail.overflow}px`);
    if (!at.inside) bad.push("the line runs past the rail's content box");
    if (Math.round(at.dot.width) !== 8 || Math.round(at.dot.height) !== 8) bad.push(`its dot ${at.dot.width}×${at.dot.height}`);
    if (at.dot.color !== (failed ? inks.neg : inks.mark)) bad.push(`its dot ${at.dot.color}`);
    if (at.color !== inks.muted) bad.push(`its voice ${at.color}`);
    switch (at.form) {
        case "full":
            if (!at.text.shown || at.text.clipped) bad.push(`its full text ${at.text.shown ? "cut" : "hidden"}`);
            if (at.short.shown) bad.push("its short form shown beside its full text");
            if (failed ? at.text.color !== inks.danger : at.strong !== null && at.strong !== inks.strong) bad.push(`its words ${at.text.color}, what they name ${at.strong}`);
            break;
        case "short":
            if (!at.short.shown || at.short.clipped) bad.push(`its short form ${at.short.shown ? "cut" : "hidden"}`);
            if (at.text.shown) bad.push("its full text shown beside its short form");
            if (failed && at.short.color !== inks.danger) bad.push(`its short form ${at.short.color}`);
            break;
        case "dot":
            if (at.text.shown || at.short.shown) bad.push("words shown beside its dot alone");
            break;
        default:
            bad.push(`its form is ${at.form}`);
    }
    if (failed) {
        if (at.retry === null || !at.retry.shown || at.retry.clipped) bad.push("no whole Retry");
        else if (at.retry.color !== inks.link) bad.push(`its Retry ${at.retry.color}`);
        if (at.sep !== (at.form !== "dot")) bad.push(`its "·" ${at.sep ? "shown" : "hidden"} in its ${at.form} form`);
    } else if (at.retry !== null) bad.push("a Retry while nothing failed");
    return bad;
}

/** A read the fault hook fails: as e3 answers one it cannot serve. */
const FAILURE = { status: 500, type: "internal", message: "the store is down" } as const;

/**
 * Each tap on Retry's 44px target that lands on anything but Retry: 21px and
 * 29px above its middle, at the rail's foot — the frame's foot, which clips
 * what passes it, so the target rises from there — and 21px before and after
 * its middle.
 */
function missedTaps(retry: Locator): Promise<string[]> {
    return retry.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const foot = el.closest("[data-footer-line]")!.parentElement!.getBoundingClientRect().bottom;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const name = (node: Element | null) => node === null ? "nothing" : `${node.tagName.toLowerCase()}${[...node.attributes].map((a) => `[${a.name}]`).join("")}`;
        const taps = [[x, y - 21, "21px above its middle"], [x, y - 29, "29px above its middle"], [x, foot - 1, "at the rail's foot"],
            [x - 21, y, "21px before its middle"], [x + 21, y, "21px after its middle"]] as const;
        return taps.flatMap(([px, py, where]) => {
            const hit = document.elementFromPoint(px, py);
            return hit !== null && el.contains(hit) ? [] : [`a tap ${where} lands on ${name(hit)}`];
        });
    });
}

for (const theme of ["light", "dark"] as const) {
    test(`each builder's loading line, held in flight and then failed, says what it reads in one line that fits whole at every width — full, short or the dot alone — then "Couldn't read · Retry", Retry asking again (#1398, CL3, CL11) (${theme}) @desktop`, async ({ page }) => {
        // Five builders, each held and failed at four widths, on one e3 the page starts once. The page is wide enough
        // that a 1440px frame keeps clear of its "On this page" column.
        test.setTimeout(480_000);
        await installE3Faults(page);
        await page.setViewportSize(PAGE);
        const seen = new Set<string>();
        let inks: Inks | undefined;
        for (const [i, reader] of READERS.entries()) {
            await test.step(reader.builder, async () => {
                const entry = await visitBuilder(page, reader.route, reader.root, i === 0 ? theme : undefined);
                inks ??= await inksOf(page);
                const rail = entry.locator(reader.rail).first();
                const line = rail.locator(":scope > [data-footer-line]");
                const rest = await railHeight(rail);
                for (const failed of [false, true]) {
                    await sizeBuilder(page, entry, reader.root, WIDTHS[0]);
                    const rule = failed ? await failE3(page, { kinds: [...RECORD_READS] }, FAILURE) : await holdE3(page, { kinds: [...RECORD_READS] });
                    await reader.read(page, entry, failed ? 1 : 0);
                    await expect(line).toHaveAttribute("data-loading-line", failed ? "failed" : "loading");
                    let wider: number | undefined;
                    for (const width of WIDTHS) {
                        await sizeBuilder(page, entry, reader.root, width, { holding: true });
                        const at = await lineAt(rail);
                        const where = `${reader.builder} ${failed ? "failed" : "in flight"} at ${width}px`;
                        expect(faults(at, rest, inks!, failed), where).toEqual([]);
                        // Never a fuller form at a narrower frame — but where even the dot leaves the legend no room, the
                        // legend ends at a whole item and the line takes its short form (the fit's last rule).
                        const fullness = FULLNESS[at.form ?? ""] ?? -1;
                        if (wider !== undefined && fullness > wider) {
                            expect({ form: at.form, legendCut: at.kept < at.units }, `${where}: a fuller form than the wider frame's`).toEqual({ form: "short", legendCut: true });
                        }
                        wider = fullness;
                        seen.add(at.form ?? "");
                    }
                    await releaseE3(page, rule);
                    // Released, the held read lands; the fault gone, Retry asks again. Either way the line goes idle.
                    if (failed) await line.locator("[data-line-retry]").click();
                    await expect(line).toHaveAttribute("data-idle", "", { timeout: 30_000 });
                }
            });
        }
        expect([...seen].sort(), "the forms seen over the builders and widths").toEqual(["dot", "full", "short"]);
    });

    test(`on a touch screen, a failed read's Retry in each builder's footer is a 44px tap target by its halo, the rail as tall as at rest (#1398, CL11) (${theme}) @mobile`, async ({ page }) => {
        test.setTimeout(480_000);
        await installE3Faults(page);
        await page.setViewportSize(PAGE);
        for (const [i, reader] of READERS.entries()) {
            await test.step(reader.builder, async () => {
                const entry = await visitBuilder(page, reader.route, reader.root, i === 0 ? theme : undefined);
                const rail = entry.locator(reader.rail).first();
                const line = rail.locator(":scope > [data-footer-line]");
                const rest = await railHeight(rail);
                await sizeBuilder(page, entry, reader.root, TOUCH_WIDTHS[0]);
                const fault = await failE3(page, { kinds: [...RECORD_READS] }, FAILURE);
                await reader.read(page, entry, 1);
                await expect(line).toHaveAttribute("data-failed", "");
                for (const width of TOUCH_WIDTHS) {
                    await sizeBuilder(page, entry, reader.root, width, { holding: true });
                    const where = `${reader.builder} at ${width}px`;
                    expect(await railHeight(rail), `${where}: the rail's height`).toBeCloseTo(rest, 0);
                    // A tall builder's footer sits below the page's fold: brought into view, as a finger would scroll to it.
                    const retry = line.locator("[data-line-retry]");
                    await retry.scrollIntoViewIfNeeded();
                    expect(await missedTaps(retry), where).toEqual([]);
                }
                await releaseE3(page, fault);
                await line.locator("[data-line-retry]").tap();
                await expect(line).toHaveAttribute("data-idle", "", { timeout: 30_000 });
            });
        }
    });
}
