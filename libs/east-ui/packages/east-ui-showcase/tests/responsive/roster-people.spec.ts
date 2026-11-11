/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/**
 * The Roster's People layout by week and by month (#1406) against the real
 * in-page e3: the grids at every width, each row one line at the density's
 * pitch; the tiles in the shifts' colour tokens and the ink the shade takes;
 * a pattern dropped on a person's row, saved through e3 and read back after
 * a remount; a month not read drawn at once with its placeholders, the
 * months either side read ahead (#1398); both densities; a month's marks
 * drawing a longer code's first letter alone, none cut at any width in either
 * density (#1569); and the work requirement (#1568) at every width — by week
 * its eyebrow and lanes, each day's figures whole over its bar inside its
 * cell; by month each lane's marks cups filled to their hours rostered of
 * needed, holding their figures whole, and a cup nothing fills — a lane's or
 * a skill row's — closed along its bottom; on a phone
 * each band's day cards, a line its shift's swatch, label and figures on one
 * row over its bar, every word whole, and on a touch screen each line a 44px
 * target.
 */
import { expect, type Locator, type Page } from "playwright/test";
import { PatchType, SortedMap, StringType, compareFor, diffFor, encodeBeast2For } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { test } from "./kept-page";
import { toolbarFaults } from "./builder-frame";
import { leaveBuilder } from "./builder-page";
import { RECORD_READS, holdE3, installE3Faults, mutateE3, releaseE3 } from "./e3-faults";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";
const FILE = "e3/roster/roster";
async function open(page: Page, name: string, theme: "light" | "dark") {
    await page.goto(`/?theme=${theme}#${FILE}/${name}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-roster-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page); return entry;
}
async function size(page: Page, entry: Locator, width: number, holding = false) {
    await entry.locator("[data-roster-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page, { holding });
}
async function closeInspector(frame: Locator) {
    const collapse = frame.getByRole("button", { name: "Collapse Inspector" });
    if (await collapse.isVisible()) await collapse.click();
}
/** The Roster's example unmounted and mounted again, what it shows read back from e3. */
async function remount(page: Page, name: string) {
    await leaveBuilder(page);
    await page.evaluate(({ file, name }) => { location.hash = `#${file}/${name}`; }, { file: FILE, name });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded(); await expect(entry.locator("[data-roster-frame]").first()).toBeVisible();
    return entry.locator("[data-roster-frame]").first();
}
/** The theme's token as the page resolves it. */
const resolve = (page: Page, property: "color" | "backgroundColor", token: string) => page.evaluate(({ property, token }) => {
    const probe = document.createElement("span");
    probe.style[property] = `var(${token})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe)[property];
    probe.remove();
    return resolved;
}, { property, token });
/** Each mounted People row's height, rounded. */
const rowHeights = (frame: Locator) => frame.locator("[data-roster-person-row]").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
/** Each day cell's live tile label in a row: the shift, or null for a day off. */
const rowLabels = (row: Locator) => row.locator("[data-roster-person-day]").evaluateAll(cells => cells.map(c => c.querySelector("[data-roster-tile]:not([data-removed]) [data-roster-assignment-name]")?.textContent ?? null));
/** The last row main's list has mounted, by its key: a person's row or card by theirs, the requests' by its own. */
const footOf = (main: Locator) => main.locator("[data-virtual-rows]").first().evaluate((el) => {
    const items = [...el.querySelectorAll("[data-index]")].sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")));
    const foot = items.at(-1);
    return foot?.querySelector("[data-roster-person-row]")?.getAttribute("data-roster-person-row")
        ?? foot?.querySelector("[data-roster-person-card]")?.getAttribute("data-roster-person-card") ?? null;
});
/**
 * What the requests' row draws where it doesn't belong: a tile outside its day, a tile naming no group, a group's name
 * cut by its tile, or a day's `+n` outside it. None may be.
 */
const requestFaults = (row: Locator) => row.locator("[data-roster-person-day]").evaluateAll(cells => cells.flatMap((cell) => {
    const at = cell.getAttribute("data-roster-person-day"), day = cell.getBoundingClientRect();
    const outside = (box: DOMRect, holder: DOMRect) => box.left < holder.left - 0.5 || box.right > holder.right + 0.5 || box.top < holder.top - 0.5 || box.bottom > holder.bottom + 0.5;
    const tiles = [...cell.querySelectorAll("[data-roster-tile]")].flatMap((tile) => {
        const box = tile.getBoundingClientRect(), group = tile.querySelector("[data-group]");
        return [
            ...outside(box, day) ? [`a tile outside ${at}`] : [],
            ...group === null ? [`a tile naming no group in ${at}`] : outside(group.getBoundingClientRect(), box) ? [`"${group.textContent}" cut in ${at}`] : [],
        ];
    });
    return [...tiles, ...[...cell.querySelectorAll("[data-roster-more]")].flatMap(more => outside(more.getBoundingClientRect(), day) ? [`"${more.textContent}" outside ${at}`] : [])];
}));
/** The shifts' colour tokens, as the warehouse seeds them (teal 300, orange 300, purple 700), and the ink each shade takes. */
const SHIFTS = [["Early", "teal-300", "gray-900"], ["Late", "orange-300", "gray-900"], ["Night", "purple-700", "white"]] as const;
/**
 * What a part — a header, an eyebrow, a lane, a card — draws of its words that is cut or crowded (the hand retest, R3):
 * each element's words — its own text, whole, when it is not hidden and is laid out — cut by a box of the part that
 * clips them, or, as far as they show, on a line with another's closer than a pixel. Measured from the words' own box,
 * so an ellipsis is a cut.
 */
const wordFaults = (part: Locator) => part.evaluate((root) => {
    const faults: string[] = [];
    const shown: { text: string; left: number; right: number; top: number; bottom: number }[] = [];
    for (const el of [root, ...root.querySelectorAll("*")]) {
        const texts = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
        if (texts.length === 0 || getComputedStyle(el).visibility !== "visible") continue;
        const range = document.createRange();
        range.setStartBefore(texts[0]!);
        range.setEndAfter(texts[texts.length - 1]!);
        const box = range.getBoundingClientRect();
        if (box.width === 0) continue;
        const text = texts.map((node) => node.textContent ?? "").join("").trim();
        let left = box.left, right = box.right, cut = false;
        for (let clip: Element | null = el; clip !== null && clip !== root.parentElement; clip = clip.parentElement) {
            if (getComputedStyle(clip).overflowX === "visible") continue;
            const edge = clip.getBoundingClientRect();
            if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5) cut = true;
            left = Math.max(left, edge.left);
            right = Math.min(right, edge.right);
        }
        if (cut) faults.push(`"${text}" is cut`);
        if (right > left) shown.push({ text, left, right, top: box.top, bottom: box.bottom });
    }
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i]!, b = shown[j]!;
        if (a.top >= b.bottom || b.top >= a.bottom) continue;
        if (Math.max(a.left, b.left) - Math.min(a.right, b.right) < 1) faults.push(`"${a.text}" touches "${b.text}"`);
    }
    return faults;
});
/** The warehouse's shift codes made three letters long, each first letter another than its one-letter code (#1569). */
const LONG_CODES: Readonly<Record<string, string>> = { E: "MOR", L: "AFT", N: "OVN" };
/**
 * Makes the warehouse's shift codes three letters long, as another session would: each shift's code from
 * {@link LONG_CODES}, patched in through the shift times' patch door.
 */
async function lengthenCodes(page: Page): Promise<void> {
    const { type, name, default: seeded } = ex.rosterShiftTimes;
    if (seeded === undefined) throw new Error("the warehouse's shift times are seeded");
    const before = new SortedMap(seeded, compareFor(StringType));
    const after = new SortedMap([...before].map(([key, shift]) => [key, { ...shift, code: LONG_CODES[shift.code] ?? shift.code }] as const), compareFor(StringType));
    await mutateE3(page, "roster", name, "patch", [encodeBeast2For(PatchType(type))(diffFor(type)(before, after))]);
}
/**
 * What a month's lettered marks draw that is more than a letter, or cut (#1569): each duty's mark whose letter shows —
 * one grapheme, its shift's code's first — measured from its text's own box against the mark's, which clips it.
 */
const markFaults = (frame: Locator) => frame.locator("[data-roster-mark][data-shift]").evaluateAll((marks) => {
    const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const faults = new Set<string>();
    let lettered = 0;
    for (const mark of marks) {
        const text = mark.textContent ?? "";
        if (text === "") continue;
        lettered += 1;
        if ([...graphemes.segment(text)].length !== 1) faults.add(`"${text}" is more than a letter`);
        const range = document.createRange();
        range.selectNodeContents(mark);
        const box = range.getBoundingClientRect(), edge = mark.getBoundingClientRect();
        if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5) faults.add(`"${text}" is cut`);
    }
    return { lettered, faults: [...faults] };
});
/**
 * What a lane's days draw wrongly by week (#1568, A3.3): a day's figures, or its `no target`, wider than its line or
 * outside its cell's padding, or figures with no bar under them inside the cell. Over the lanes mounted in `scope`.
 */
const laneDayFaults = (scope: Locator) => scope.locator("[data-roster-lane] [data-roster-lane-day]").evaluateAll(cells => cells.flatMap((cell) => {
    const at = cell.getAttribute("data-roster-lane-day"), box = cell.getBoundingClientRect(), css = getComputedStyle(cell);
    const left = box.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft), right = box.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight);
    const inside = (el: Element) => { const r = el.getBoundingClientRect(); return r.left >= left - 0.5 && r.right <= right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5; };
    const part = cell.querySelector<HTMLElement>("[data-roster-lane-figures], [data-roster-lane-none]"), bar = cell.querySelector("[data-roster-lane-bar]");
    if (part === null) return [`${at} shows neither figures nor no target`];
    return [
        ...part.scrollWidth > part.clientWidth ? [`${at}: "${part.textContent}" is wider than its line`] : [],
        ...!inside(part) ? [`${at}: "${part.textContent}" is outside its cell`] : [],
        ...!part.hasAttribute("data-roster-lane-figures") ? [] : bar === null ? [`${at}: no bar under "${part.textContent}"`]
            : !inside(bar) || bar.getBoundingClientRect().top < part.getBoundingClientRect().bottom - 0.5 ? [`${at}: its bar is not under its figures inside its cell`] : [],
    ];
}));
/**
 * What a lane's marks draw wrongly by month (#1568, A3.5): a mark's figure whose text leaves its mark; and a cup (ruled
 * 8 Nov 2026) not filled to its hours rostered of needed as its label says them — its hours needed less what its slots are short, where its label
 * says they are (K4) — full at them, within a pixel — its parts across its width, each
 * standing on the one under it from its bottom up — or whose open part is not from its top down to the fill, or is
 * drawn on a day not short. Over the marks mounted in `scope`, with how many show a figure and how many cups draw each
 * part.
 */
const laneMarkFaults = (scope: Locator) => scope.locator("[data-roster-lane-mark]").evaluateAll((marks) => {
    const faults = new Set<string>(), parts: Record<string, number> = {};
    let said = 0;
    for (const mark of marks) {
        const edge = mark.getBoundingClientRect(), at = mark.getAttribute("data-roster-lane-mark");
        const figure = mark.querySelector("[data-roster-mark-figure]");
        if (figure !== null) {
            said += 1;
            const range = document.createRange();
            range.selectNodeContents(figure);
            const box = range.getBoundingClientRect();
            if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5 || box.top < edge.top - 0.5 || box.bottom > edge.bottom + 0.5) faults.add(`"${figure.textContent}" leaves its mark`);
        }
        const [, rostered, needed, by, side] = /: (.+?) of (.+?) hours rostered(?:, (.+) (short|over))?$/u.exec(mark.getAttribute("aria-label") ?? "") ?? [];
        const hours = (text: string) => Number(text.replace(/,/gu, ""));
        const met = side === "short" ? hours(needed!) - hours(by!) : hours(rostered ?? "0");
        const share = rostered === undefined || needed === undefined || hours(needed) <= 0 ? 0 : Math.min(met / hours(needed), 1);
        let top = edge.bottom, open = false;
        for (const part of mark.querySelectorAll("[data-roster-cup-part]")) {
            const kind = part.getAttribute("data-roster-cup-part")!, box = part.getBoundingClientRect();
            parts[kind] = (parts[kind] ?? 0) + 1;
            if (Math.abs(box.left - edge.left) > 0.5 || Math.abs(box.right - edge.right) > 0.5) faults.add(`${at}: its ${kind} part is not across its cup`);
            if (kind === "open") {
                open = true;
                if (Math.abs(box.top - edge.top) > 0.5 || Math.abs(box.bottom - top) > 0.5) faults.add(`${at}: what it lacks is not open from its top down to its fill (${box.top - edge.top}px below its top, ${box.bottom - top}px past its fill)`);
                // Its dashed edge is drawn inside it: clipped to it, a gap thinner than the dashes draws none of them over the fill.
                if (getComputedStyle(part).overflow !== "hidden") faults.add(`${at}: what it lacks draws its edge past its own box`);
                // Over a fill its edge stops at the gap under it: no dashes along the fill, none through the gap.
                const dashes = getComputedStyle(part, "::before");
                if (part.previousElementSibling?.hasAttribute("data-roster-cup-part") && (dashes.borderBottomWidth !== "0px" || dashes.bottom !== "1px")) faults.add(`${at}: what it lacks draws its dashes along or through the gap over its fill`);
            } else {
                if (Math.abs(box.bottom - top) > 0.5) faults.add(`${at}: its ${kind} part does not stand on the part under it`);
                top = box.top;
            }
        }
        if (Math.abs(edge.bottom - top - share * edge.height) > 1) faults.add(`${at}: filled ${edge.bottom - top}px of ${edge.height}px for ${rostered} of ${needed} hours`);
        if (open !== (mark.getAttribute("data-state") === "short")) faults.add(`${at}: ${open ? "open" : "not open"} on a day ${mark.getAttribute("data-state")}`);
    }
    return { said, parts, faults: [...faults] };
});
/**
 * What a month's cup nothing fills leaves open at its bottom (#1568): a short day's cup with nothing rostered — a
 * skill row's, nothing assigned — is what it lacks whole, and its dashed edge, drawn inside that part and clipped to it,
 * closes along the cup's bottom too, round its corners as the cup's (ruled 9 Nov 2026). Over the lanes' and the skill
 * rows' cups mounted in `scope`, with how many of each nothing fills.
 */
const emptyCupFaults = (scope: Locator) => scope.locator("[data-roster-lane-mark], [data-roster-lane-skill-mark]").evaluateAll((marks) => {
    const faults: string[] = [], empty = { lanes: 0, skills: 0 };
    for (const mark of marks) {
        const open = mark.querySelector('[data-roster-cup-part="open"]');
        if (open === null || mark.querySelector('[data-roster-cup-part]:not([data-roster-cup-part="open"])') !== null) continue;
        const skill = mark.hasAttribute("data-roster-lane-skill-mark");
        if (skill) empty.skills += 1;
        else empty.lanes += 1;
        const at = mark.getAttribute(skill ? "data-roster-lane-skill-mark" : "data-roster-lane-mark");
        const cup = mark.getBoundingClientRect(), part = open.getBoundingClientRect(), edge = getComputedStyle(open, "::before");
        // The dashed edge's bottom, where its inset puts it: inside the part, which clips it, at the cup's bottom.
        const bottom = part.bottom - parseFloat(edge.bottom), round = getComputedStyle(mark).borderBottomLeftRadius;
        if (Math.abs(part.bottom - cup.bottom) > 0.5 || bottom > part.bottom + 0.5 || edge.borderBottomStyle !== "dashed" || parseFloat(edge.borderBottomWidth) < 1) {
            faults.push(`${at}: nothing fills it, and its dashed edge leaves its bottom open`);
        } else if (edge.borderBottomLeftRadius !== round || edge.borderBottomRightRadius !== round) {
            faults.push(`${at}: its dashed edge's bottom corners are not the cup's ${round}`);
        }
    }
    return { empty, faults };
});
/**
 * What the work requirement's block of day cards draws wrongly on a phone (#1568): its eyebrow not 28px, its heading
 * and the week's hours not on its one line inside its padding; a card outside main; a line whose shift's swatch, label
 * and figures — or `no target` — are not on one row, in that order, inside its padding, or whose figures are wider than
 * their line; figures with no bar under them, or a bar not spanning the line's padding.
 */
const dayCardFaults = (block: Locator) => block.evaluate((root) => {
    const faults: string[] = [];
    const padded = (el: Element) => { const r = el.getBoundingClientRect(), css = getComputedStyle(el); return { height: r.height, start: r.left + parseFloat(css.paddingLeft), end: r.right - parseFloat(css.paddingRight) }; };
    const middle = (r: DOMRect) => (r.top + r.bottom) / 2;
    const head = padded(root.querySelector("[data-roster-demand-head]")!);
    const heading = root.querySelector("[data-roster-demand-head] [data-roster-demand-heading]")!.getBoundingClientRect(), total = root.querySelector("[data-roster-demand-total]")!.getBoundingClientRect();
    if (Math.round(head.height) !== 28) faults.push(`its eyebrow is ${head.height}px tall`);
    if (Math.abs(middle(heading) - middle(total)) > 1) faults.push("its heading and the week's hours are not on one line");
    if (heading.left < head.start - 0.5 || total.right > head.end + 0.5 || heading.right > total.left + 0.5) faults.push("its heading and the week's hours are not apart inside its padding");
    const main = root.closest("[data-roster-main]")!.getBoundingClientRect();
    for (const card of root.querySelectorAll("[data-roster-demand-card]")) {
        const at = card.getAttribute("data-roster-demand-card"), box = card.getBoundingClientRect();
        if (box.left < main.left - 0.5 || box.right > main.right + 0.5) faults.push(`${at} is outside main`);
        for (const line of card.querySelectorAll("[data-roster-lane-day]")) {
            const name = line.getAttribute("data-roster-lane-day"), r = padded(line);
            const [swatch, label] = [...line.children], part = line.querySelector<HTMLElement>("[data-roster-lane-figures], [data-roster-lane-none]");
            if (swatch === undefined || label === undefined || part === null) { faults.push(`${name} is not a swatch, a label and figures`); continue; }
            const row = [swatch, label, part].map(el => el.getBoundingClientRect());
            const middles = row.map(middle), bottom = Math.max(...row.map(b => b.bottom));
            if (Math.max(...middles) - Math.min(...middles) > 1) faults.push(`${name}: its swatch, label and figures are not on one row`);
            if (row[0]!.left < r.start - 0.5 || row[0]!.right > row[1]!.left + 0.5 || row[1]!.right > row[2]!.left + 0.5 || row[2]!.right > r.end + 0.5) faults.push(`${name}: its swatch, label and figures are not in order inside its padding`);
            if (part.scrollWidth > part.clientWidth) faults.push(`${name}: "${part.textContent}" is wider than its line`);
            const bar = line.querySelector("[data-roster-lane-bar]")?.getBoundingClientRect();
            if (part.hasAttribute("data-roster-lane-figures") && bar === undefined) faults.push(`${name}: no bar under its figures`);
            if (bar !== undefined && (bar.top < bottom - 0.5 || Math.abs(bar.left - r.start) > 0.5 || Math.abs(bar.right - r.end) > 0.5)) faults.push(`${name}: its bar is not under its row across its padding`);
        }
    }
    return faults;
});
/**
 * Each tap that misses a phone's day card line (#1568) on a touch screen, a 44px target by its halo: 21px above and below
 * its middle, and at its two ends. Over the lines of `card`, which must be in view.
 */
const missedLineTaps = (card: Locator) => card.locator("[data-roster-lane-day]").evaluateAll(lines => lines.flatMap((line) => {
    const r = line.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const name = (node: Element | null) => node === null ? "nothing" : `${node.tagName.toLowerCase()}${[...node.attributes].filter(a => a.name.startsWith("data-")).map(a => `[${a.name}="${a.value}"]`).join("")}`;
    const taps = [[x, y - 21, "21px above its middle"], [x, y + 21, "21px below its middle"], [r.left + 2, y, "at its start"], [r.right - 2, y, "at its end"]] as const;
    return taps.flatMap(([px, py, where]) => {
        const hit = document.elementFromPoint(px, py);
        return hit !== null && line.contains(hit) ? [] : [`a tap ${where} on ${line.getAttribute("data-roster-lane-day")} lands on ${name(hit)}`];
    });
}));
/**
 * How the parts of a week's lane bars or a month's lane cups are divided: for each part after its first, the seam on the
 * side that faces the part before it — the border on its left in a bar; in a cup, whose parts stack from the bottom up, the
 * shadow inside its bottom, which leaves a part thinner than the seam its own height.
 */
const partSeams = (scope: Locator, parts: string, parent: string, edge: "Left" | "Bottom") => scope.locator(parent).evaluateAll((els, { parts, edge }) => els.flatMap(el => [...el.querySelectorAll(parts)].slice(1).map((part) => {
    const css = getComputedStyle(part);
    return edge === "Left" ? `${css.borderLeftWidth} ${css.borderLeftStyle} ${css.borderLeftColor}` : css.boxShadow;
})), { parts, edge });
/** Scrolls main's rows on, a step at a time, until `found` holds something: whatever a virtual list has not mounted yet. */
async function untilMounted(page: Page, main: Locator, found: Locator): Promise<void> {
    for (let step = 0; step < 40 && await found.count() === 0; step++) {
        await main.locator("[data-virtual-rows]").first().evaluate((el) => { el.scrollTop += Math.round(el.clientHeight * 0.7); });
        await settled(page);
    }
}

for (const theme of LAYOUT_THEMES) {
    test(`People week and month fit 1440/1024/768/390/360 and a 294px parent: a row one line at the density's pitch, a 36px header, seven marks a cell lettered by the 13px rule, and the phone's cards by week alone (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        for (const name of ["rosterPeople", "rosterPeopleMonth"] as const) {
            const entry = await open(page, name, theme), frame = entry.locator("[data-roster-frame]").first();
            for (const width of [1440, 1024, 768, 390, 360, 294]) {
                await size(page, entry, width);
                expect(await toolbarFaults(frame), `${name} ${width}px`).toEqual([]);
                const main = frame.locator("[data-roster-main]");
                const mainWidth = await main.evaluate(el => el.getBoundingClientRect().width);
                if (mainWidth < 480) {
                    // The phone's cards, by week alone (P31): no grid, no drag source or target, no month cell.
                    await expect(main.locator('[data-roster-agenda="people"]'), `${name} ${width}px`).toBeVisible();
                    await expect(frame.locator('[data-draggable], [aria-roledescription="draggable"], [data-roster-person-day], [data-roster-person-week]')).toHaveCount(0);
                    expect(await main.evaluate(el => el.scrollWidth - el.clientWidth), `${name} ${width}px`).toBeLessThanOrEqual(1);
                    continue;
                }
                const heights = await rowHeights(frame);
                expect(heights.length, `${name} ${width}px rows`).toBeGreaterThan(0);
                expect(new Set(heights), `${name} ${width}px row pitch`).toEqual(new Set([36]));
                if (name === "rosterPeople") {
                    await expect(main.locator('[data-roster-grid="people"]')).toBeVisible();
                    const heads = frame.locator("[data-roster-people-head] [data-roster-column-header]");
                    await expect(heads).toHaveCount(7);
                    expect(await heads.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)))).toEqual(Array(7).fill(36));
                    expect(await frame.locator("[data-roster-people-head]").evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(37);
                    // A tile is 24px, inside its 36px row.
                    const tiles = await frame.locator("[data-roster-tile]").evaluateAll(els => els.slice(0, 20).map(el => Math.round(el.getBoundingClientRect().height)));
                    expect(tiles.length).toBeGreaterThan(0);
                    expect(new Set(tiles)).toEqual(new Set([24]));
                } else {
                    await expect(main.locator('[data-roster-grid="people-month"]')).toBeVisible();
                    await expect(frame.locator("[data-roster-week-column]")).toHaveCount(5);
                    const marks = await frame.locator("[data-roster-person-week]").first().locator("[data-roster-mark]").count();
                    expect(marks, `${name} ${width}px marks a cell`).toBe(7);
                    // The letters follow the 13px rule (P13): every lettered mark at least that wide, none narrower.
                    const lettered = await frame.locator("[data-roster-mark][data-shift]").evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, letter: (el.textContent ?? "").length > 0 })));
                    expect(lettered.length).toBeGreaterThan(0);
                    const wide = lettered.every(mark => mark.width >= 13), narrow = lettered.every(mark => mark.width < 12);
                    if (wide) expect(lettered.every(mark => mark.letter), `${width}px letters shown`).toBe(true);
                    if (narrow) expect(lettered.every(mark => !mark.letter), `${width}px letters hidden`).toBe(true);
                    // No hours in a month's name cells (P16).
                    await expect(frame.locator("[data-roster-week-hours]")).toHaveCount(0);
                }
            }
        }
    });
    test(`People without bands (#1567) fits 1440/1024/768/390/360 and a 294px parent: no band, a row one line at the density's pitch, the requests' row last — its tiles 24px, each naming its group whole inside it — and a phone's cards with the requests' card last (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterPeopleNoBands", theme), frame = entry.locator("[data-roster-frame]").first();
        const main = frame.locator("[data-roster-main]");
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            await expect(main.locator("[data-roster-group]"), `${width}px: no band`).toHaveCount(0);
            // The list's foot: scrolled to its end, the last row — or card — is every group's requests'.
            await main.locator("[data-virtual-rows]").first().evaluate(el => { el.scrollTop = el.scrollHeight; });
            await settled(page);
            await expect(main.locator("[data-roster-group]"), `${width}px: no band at the foot`).toHaveCount(0);
            expect(await footOf(main), `${width}px: the requests' last`).toBe("requests");
            if (await main.evaluate(el => el.getBoundingClientRect().width < 480)) {
                await expect(main.locator('[data-roster-agenda="people"]'), `${width}px`).toBeVisible();
                continue;
            }
            expect(new Set(await rowHeights(frame)), `${width}px row pitch`).toEqual(new Set([36]));
            const requests = main.locator('[data-roster-person-row="requests"]');
            const tiles = await requests.locator("[data-roster-tile]").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
            expect(tiles.length, `${width}px: the requests' tiles`).toBeGreaterThan(0);
            expect(new Set(tiles), `${width}px: a requests' tile`).toEqual(new Set([24]));
            expect(await requestFaults(requests), `${width}px`).toEqual([]);
        }
    });
    test(`the month's header and the week's hold every word whole at 1440/1024/768/390/360 and a 294px parent: no week label, day letter or day number cut or touching another — a day's number only where it fits its day, a week's label dropping its month name first (retest R3) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        for (const name of ["rosterPeopleMonth", "rosterPeople"] as const) {
            const entry = await open(page, name, theme), frame = entry.locator("[data-roster-frame]").first();
            const header = frame.locator(name === "rosterPeopleMonth" ? "[data-roster-month-head]" : "[data-roster-people-head]");
            let measured = 0;
            for (const width of [1440, 1024, 768, 390, 360, 294]) {
                await size(page, entry, width);
                // A phone's People is its cards, by week alone: no header to measure.
                if (await header.count() === 0) continue;
                measured += 1;
                expect(await wordFaults(header), `${name} ${width}px`).toEqual([]);
                if (name === "rosterPeopleMonth") {
                    // Every week keeps its number whole, whatever else its label drops.
                    const labels = await header.locator("[data-roster-week-column]").evaluateAll(els => els.map(el => el.textContent ?? ""));
                    expect(labels.every(label => /W\d+/.test(label)), `${name} ${width}px week numbers`).toBe(true);
                }
            }
            expect(measured, `${name}: a width with its header`).toBeGreaterThan(0);
        }
    });
    test(`a pattern dropped on a person's row previews, replaces the week as one step, saves through e3 and reads back after a remount (D4, P17, P19) (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "Phone People cards use explicit actions.");
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, "rosterPeople", theme); await size(page, entry, 1200);
        const frame = entry.locator("[data-roster-frame]").first();
        await closeInspector(frame); await settled(page);
        const library = frame.locator('[data-frame-slot="start"]');
        const expand = frame.getByRole("button", { name: "Expand Library", exact: true });
        if (await expand.isVisible()) await expand.click();
        await library.getByRole("tab", { name: /^Patterns/ }).click();
        await library.getByRole("textbox", { name: "Search library" }).fill("Forward");
        const card = library.locator('[data-library-item="fwd"]');
        await expect(card).toBeVisible();
        const row = frame.locator("[data-roster-person-row]").filter({ has: page.locator("[data-roster-person-head]") }).first();
        const person = await row.locator("[data-roster-person-head]").getAttribute("data-roster-person-head");
        const target = row.locator("[data-roster-person-day]").nth(2);
        const a = (await card.boundingBox())!;
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 2 });
        await expect(page.locator("[data-drag-ghost]")).toBeVisible(); await settled(page);
        // The panes slide off main while a card is carried: the cell is measured where it rests now.
        await target.hover();
        await expect(target).toHaveAttribute("data-drop-active", "");
        await expect(page.locator("[data-drag-caption]")).toContainText("Forward rotation →");
        await expect(row.locator("[data-roster-person-day][data-pattern-hover]")).toHaveCount(7);
        await expect(row.locator("[data-roster-preview]").first()).toBeVisible();
        await page.mouse.up();
        const expected = ["Early", "Early", "Late", "Late", "Night", null, null];
        await expect.poll(() => rowLabels(row)).toEqual(expected);
        await expect(row.locator("[data-roster-person-name]")).toHaveAttribute("data-selected", "");
        await frame.getByRole("button", { name: "Undo", exact: true }).click();
        await expect(row.locator("[data-roster-tile][data-drafted]")).toHaveCount(0);
        await frame.getByRole("button", { name: "Redo", exact: true }).click();
        await expect.poll(() => rowLabels(row)).toEqual(expected);
        await frame.getByRole("button", { name: "Save", exact: true }).click();
        await expect(frame.locator("[data-roster-tile][data-drafted]")).toHaveCount(0, { timeout: 15_000 });
        const again = await remount(page, "rosterPeople"); await size(page, entry, 1200);
        const rowAgain = again.locator(`[data-roster-person-row="${person}"]`);
        await expect(rowAgain).toBeVisible();
        await expect.poll(() => rowLabels(rowAgain)).toEqual(expected);
    });
    test(`a month not read draws its header, bands, names and placeholder marks at once, the footer's line naming its weeks; the months either side are read ahead, so a step shows the next at once (#1398 on #1406, P26–P28) (${theme}) @desktop`, async ({ page }) => {
        await installE3Faults(page);
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "rosterPeopleMonth", theme); await size(page, entry, 1440);
        const frame = entry.locator("[data-roster-frame]").first();
        const next = frame.locator('[data-frame-slot="toolbar"]').getByRole("button", { name: /^Next /, exact: false });
        const held = await holdE3(page, { kinds: [...RECORD_READS] });
        // The month after, read ahead: shown whole with every read held.
        await next.click();
        await settled(page, { holding: true });
        await expect(frame.locator("[data-roster-week-column]")).toHaveCount(6);
        await expect(frame.locator("[data-roster-unread]")).toHaveCount(0);
        await expect(frame.locator("[data-builder-loading]")).toHaveCount(0);
        // Two months on, not read: the geometry first, a placeholder a mark, never Off, the toolbar live, the line naming the weeks.
        await next.click();
        await settled(page, { holding: true });
        await expect(frame.locator("[data-builder-loading]")).toHaveCount(0);
        await expect(frame.locator("[data-roster-person-row][data-roster-unread]").first()).toBeAttached();
        await expect(frame.locator("[data-roster-person-head]").first()).toBeVisible();
        await expect(frame.locator("[data-roster-mark][data-shift], [data-roster-mark][data-off], [data-roster-tile], [data-roster-assign]")).toHaveCount(0);
        await expect(frame.locator("[data-roster-mark][data-pending]").first()).toBeAttached();
        expect(new Set(await rowHeights(frame))).toEqual(new Set([36]));
        await expect(frame.locator("[data-roster-footer] [data-footer-line]")).toContainText(/W\d+–W\d+/);
        expect(await toolbarFaults(frame)).toEqual([]);
        // Released, the month lands in place: a month the warehouse rosters no one in says Off in every cell, only now (CL13).
        await releaseE3(page, held);
        await expect(frame.locator("[data-roster-unread]")).toHaveCount(0, { timeout: 30_000 });
        await settled(page);
        await expect(frame.locator("[data-roster-mark][data-off]").first()).toBeAttached();
        await expect(frame.locator("[data-roster-mark][data-pending]")).toHaveCount(0);
    });
    test(`compact spacing takes 4px off each People row and tile, by week and by month (P30) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        for (const name of ["rosterPeople", "rosterPeopleMonth"] as const) {
            const entry = await open(page, name, theme), frame = entry.locator("[data-roster-frame]").first();
            await size(page, entry, 1440);
            expect(new Set(await rowHeights(frame))).toEqual(new Set([36]));
            await frame.getByRole("button", { name: "Display", exact: true }).click();
            await page.getByRole("menuitem", { name: "Compact spacing", exact: true }).click();
            await settled(page);
            expect(new Set(await rowHeights(frame))).toEqual(new Set([32]));
            if (name === "rosterPeople") expect(new Set(await frame.locator("[data-roster-tile]").evaluateAll(els => els.slice(0, 20).map(el => Math.round(el.getBoundingClientRect().height))))).toEqual(new Set([20]));
            else expect(new Set(await frame.locator("[data-roster-mark-strip]").evaluateAll(els => els.slice(0, 20).map(el => Math.round(el.getBoundingClientRect().height))))).toEqual(new Set([20]));
            await frame.getByRole("button", { name: "Display", exact: true }).click();
            await page.getByRole("menuitem", { name: "Comfortable spacing", exact: true }).click();
            await settled(page);
            expect(new Set(await rowHeights(frame))).toEqual(new Set([36]));
        }
    });
    test(`a month's marks draw a longer code's first letter alone: MOR, AFT and OVN patched in through e3 draw M, A and O, none cut at 1440/1024/768/390/360 or in a 294px parent, in both densities (#1569) (${theme}) @desktop`, async ({ page }) => {
        await installE3Faults(page);
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterPeopleMonth", theme), frame = entry.locator("[data-roster-frame]").first();
        const month = frame.locator('[data-roster-main] [data-roster-grid="people-month"]');
        await size(page, entry, 1440);
        await lengthenCodes(page);
        // Once the page has heard the codes, each mark draws its code's first letter.
        const letters = async () => new Set((await frame.locator("[data-roster-mark][data-shift]").allTextContents()).filter(text => text !== ""));
        await expect.poll(letters, { timeout: 15_000 }).toEqual(new Set(["M", "A", "O"]));
        for (const density of ["comfortable", "compact"] as const) {
            if (density === "compact") {
                await size(page, entry, 1440);
                await expect(month).toBeVisible();
                await frame.getByRole("button", { name: "Display", exact: true }).click();
                await page.getByRole("menuitem", { name: "Compact spacing", exact: true }).click();
                await settled(page);
                expect(new Set(await rowHeights(frame))).toEqual(new Set([32]));
            }
            let lettered = 0;
            for (const width of [1440, 1024, 768, 390, 360, 294]) {
                await size(page, entry, width);
                // A phone's People is its cards, by week alone: no month to measure.
                if (await month.count() === 0) continue;
                const marks = await markFaults(frame);
                expect(marks.faults, `${density} ${width}px`).toEqual([]);
                lettered += marks.lettered;
            }
            expect(lettered, `${density}: a width whose marks are lettered`).toBeGreaterThan(0);
        }
    });
    test(`the work requirement by week fits 1440/1024/768/390/360 and a 294px parent: its eyebrows 28px, a lane's day its figures whole over its bar inside its cell, no word cut or touching another; on a phone each band's day cards — the eyebrow 28px, its heading and the week's hours on its line, a card a day inside main, a line its shift's swatch, label and figures on one row over its bar, every word whole (#1568) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterWorkRequirement", theme), frame = entry.locator("[data-roster-frame]").first();
        const main = frame.locator("[data-roster-main]");
        let grids = 0, phones = 0;
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const where = `${width}px`;
            if (await main.evaluate(el => el.getBoundingClientRect().width < 480)) {
                phones += 1;
                const block = main.locator("[data-roster-demand-cards]").first();
                await expect(block, where).toBeVisible();
                expect(await main.evaluate(el => el.scrollWidth - el.clientWidth), where).toBeLessThanOrEqual(1);
                await expect(block.locator("[data-roster-demand-card]"), where).toHaveCount(7);
                expect(await dayCardFaults(block), where).toEqual([]);
                expect(await wordFaults(block.locator("[data-roster-demand-head]")), where).toEqual([]);
                for (const card of await block.locator("[data-roster-demand-card]").all()) expect(await wordFaults(card), where).toEqual([]);
                continue;
            }
            grids += 1;
            const eyebrows = main.locator("[data-roster-demand]");
            expect(await eyebrows.count(), where).toBeGreaterThan(0);
            expect(new Set(await eyebrows.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)))), `${where} eyebrows`).toEqual(new Set([28]));
            for (const eyebrow of await eyebrows.all()) expect(await wordFaults(eyebrow), where).toEqual([]);
            const lanes = main.locator("[data-roster-lane]");
            expect(await lanes.count(), where).toBeGreaterThan(0);
            for (const lane of await lanes.all()) expect(await wordFaults(lane), where).toEqual([]);
            expect(await laneDayFaults(main), where).toEqual([]);
        }
        expect(grids, "a width with the grid").toBeGreaterThan(0);
        expect(phones, "a width with the phone's cards").toBeGreaterThan(0);
    });
    test(`the work requirement by month fits 1880/1440/1024/900/768/640: its eyebrows 28px, each week's hours whole in the richest form every week holds — with its unit, without, or rostered over needed — a lane's marks cups filled to their hours, holding their figures whole, a cup nothing fills — a lane's or a skill row's — closed along its bottom, no word cut or touching another (#1568, A3.5) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterWorkRequirement", theme), frame = entry.locator("[data-roster-frame]").first();
        const main = frame.locator("[data-roster-main]");
        await size(page, entry, 1440);
        await frame.locator('[data-frame-slot="toolbar"]').getByRole("radio", { name: "Month", exact: true }).click();
        await settled(page);
        await expect(main.locator('[data-roster-grid="people-month"]')).toBeVisible();
        // The first lane's skill rows open, so their cups are measured beside the lanes'.
        await main.locator("[data-roster-lane-head]").first().click();
        await settled(page);
        await expect(main.locator("[data-roster-lane-skill]").first()).toBeVisible();
        let said = 0;
        const forms = new Set<string | null>(), parts = new Set<string>(), empty = { lanes: 0, skills: 0 };
        // 1880px first: a lane's day is 22px or wider beside the panes only there, so its marks say their figures.
        for (const width of [1880, 1440, 1024, 900, 768, 640]) {
            await size(page, entry, width);
            const where = `${width}px`;
            const eyebrows = main.locator('[data-roster-demand][data-period="month"]');
            expect(await eyebrows.count(), where).toBeGreaterThan(0);
            expect(new Set(await eyebrows.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)))), `${where} eyebrows`).toEqual(new Set([28]));
            // Every week of an eyebrow says its hours in the one form, whole: none goes unsaid at these widths.
            const shown = await eyebrows.evaluateAll(els => els.map(el => el.getAttribute("data-demand-form")));
            expect(shown.filter(form => form === null || form === "none"), where).toEqual([]);
            for (const form of shown) forms.add(form);
            for (const eyebrow of await eyebrows.all()) expect(await wordFaults(eyebrow), where).toEqual([]);
            const lanes = main.locator("[data-roster-lane]");
            expect(await lanes.count(), where).toBeGreaterThan(0);
            for (const lane of await lanes.all()) expect(await wordFaults(lane), where).toEqual([]);
            const marks = await laneMarkFaults(main);
            expect(marks.faults, where).toEqual([]);
            said += marks.said;
            for (const kind of Object.keys(marks.parts)) parts.add(kind);
            const cups = await emptyCupFaults(main);
            expect(cups.faults, where).toEqual([]);
            empty.lanes += cups.empty.lanes;
            empty.skills += cups.empty.skills;
        }
        expect(said, "a width whose lane marks show figures").toBeGreaterThan(0);
        // A week with targets and no one rostered draws cups nothing fills, a lane's and a skill row's.
        expect(empty.lanes, "a lane's cup nothing fills").toBeGreaterThan(0);
        expect(empty.skills, "a skill row's cup nothing fills").toBeGreaterThan(0);
        // The cups in view fill with the permanent staff's hours, and a short day's is open above them.
        expect([...parts].filter(kind => kind === "permanent" || kind === "open").sort()).toEqual(["open", "permanent"]);
        // The widths take the eyebrow through each of its forms.
        expect(forms).toEqual(new Set(["full", "short", "stacked"]));
    });
    test(`on a touch screen each line of a phone's day cards is a 44px target by its halo: a tap 21px above or below its middle, or at either end, lands on it (#1568) (${theme}) @mobile`, async ({ page }) => {
        const entry = await open(page, "rosterWorkRequirement", theme), frame = entry.locator("[data-roster-frame]").first();
        const cards = frame.locator("[data-roster-main] [data-roster-demand-cards]").first().locator("[data-roster-demand-card]");
        await expect(cards).toHaveCount(7);
        let lines = 0;
        for (const card of await cards.all()) {
            await card.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
            await settled(page);
            lines += await card.locator("[data-roster-lane-day]").count();
            expect(await missedLineTaps(card)).toEqual([]);
        }
        expect(lines).toBeGreaterThan(7);
    });
    test(`on a phone a person's card says its issue whole at 390 and 360: the line takes the card's width and wraps, never cut (#1595) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterPeople", theme), frame = entry.locator("[data-roster-frame]").first();
        const main = frame.locator("[data-roster-main]");
        for (const width of [390, 360]) {
            await size(page, entry, width);
            await expect(main.locator('[data-roster-agenda="people"]'), `${width}px`).toBeVisible();
            const flags = main.locator("[data-roster-card] > [data-tone]");
            await untilMounted(page, main, flags);
            expect(await flags.count(), `${width}px: a card saying an issue`).toBeGreaterThan(0);
            const cut = await flags.evaluateAll(els => els.flatMap((el) => {
                const card = el.closest("[data-roster-card]")!.getBoundingClientRect(), box = el.getBoundingClientRect();
                return el.scrollWidth > el.clientWidth + 1 || box.right > card.right + 0.5 ? [`"${el.textContent}" is cut to ${Math.round(box.width)}px of a ${Math.round(card.width)}px card`] : [];
            }));
            expect(cut, `${width}px`).toEqual([]);
        }
    });
    test(`beside a duty's No group badge a People tile's shift is never cut: where the words and the whole name don't both fit the badge is an icon, its words in the tile's tooltip and what a screen reader says (#1595) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterNoGroup", theme), frame = entry.locator("[data-roster-frame]").first();
        const main = frame.locator("[data-roster-main]");
        await size(page, entry, 1440);
        await frame.locator('[data-frame-slot="toolbar"]').getByRole("radio", { name: "People", exact: true }).click();
        await settled(page);
        const forms = new Set<string>();
        for (const width of [1880, 1440, 1200, 1024, 900, 768, 640]) {
            await size(page, entry, width);
            if (await main.locator('[data-roster-agenda="people"]').count() > 0) continue;
            const measured = await main.locator("[data-roster-tile]").evaluateAll((tiles) => {
                const faults: string[] = [], shown: string[] = [];
                let badged = 0;
                for (const tile of tiles) {
                    const badge = tile.querySelector<HTMLElement>("[data-group]");
                    if (badge === null || !(badge.textContent ?? "").includes("NO GROUP")) continue;
                    badged += 1;
                    const name = tile.querySelector<HTMLElement>("[data-roster-assignment-name]")!, range = document.createRange();
                    range.selectNodeContents(name);
                    if (range.getBoundingClientRect().width > name.getBoundingClientRect().width + 0.5) faults.push(`"${name.textContent}" is cut to ${Math.round(name.getBoundingClientRect().width)}px`);
                    const form = badge.getAttribute("data-roster-tile-group");
                    if (form !== null) shown.push(form);
                    if (!(tile.getAttribute("title") ?? "").includes("NO GROUP") || !(tile.getAttribute("aria-label") ?? "").includes("NO GROUP")) faults.push(`"${name.textContent}" says no group in neither its tooltip nor its label`);
                    if (form === "icon" && badge.querySelector("svg") === null) faults.push(`"${name.textContent}": its badge draws no icon`);
                    // The form laid out unseen is measured and takes no room: absolutely placed, it would still widen the grid's scroll on the week's last day.
                    const unseen = badge.querySelector<HTMLElement>(form === "icon" ? '[data-form="words"]' : '[data-form="icon"]');
                    if (unseen !== null && unseen.getBoundingClientRect().width !== 0) faults.push(`"${name.textContent}": its unseen form is ${Math.round(unseen.getBoundingClientRect().width)}px wide`);
                }
                return { badged, faults, shown };
            });
            expect(measured.badged, `${width}px: a tile in no group`).toBeGreaterThan(0);
            expect(measured.faults, `${width}px`).toEqual([]);
            for (const form of measured.shown) forms.add(form);
        }
        expect(forms, "the widths take the badge through both its forms").toEqual(new Set(["words", "icon"]));
    });
}

// A shift's colour token resolves through the theme's palette, the same in both colour modes: a colour of its own, so both themes.
for (const theme of ["light", "dark"] as const) {
    test(`a cup's figure is drawn in one ink, the text colour with a thin outline in the panel's colour, and a 1px gap in the panel's colour divides each part of a week's bar and a month's cup (ruled 9 Nov 2026, #1595) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterWorkRequirement", theme), frame = entry.locator("[data-roster-frame]").first();
        const main = frame.locator("[data-roster-main]");
        await size(page, entry, 1440);
        const panel = await resolve(page, "backgroundColor", "--chakra-colors-bg-panel"), ink = await resolve(page, "color", "--chakra-colors-fg");
        const seam = `1px solid ${panel}`;
        const week = await partSeams(main, ":scope > [data-kind]", "[data-roster-lane-bar]", "Left");
        expect(week.length, "a week's bar of more than one part").toBeGreaterThan(0);
        expect(new Set(week)).toEqual(new Set([seam]));
        await frame.locator('[data-frame-slot="toolbar"]').getByRole("radio", { name: "Month", exact: true }).click();
        await settled(page);
        // 1880px: a lane's day is 22px or wider beside the panes only there, so its marks say their figures.
        await size(page, entry, 1880);
        const month = await partSeams(main, "[data-roster-cup-part]", "[data-roster-lane-mark]", "Bottom");
        expect(month.length, "a month's cup of more than one part").toBeGreaterThan(0);
        expect(new Set(month)).toEqual(new Set([`${panel} 0px -1px 0px 0px inset`]));
        const figures = await main.locator("[data-roster-mark-figure]").evaluateAll(els => [...new Set(els.map((el) => {
            const css = getComputedStyle(el);
            return JSON.stringify({ color: css.color, clip: css.backgroundClip, image: css.backgroundImage, outlined: css.textShadow });
        }))].map(text => JSON.parse(text) as { color: string; clip: string; image: string; outlined: string }));
        expect(figures.length, "a cup says its figure").toBeGreaterThan(0);
        for (const figure of figures) {
            expect([figure.color, figure.clip, figure.image]).toEqual([ink, "border-box", "none"]);
            expect(figure.outlined, "the outline is the panel's colour").toContain(panel);
        }
    });
    test(`tiles take the shifts' colour tokens, their words in the ink the shade takes — the same in both themes (D6, P7) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterPeople", theme), frame = entry.locator("[data-roster-frame]").first();
        await size(page, entry, 1440);
        const tiles = frame.locator('[data-roster-grid="people"] [data-roster-tile]:not([data-removed])');
        expect(await tiles.count()).toBeGreaterThan(0);
        let seen = 0;
        for (const [label, hue, ink] of SHIFTS) {
            const tile = tiles.filter({ has: page.locator(`[data-roster-assignment-name]:text-is("${label}")`) }).first();
            if (await tile.count() === 0) continue;
            seen += 1;
            expect(await tile.evaluate(el => getComputedStyle(el).backgroundColor), `${label}'s fill`).toBe(await resolve(page, "backgroundColor", `--chakra-colors-${hue}`));
            expect(await tile.evaluate(el => getComputedStyle(el).color), `${label}'s ink`).toBe(await resolve(page, "color", `--chakra-colors-${ink}`));
        }
        expect(seen).toBeGreaterThan(0);
        // The Patterns tab's marks and the assign menu's swatches take the same fill.
        const library = frame.locator('[data-frame-slot="start"]');
        const expand = frame.getByRole("button", { name: "Expand Library", exact: true });
        if (await expand.isVisible()) await expand.click();
        await library.getByRole("tab", { name: /^Patterns/ }).click();
        const early = library.locator('[data-library-item="e5m"] [data-roster-pattern-strip] > *').nth(1);
        expect(await early.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await resolve(page, "backgroundColor", "--chakra-colors-teal-300"));
        expect(await library.locator('[data-library-item="e5m"] [data-roster-pattern-strip] > *').nth(0).evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await resolve(page, "backgroundColor", "--chakra-colors-teal-300"));
    });
}

/**
 * A People day's boxes against its cell: each tile's distance from the cell's own start and end — inside its rule and
 * its padding — and its action's from the tile's end, inside the tile's rule and padding; and whether the off day's
 * wash stands in the cell.
 */
const dayBoxes = (cell: Locator) => cell.evaluate((el) => {
    const round = (n: number) => Math.round(n * 10) / 10 || 0;
    const look = getComputedStyle(el), c = el.getBoundingClientRect();
    const start = c.left + Number.parseFloat(look.borderLeftWidth) + Number.parseFloat(look.paddingLeft);
    const end = c.right - Number.parseFloat(look.borderRightWidth) - Number.parseFloat(look.paddingRight);
    return {
        boxes: [...el.querySelectorAll<HTMLElement>("[data-roster-tile]")].map((tile) => {
            const t = tile.getBoundingClientRect(), own = getComputedStyle(tile);
            const action = tile.querySelector<HTMLElement>("[data-roster-chip-action]");
            const inside = t.right - Number.parseFloat(own.borderRightWidth) - Number.parseFloat(own.paddingRight);
            return {
                removed: tile.hasAttribute("data-removed"), start: round(t.left - start), end: round(end - t.right),
                action: action === null ? null : round(inside - action.getBoundingClientRect().right),
            };
        }),
        wash: el.querySelector("[data-roster-assign]") !== null,
    };
});

test("a People day's box fills its cell: a duty's tile from the cell's padding to its padding — a removed one too, alone in its day, no wash beside it — and its remove ×, a removed one's restore, at the box's right-hand end, never beside its words @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 2160, height: 1080 });
    const entry = await open(page, "rosterPeople", "light"); await size(page, entry, 1200);
    const frame = entry.locator("[data-roster-frame]").first();
    await closeInspector(frame); await settled(page);
    // A person's day holding one duty.
    const cell = frame.locator("[data-roster-person-row]").filter({ has: page.locator("[data-roster-person-head]") })
        .locator("[data-roster-person-day]").filter({ has: page.locator("[data-roster-tile]") }).first();
    const tile = cell.locator("[data-roster-tile]");
    await expect(tile).toHaveCount(1);
    const whole = { start: 0, end: 0, action: 0 };
    expect(await dayBoxes(cell)).toEqual({ boxes: [{ removed: false, ...whole }], wash: false });
    // Removed: the same box crossed out, alone in its day — no wash beside it taking half the cell — its restore where its × stood.
    await tile.hover();
    await tile.locator("[data-roster-chip-action]").click();
    await expect(tile).toHaveAttribute("data-removed", "");
    await settled(page);
    expect(await dayBoxes(cell)).toEqual({ boxes: [{ removed: true, ...whole }], wash: false });
    // Restored: as it was, and nothing drafted.
    await tile.locator("[data-roster-chip-action]").click();
    await expect(tile).not.toHaveAttribute("data-removed", "");
    await settled(page);
    expect(await dayBoxes(cell)).toEqual({ boxes: [{ removed: false, ...whole }], wash: false });
    await expect(frame.locator("[data-roster-tile][data-drafted]")).toHaveCount(0);
});

/**
 * Where the words of a People day's boxes stand, in the first row drawing an off day beside a duty whose tile says its
 * hours: each word's line — `+ Assign`, the duty's label, its hours — under its own box's top, and its baseline, the face's
 * ascent under that; how far the middle of `+ Assign`'s capitals, the height of the face's `H`, stands from its box's
 * centreline, and how many whole pixels those capitals are tall.
 */
const dayWords = (frame: Locator) => frame.locator("[data-roster-person-row]").evaluateAll((rows) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const round = (n: number) => Math.round(n * 100) / 100 || 0;
    const line = (holder: Element, el: Element) => {
        const node = [...el.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "");
        if (node === undefined) return undefined;
        const look = getComputedStyle(el), range = document.createRange();
        range.selectNodeContents(node);
        const words = range.getBoundingClientRect(), box = holder.getBoundingClientRect();
        ctx.font = `${look.fontStyle} ${look.fontWeight} ${look.fontSize} ${look.fontFamily}`;
        const face = ctx.measureText("H");
        const top = words.top + (words.height - (face.fontBoundingBoxAscent + face.fontBoundingBoxDescent)) / 2 - box.top;
        return { top: round(top), baseline: round(top + face.fontBoundingBoxAscent), capitals: face.actualBoundingBoxAscent, middle: box.height / 2 };
    };
    for (const row of rows) {
        const assign = row.querySelector("[data-roster-assign]");
        const tile = row.querySelector("[data-roster-tile]:not([data-removed])");
        const label = tile?.querySelector("[data-roster-assignment-name]");
        // The tile's hours: the words after its label.
        const hours = tile?.querySelector("[data-roster-assignment-name] + span:not([data-group]):not([data-roster-tile-group]):not([data-roster-tile-warn])");
        if (assign === null || tile === null || tile === undefined || label === null || label === undefined || hours === null || hours === undefined) continue;
        const its = line(assign, assign), duty = line(tile, label), times = line(tile, hours);
        if (its === undefined || duty === undefined || times === undefined) continue;
        return {
            height: assign.getBoundingClientRect().height, tops: { "+ Assign": its.top, "a duty's label": duty.top, "a duty's hours": times.top },
            off: round(its.baseline - its.capitals / 2 - its.middle), capitals: Math.round(its.capitals),
        };
    }
    return undefined;
});

test("the words of a People day's boxes stand on whole pixels in both densities — `+ Assign`, a duty's label and its hours, none on a half pixel the painter rounds with the page's position — and `+ Assign`'s capitals at its box's centreline: an even number of pixels tall in its even box, as many rows over them as under @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 2160, height: 1080 });
    // Its tiles say their hours (`tileTimes` as it begins, `always`).
    const entry = await open(page, "rosterPeopleNoBands", "light"); await size(page, entry, 1200);
    const frame = entry.locator("[data-roster-frame]").first();
    await closeInspector(frame); await settled(page);
    const read: Record<string, Awaited<ReturnType<typeof dayWords>>> = { comfortable: await dayWords(frame) };
    await frame.getByRole("button", { name: "Display", exact: true }).click();
    await page.getByRole("menuitem", { name: "Compact spacing", exact: true }).click();
    await settled(page);
    read["compact"] = await dayWords(frame);
    await frame.getByRole("button", { name: "Display", exact: true }).click();
    await page.getByRole("menuitem", { name: "Comfortable spacing", exact: true }).click();
    await settled(page);
    for (const [density, height] of [["comfortable", 24], ["compact", 20]] as const) {
        const words = read[density];
        expect(words?.height, `${density}: a row drawing an off day beside a duty that says its hours`).toBe(height);
        // The theme's line of 1.5 is 15px for the mono words and 18.75px for the label: a box centres either on a half pixel
        // or a fraction, which the painter rounds up or down with where the page puts the row.
        for (const [name, top] of Object.entries(words!.tops)) expect(top, `${density}: ${name}'s line ${top}px under its box's top, no whole pixel`).toBe(Math.round(top));
        // Capitals have no descender, so their height is what the eye centres: an odd number of pixels of them in a box of an
        // even height stand half a pixel off its middle at best — seven left 8 rows over them and 9 under.
        expect(words!.capitals % 2, `${density}: + Assign's capitals ${words!.capitals}px tall in a ${height}px box`).toBe(0);
        expect(Math.abs(words!.off), `${density}: + Assign's capitals ${words!.off}px off its box's centreline`).toBeLessThanOrEqual(0.1);
    }
});
