/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The People layout's work requirement by week (#1568, `People Work Requirements` 2a) on e3 itself. Under each group's
 * band: the band's week as the Shifts layout's band says it, and how many of its shifts are short; the eyebrow, headed
 * the vocabulary's word, each day's hours the Shifts layout's band says of that day; a lane a shift the group's targets
 * name, in the shifts' order, each day's hours rostered of needed its slot's as the Shifts layout draws it, `no target`
 * where the slot has none; and the assignment's eyebrow. With no bands, one block at the list's head, a lane's day
 * opening the shift's day across the groups in the inspector — the sum as the lane says it, each group's slot as the
 * Shifts layout draws it — the day, the lane's week and the sum each stating what its slots are short, never their net
 * (K4). A lane opens to its skill rows and stays open across a remount; Hide requirements takes the
 * strip away and a Roster with no targets draws none; while a week is read, each figure is a placeholder.
 *
 * By month, each of the month's weeks as the Week layout draws it: the eyebrow's week its band's week, a lane's marks
 * its days — off where the week names none of its shift — and a skill row's its skill's; a mark selects its slot in its
 * week, which the inspector then shows, or with no bands the shift's day across the groups; while the month is read,
 * each figure is a placeholder.
 *
 * Deep in a band's people, by week or by month, its band, eyebrow and lanes stick under the header, each under the
 * ones above it, until the next band pushes them out together; with no bands the one block sticks over everyone; past
 * half of main an open lane's skill rows scroll with the people; and a stuck band folded stays at the view's top, the
 * focus on it (A6).
 *
 * On a phone, before each band's people's cards — or with no bands everyone's — the vocabulary's heading and the week's
 * hours over a card a day, its hours and each lane's line as the Shifts layout says them; a line's press opens its slot,
 * or the shift's day across the groups, in the inspector; Hide requirements takes the cards away; while a week is read,
 * each figure is a placeholder.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ArrayType, DateTimeType, IntegerType, SortedSet, StringType, compareFor, parseFor, toEastTypeValue, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import type { E3Request } from "../e3-web.test-utils.js";
import { signed } from "./demand.js";
import { DAY, rosterDomain, slotKey, weekKey } from "./model.js";
import { NEXT, START, act, narrow, open, press, rosterHarness, scrollsAsAPageDoes, settle, slot, width, type Choice } from "./harness.test-utils.js";

const h = rosterHarness();
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const scroller = (c: HTMLElement) => slot(c, "main").querySelector<HTMLElement>("[data-virtual-rows]")!;
const byString = compareFor(StringType), byDate = compareFor(DateTimeType), byOrder = compareFor(IntegerType);
const DAYS = [0, 1, 2, 3, 4, 5, 6];
/** A read of the weeks or of the duties, as the request log names their datasets. */
const weekRead = (request: E3Request) => ["page", "find", "runs", "rows"].includes(request.kind)
    && (request.dataset === "records.roster_rota_weeks" || request.dataset === "records.roster_duties");

/** The slots a cover target of the open week names, as e3 holds the targets, by their keys as the grid prints them. */
async function targeted(): Promise<SortedSet<string>> {
    const cover = await h.read(ex.rosterCover);
    return new SortedSet([...cover.values()].filter(target => byDate(target.day, START) >= 0 && byDate(target.day, NEXT) < 0)
        .map(target => slotKey({ day: BigInt((target.day.getTime() - START.getTime()) / DAY), group: target.team, shift: target.shift })), byString);
}
/** A record's keys in its rows' order, as the Roster orders its shifts and its groups. */
const ordered = (rows: ReadonlyMap<string, { order: bigint }>) => [...rows].sort(([a, x], [b, y]) => byOrder(x.order, y.order) || byString(a, b)).map(([key]) => key);
/** A scope's group, from a work requirement row's key — its kind, then its parts as East prints them. */
const readParts = parseFor(ArrayType(StringType));
function partsOf(key: string): string[] {
    const read = readParts(key.slice(key.indexOf(":") + 1));
    if (!read.success) throw new Error(`no parts in ${key}`);
    return read.value;
}
/**
 * What a lane's day says of its hours, after its shift, day and group: `292 of 294 hours rostered, 2 short`, then the
 * difference it states, or `no target`.
 */
const said = (label: string) => label.slice(label.lastIndexOf(": ") + 2);
/** Hours rostered of needed, as a lane's day says them before the difference it states. */
function laneFigures(words: string): { rostered: string; needed: string } {
    const [, rostered, needed] = /^(.+?) of (.+?) hours rostered(?:, .+ (?:short|over))?$/u.exec(words) ?? [];
    expect([rostered, needed], words).not.toContain(undefined);
    return { rostered: rostered!, needed: needed! };
}
/** A number as the harness's locale prints it. */
const enUS = new Intl.NumberFormat("en-US").format;
/** Hours as a figure prints them, read back: `1,352` is 1352. */
const hoursIn = (text: string) => Number(text.replace(/,/gu, ""));
/** The difference a day's label states after its hours, as a viewer reads its figure: `, 2 short`, `, 13 over`, nothing at none. */
const differenceWords = (d: number) => d === 0 ? "" : `, ${enUS(Math.abs(d))} ${d < 0 ? "short" : "over"}`;
/** Hours rostered of needed, as a coverage bar under `el` says them — a slot with no work drawing none, nothing of either. */
function figuresOf(el: Element): { rostered: string; needed: string } {
    const words = el.querySelector("[aria-label*=' hours rostered of ']")?.getAttribute("aria-label");
    if (words === null || words === undefined) return { rostered: "0", needed: "0" };
    const [, rostered, needed] = /^(.+) hours rostered of (.+) needed$/u.exec(words) ?? [];
    return { rostered: rostered!, needed: needed! };
}
/** A band's figures, the text it says itself: its people and its spans' own words, without a shortfall of its own. */
const own = (el: Element) => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("");
/** A count of people as a band and its assignment's eyebrow say it: `1 person`, `12 people`. */
const peopleSaid = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
/** The period segment's radio, checked. */
async function period(c: HTMLElement, name: "Day" | "Week") {
    const radio = toolbar(c).getByRole("radio", { name });
    if (radio.getAttribute("aria-checked") !== "true") await press(radio);
}

/**
 * The Shifts layout's figures for the open week, every group's: each slot's by day, rostered of needed as its coverage
 * bar says them, by the slot's key; each band's of each day, needed and rostered; and each band's of the week, as it
 * says them, with how many of its slots it marks short.
 */
async function shiftsLayout(c: HTMLElement, groups: readonly string[], shifts: readonly string[]) {
    await press(toolbar(c).getByRole("radio", { name: "Shifts" }));
    await period(c, "Day");
    const slots = new Map<string, { rostered: string; needed: string }>();
    const days = new Map<string, { rostered: string; needed: string }[]>(groups.map(group => [group, []]));
    const meta = (band: Element) => band.querySelector("[data-schedule-group-content] > span:not([data-schedule-group-label]):not([data-tone])")!.textContent!;
    for (const day of DAYS) {
        await press(within(toolbar(c).getByRole("radiogroup", { name: "Day of week" })).getAllByRole("radio")[day]!);
        for (const cell of slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-requirement]")) slots.set(cell.getAttribute("data-roster-requirement")!, figuresOf(cell));
        for (const band of slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-group]")) {
            const [, needed, rostered] = /^(.+) h needed · (.+) h rostered · /u.exec(meta(band)) ?? [];
            days.get(band.getAttribute("data-roster-group")!)!.push({ rostered: rostered!, needed: needed! });
        }
    }
    await period(c, "Week");
    const weeks = new Map<string, { said: string; short: number }>();
    for (const band of slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-group]")) {
        const group = band.getAttribute("data-roster-group")!;
        const keys = new SortedSet(DAYS.flatMap(day => shifts.map(shift => slotKey({ day: BigInt(day), group, shift }))), byString);
        const short = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-requirement]")]
            .filter(cell => keys.has(cell.getAttribute("data-roster-requirement")!) && cell.querySelector('[data-tone="warning"]') !== null).length;
        weeks.set(group, { said: meta(band), short });
    }
    expect(slots.size).toBe(groups.length * shifts.length * DAYS.length);
    return { slots, days, weeks };
}

/**
 * The hours a day's bar by week draws, or its cup by month (ruled 8 Nov 2026), as shares of the whole in percent: where
 * the permanent staff's part ends, then agency staff's, then the agencies' requests' — each where the one before it
 * ends where the day has none of it — and the parts it draws, in their order: those of the hours, then what is open.
 */
interface Fill { readonly ends: readonly number[]; readonly kinds: readonly string[] }
/** A day's fill with nothing in it: no target, or none of the day's slots needing the skill. */
const EMPTY: Fill = { ends: [0, 0, 0], kinds: [] };
/** A lane's day's fill as its bar by week draws it; `undefined` where it draws no bar, the day with no target. */
function barFill(day: Element): Fill | undefined {
    const bar = day.querySelector("[data-roster-lane-bar]");
    if (bar === null) return undefined;
    const parts = [...bar.querySelectorAll<HTMLElement>("[data-kind]")];
    const end = (kind: string) => { const part = parts.find(el => el.getAttribute("data-kind") === kind); return part === undefined ? undefined : parseFloat(part.style.left) + parseFloat(part.style.width); };
    const permanent = end("permanent") ?? 0, agency = end("agency") ?? permanent;
    return { ends: [permanent, agency, end("requested") ?? agency], kinds: parts.map(el => el.getAttribute("data-kind")!) };
}
/** A skill row's day's fill as its bar by week draws it, its hours assigned of needed; `undefined` where none of its slots needs it. */
function skillBarFill(cell: Element): number | undefined {
    const fill = cell.querySelector("[data-roster-skill-bar]")?.querySelector<HTMLElement>("*");
    return fill === null || fill === undefined ? undefined : parseFloat(fill.style.width);
}
/** A day's fill as its cup by month draws it: its levels, as its style sets them, and its parts. */
function cupFill(mark: HTMLElement): Fill {
    const level = (name: string) => parseFloat(mark.style.getPropertyValue(`--roster-cup-${name}`) || "0");
    return { ends: [level("permanent"), level("agency"), level("fill")], kinds: [...mark.querySelectorAll("[data-roster-cup-part]")].map(el => el.getAttribute("data-roster-cup-part")!) };
}
/** A lane of the People grid by week, as it is drawn: its band's group, its shift, what each of its days says and each one's bar. */
interface Lane { readonly group: string | undefined; readonly shift: string; readonly days: readonly string[]; readonly bars: readonly (Fill | undefined)[] }
/**
 * What a skill row's day says, as a skill's mark by month says it: `16 of 24 hours assigned, 8 short`, its figure's
 * difference in words after its hours; `undefined` where none of the day's slots needs the skill.
 */
function assigned(cell: Element): string | undefined {
    const rostered = cell.querySelector("[data-rostered]"), needed = cell.querySelector("[data-needed]");
    if (rostered === null || needed === null) return undefined;
    const figure = cell.querySelector("[data-roster-lane-difference]")?.textContent ?? "";
    const words = figure === "" ? "" : `, ${figure.slice(1)} ${figure.startsWith("−") ? "short" : "over"}`;
    return `${rostered.textContent} of ${needed.textContent!.replace(/^\/ /u, "")} hours assigned${words}`;
}
/**
 * The People grid's work requirement by week, every band's: the grid scrolled from its top three rows at a time until
 * `foot` — a row's key — is mounted, each row mounted on the way taken by its key: each lane, in the order they are
 * drawn, and each open lane's skill rows' days; each band's people and figures; each eyebrow's days and each
 * assignment's eyebrow, by their band's group.
 */
async function strip(c: HTMLElement, foot: string) {
    const lanes = new Map<string, Lane>(), eyebrows = new Map<string, string[]>(), assigns = new Map<string, string>();
    const skills = new Map<string, (string | undefined)[]>(), skillBars = new Map<string, (number | undefined)[]>();
    const bands = new Map<string, { people: string; said: string; short: string | undefined }>();
    const take = () => {
        const main = slot(c, "main");
        for (const el of main.querySelectorAll<HTMLElement>("[data-roster-lane]")) lanes.set(el.getAttribute("data-roster-lane")!, {
            group: el.getAttribute("data-roster-lane-group") ?? undefined, shift: el.getAttribute("data-roster-lane-shift")!,
            days: [...el.querySelectorAll("[data-roster-lane-day]")].map(day => day.getAttribute("aria-label")!),
            bars: [...el.querySelectorAll("[data-roster-lane-day]")].map(barFill),
        });
        for (const el of main.querySelectorAll<HTMLElement>("[data-roster-lane-skill]")) {
            skills.set(el.getAttribute("data-roster-lane-skill")!, [...el.querySelectorAll("[data-roster-lane-skill-day]")].map(assigned));
            skillBars.set(el.getAttribute("data-roster-lane-skill")!, [...el.querySelectorAll("[data-roster-lane-skill-day]")].map(skillBarFill));
        }
        for (const el of main.querySelectorAll<HTMLElement>("[data-roster-demand]")) eyebrows.set(partsOf(el.getAttribute("data-roster-demand")!)[0] ?? "",
            [...el.querySelectorAll("[data-roster-demand-day]")].map(day => day.textContent!));
        for (const el of main.querySelectorAll<HTMLElement>("[data-roster-assign-head]")) assigns.set(partsOf(el.getAttribute("data-roster-assign-head")!)[0] ?? "", el.textContent!);
        for (const band of main.querySelectorAll<HTMLElement>("[data-roster-group]")) {
            const demand = band.querySelector("[data-roster-band-demand]");
            if (demand === null) continue;
            bands.set(band.getAttribute("data-roster-group")!, {
                people: band.querySelector("[data-count]")!.textContent!, said: own(demand), short: demand.querySelector('[data-tone="warning"]')?.textContent ?? undefined,
            });
        }
    };
    const at = () => slot(c, "main").querySelector(`[data-roster-person-row="${foot}"]`) !== null;
    for (let step = 0; step <= 80; step++) {
        await act(async () => { scroller(c).scrollTop = step * 3 * 62; fireEvent.scroll(scroller(c)); });
        await settle();
        take();
        if (at()) break;
    }
    expect(at(), foot).toBe(true);
    return { lanes, skills, skillBars, eyebrows, assigns, bands };
}
/** A lane's day cell, by the lane's shift — in the block of no band's — and the day. */
const laneDay = (c: HTMLElement, shift: string, day: number) =>
    slot(c, "main").querySelector<HTMLElement>(`[data-roster-lane][data-roster-lane-shift="${shift}"]`)!.querySelectorAll<HTMLElement>("[data-roster-lane-day]")[day]!;
/** Picks an item of the toolbar's Display menu, in the row or folded into its View, and waits for the menu to go. */
async function display(c: HTMLElement, item: string) {
    await press(toolbar(c).queryByRole("button", { name: "Display" }) ?? toolbar(c).getByRole("button", { name: "View" }));
    const entry = await waitFor(() => screen.getByRole("menuitem", { name: item }));
    await act(async () => { fireEvent.pointerDown(entry); });
    await act(async () => { fireEvent.click(entry); });
    await settle();
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: item })).toBeNull());
}
/** The work requirement's rows main has mounted. */
const STRIP = "[data-roster-demand], [data-roster-lane], [data-roster-assign-head], [data-roster-band-demand]";

/** The weeks of the open week's month, March 2028 from Sunday: the week before the open one, it, and the three after. */
const MONTH = [-1, 0, 1, 2, 3].map(weeks => new Date(START.getTime() + weeks * 7 * DAY));
/** A row's cell of a week by month — a lane's, a skill row's — named by the row's key and the week, as East prints it. */
function weekCell(row: Element, attribute: string, key: string, week: Date): HTMLElement {
    const cell = [...row.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(el => el.getAttribute(attribute) === `${key}.${weekKey(week)}`);
    expect(cell, `${key} ${weekKey(week)}`).toBeDefined();
    return cell!;
}
/** A mark by month, as it is drawn: what it says — a lane's its label, a skill's its title — its state, and its cup's fill. */
interface Mark { readonly said: string | undefined; readonly state: string; readonly fill: Fill }
/** A lane by month, as it is drawn: its band's group, its shift and each of the month's weeks' seven marks. */
interface MonthLane { readonly group: string | undefined; readonly shift: string; readonly weeks: readonly (readonly Mark[])[] }
/** A week's hours on an eyebrow by month, as they are drawn: what the form its row shows says, and each form laid out. */
interface EyebrowWeek { readonly shown: string; readonly full: string; readonly short: string; readonly stacked: readonly string[] }
/** What a week's cell on an eyebrow by month shows: the form its row's fit chose (with nothing laid out, its full form). */
const shownWeek = (row: Element, cell: Element) => cell.querySelector(`[data-roster-demand-form="${row.getAttribute("data-demand-form")}"]`)?.textContent ?? "";
/**
 * The People grid's work requirement by month, every band's, read as {@link strip} reads it by week: each lane's marks
 * and each open lane's skill rows', a week of `weeks` at a time; each eyebrow's weeks; and each band's people and
 * figures, by their band's group.
 */
async function monthStrip(c: HTMLElement, foot: string, weeks: readonly Date[]) {
    const lanes = new Map<string, MonthLane>(), skills = new Map<string, readonly (readonly Mark[])[]>(), eyebrows = new Map<string, EyebrowWeek[]>();
    const bands = new Map<string, { people: string; said: string }>();
    const marks = (row: Element, cell: string, mark: string, says: string) => {
        const key = row.getAttribute(cell.replace(/-week$/u, ""))!;
        return weeks.map(week => [...weekCell(row, cell, key, week).querySelectorAll<HTMLElement>(`[${mark}]`)]
            .map((el): Mark => ({ said: el.getAttribute(says) ?? undefined, state: el.getAttribute("data-state")!, fill: cupFill(el) })));
    };
    const take = () => {
        const main = slot(c, "main");
        for (const el of main.querySelectorAll<HTMLElement>("[data-roster-lane]")) lanes.set(el.getAttribute("data-roster-lane")!, {
            group: el.getAttribute("data-roster-lane-group") ?? undefined, shift: el.getAttribute("data-roster-lane-shift")!,
            weeks: marks(el, "data-roster-lane-week", "data-roster-lane-mark", "aria-label"),
        });
        for (const el of main.querySelectorAll<HTMLElement>("[data-roster-lane-skill]")) skills.set(el.getAttribute("data-roster-lane-skill")!,
            marks(el, "data-roster-lane-skill-week", "data-roster-lane-skill-mark", "title"));
        for (const el of main.querySelectorAll<HTMLElement>("[data-roster-demand]")) {
            const cells = [...el.querySelectorAll("[data-roster-demand-week]")];
            eyebrows.set(partsOf(el.getAttribute("data-roster-demand")!)[0] ?? "", weeks.map((week): EyebrowWeek => {
                const cell = cells.find(at => at.getAttribute("data-roster-demand-week") === weekKey(week))!;
                const form = (name: string) => cell.querySelector(`[data-roster-demand-form="${name}"]`);
                return { shown: shownWeek(el, cell), full: form("full")?.textContent ?? "", short: form("short")?.textContent ?? "", stacked: [...form("stacked")?.children ?? []].map(line => line.textContent!) };
            }));
        }
        for (const band of main.querySelectorAll<HTMLElement>("[data-roster-group]")) {
            const demand = band.querySelector("[data-roster-band-demand]");
            if (demand !== null) bands.set(band.getAttribute("data-roster-group")!, { people: band.querySelector("[data-count]")!.textContent!, said: own(demand) });
        }
    };
    const at = () => slot(c, "main").querySelector(`[data-roster-person-row="${foot}"]`) !== null;
    for (let step = 0; step <= 80; step++) {
        await act(async () => { scroller(c).scrollTop = step * 3 * 62; fireEvent.scroll(scroller(c)); });
        await settle();
        take();
        if (at()) break;
    }
    expect(at(), foot).toBe(true);
    return { lanes, skills, eyebrows, bands };
}
/** A lane's marks by month in a week, by the lane's key. */
function laneMarks(c: HTMLElement, key: string, week: Date): HTMLElement[] {
    const lane = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-lane]")].find(el => el.getAttribute("data-roster-lane") === key)!;
    return [...weekCell(lane, "data-roster-lane-week", key, week).querySelectorAll<HTMLElement>("[data-roster-lane-mark]")];
}
/** Steps the period a step back, or on, by the board's keys. */
async function step(c: HTMLElement, key: "[" | "]") {
    await act(async () => { fireEvent.keyDown(slot(c, "main"), { key }); });
    await settle();
}

describe("the People layout's work requirement by week (#1568)", () => {
    test("under each band its group's: the band's week and the eyebrow's days as the Shifts layout's bands say them, a lane a shift its targets name, each day its slot's hours as the Shifts layout draws them or `no target`, and the people it lists", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterWorkRequirement);
        const targets = await targeted(), shifts = ordered(await h.read(ex.rosterShiftTimes)), groups = ordered(await h.read(ex.rosterTeams));
        const staff = await h.read(ex.rosterStaff);
        // The heading is the vocabulary's word, by default `Work requirement`.
        const headings = [...slot(c, "main").querySelectorAll("[data-roster-demand-heading]")].map(el => el.textContent);
        expect(headings.length).toBeGreaterThan(0);
        expect(new Set(headings)).toEqual(new Set(["Work requirement"]));
        // A lane's day opens its slot, its group's, in the inspector: the slot's hours as the lane's day says them.
        const first = slot(c, "main").querySelector<HTMLElement>("[data-roster-lane]")!;
        const day = [...first.querySelectorAll<HTMLElement>("[data-roster-lane-day]")].findIndex(cell => said(cell.getAttribute("aria-label")!) !== "no target");
        expect(day).toBeGreaterThanOrEqual(0);
        const pressed = first.querySelectorAll<HTMLElement>("[data-roster-lane-day]")[day]!;
        await press(pressed);
        expect(pressed.getAttribute("aria-pressed")).toBe("true");
        await waitFor(() => expect(figuresOf(slot(c, "end"))).toEqual(laneFigures(said(pressed.getAttribute("aria-label")!))));
        expect(slot(c, "end").textContent).toContain(`Shift · ${(await h.read(ex.rosterTeams)).get(first.getAttribute("data-roster-lane-group")!)!.label}`);
        // Every band's, read on the way down the grid, against the Shifts layout's figures for the same week.
        const drawn = await strip(c, `requests:${groups.at(-1)!}`);
        const shown = await shiftsLayout(c, groups, shifts);
        for (const group of groups) {
            const named = shifts.filter(shift => DAYS.some(d => targets.has(slotKey({ day: BigInt(d), group, shift }))));
            expect(named.length, group).toBeGreaterThan(0);
            expect([...drawn.lanes.values()].filter(lane => lane.group === group).map(lane => lane.shift), group).toEqual(named);
            // The band: its people, its week as the Shifts layout's band says it, and its shifts short.
            const people = [...staff.values()].filter(person => person.team === group).length;
            const { said: week, short } = shown.weeks.get(group)!;
            expect(drawn.bands.get(group), group).toEqual({ people: peopleSaid(people), said: week, short: short === 0 ? undefined : ` · ${short} ${short === 1 ? "shift" : "shifts"} short` });
            expect(drawn.assigns.get(group), group).toBe(`Assignment · ${peopleSaid(people)}`);
            // The eyebrow: each day's hours rostered of needed, as the Shifts layout's band says them of that day.
            expect(drawn.eyebrows.get(group), group).toEqual(shown.days.get(group)!.map(f => `${f.rostered} / ${f.needed} h`));
        }
        // Each lane's day: its slot's hours as the Shifts layout draws them, then their difference, or `no target` where the slot has none.
        for (const lane of drawn.lanes.values()) lane.days.forEach((words, d) => {
            const key = slotKey({ day: BigInt(d), group: lane.group!, shift: lane.shift });
            const f = shown.slots.get(key)!;
            expect(said(words), key).toBe(targets.has(key) ? `${f.rostered} of ${f.needed} hours rostered${differenceWords(hoursIn(f.rostered) - hoursIn(f.needed))}` : "no target");
        });
    });

    test("a band the narrowing leaves one person says `1 person`, and so does its assignment's eyebrow", async () => {
        scrollsAsAPageDoes();
        const { container: c, store } = await open(ex.rosterWorkRequirement);
        const staff = [...await h.read(ex.rosterStaff)], first = ordered(await h.read(ex.rosterTeams))[0]!;
        // A person of the first band whose name begins no one else's: their name, as a prefix, leaves them alone in it.
        const alone = staff.find(([, person]) => person.team === first && staff.filter(([, other]) => other.name.startsWith(person.name)).length === 1);
        expect(alone, first).toBeDefined();
        const [key, person] = alone!;
        await narrow(store, "rosterWorkRequirement", "people", new Map<string, Choice>([["name", variant("prefix", person.name)]]));
        await waitFor(() => expect(slot(c, "main").querySelector(`[data-roster-group="${first}"] [data-count]`)?.textContent).toBe("1 person"));
        const drawn = await strip(c, key);
        expect(drawn.bands.get(first)?.people, first).toBe("1 person");
        expect(drawn.assigns.get(first), first).toBe("Assignment · 1 person");
    });

    test("with no bands one block heads the list, a lane a shift any group's target names; a lane's day opens the shift's day across the groups in the inspector — the sum as the lane says it, each group's slot as the Shifts layout draws it; the day, the lane's week and the sum each state what its slots are short, never their net (K4)", async () => {
        const { container: c } = await open(ex.rosterPeopleNoBands);
        const targets = await targeted(), shifts = ordered(await h.read(ex.rosterShiftTimes)), groups = ordered(await h.read(ex.rosterTeams));
        const lanes = () => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-lane]")];
        const named = shifts.filter(shift => groups.some(group => DAYS.some(d => targets.has(slotKey({ day: BigInt(d), group, shift })))));
        expect(named.length).toBeGreaterThan(0);
        expect(lanes().map(lane => lane.getAttribute("data-roster-lane-shift"))).toEqual(named);
        expect(lanes().every(lane => !lane.hasAttribute("data-roster-lane-group"))).toBe(true);
        expect(slot(c, "main").querySelector('[data-index="0"] [data-roster-demand]')).not.toBeNull();
        const shown = await shiftsLayout(c, groups, shifts);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        // What a set of the Shifts layout's slots says: their hours, and what they are short, each slot's own summed (K4).
        const number = new Intl.NumberFormat("en-US").format;
        const hours = (text: string) => Number(text.replace(/,/gu, ""));
        const sum = (keys: readonly string[]) => keys.map(key => shown.slots.get(key)!).reduce((n, f) => ({
            rostered: n.rostered + hours(f.rostered), needed: n.needed + hours(f.needed), short: n.short + Math.max(0, hours(f.needed) - hours(f.rostered)),
        }), { rostered: 0, needed: 0, short: 0 });
        const stated = (f: { rostered: number; needed: number; short: number }) => f.short > 0 ? -f.short : f.rostered - f.needed;
        // The days whose net would say otherwise than their slots' own shortfall: a group short as another is over.
        const netted: string[] = [];
        for (const shift of named) {
            const week = sum(DAYS.flatMap(d => groups.map(group => slotKey({ day: BigInt(d), group, shift }))));
            const lane = lanes().find(el => el.getAttribute("data-roster-lane-shift") === shift)!;
            expect(lane.querySelector("[data-roster-lane-head] [data-roster-lane-difference]")?.textContent, `${shift}'s week`).toBe(signed(number, stated(week)));
            for (const d of DAYS) {
                const any = groups.some(group => targets.has(slotKey({ day: BigInt(d), group, shift })));
                if (!any) { expect(said(laneDay(c, shift, d).getAttribute("aria-label")!)).toBe("no target"); continue; }
                const day = sum(groups.map(group => slotKey({ day: BigInt(d), group, shift })));
                if (stated(day) !== day.rostered - day.needed) netted.push(`${shift} ${d}`);
                expect(laneDay(c, shift, d).querySelector("[data-roster-lane-difference]")?.textContent, `${shift} ${d}`).toBe(signed(number, stated(day)));
                // Its label, which a screen reader hears in place of its figures, says that difference after the hours.
                expect(said(laneDay(c, shift, d).getAttribute("aria-label")!), `${shift} ${d}`).toBe(`${number(day.rostered)} of ${number(day.needed)} hours rostered${differenceWords(stated(day))}`);
                await press(laneDay(c, shift, d));
                expect(laneDay(c, shift, d).getAttribute("aria-pressed")).toBe("true");
                const end = slot(c, "end");
                const across = await waitFor(() => { const el = end.querySelector<HTMLElement>('[data-roster-shift-day="across"]'); expect(el).not.toBeNull(); return el!; });
                expect(figuresOf(across), `${shift} ${d}`).toEqual(laneFigures(said(laneDay(c, shift, d).getAttribute("aria-label")!)));
                // The sum's difference, and its bar's open part, what the slots are short: never the net.
                expect(across.querySelector("[data-roster-coverage-delta]")?.textContent, `${shift} ${d}`).toBe(`${stated(day) >= 0 ? "+" : ""}${number(stated(day))} h`);
                const open = across.querySelector<HTMLElement>('[data-kind="open"]');
                expect(open === null ? 0 : parseFloat(open.style.width), `${shift} ${d}`).toBeCloseTo(day.short / Math.max(day.needed, day.rostered + day.short, 1) * 100, 6);
                for (const group of groups) expect(figuresOf(end.querySelector(`[data-roster-shift-day="${group}"]`)!), `${shift} ${d} ${group}`)
                    .toEqual(shown.slots.get(slotKey({ day: BigInt(d), group, shift }))!);
            }
        }
        // The week holds such a day, so the figures above are a shortfall a net would have hidden.
        expect(netted.length).toBeGreaterThan(0);
    });

    test("a lane opens to its skill rows, one a skill its slots need in the activities' order, and stays open across a remount; pressed again, it closes", async () => {
        const first = await open(ex.rosterWorkRequirement);
        const lane = (c: HTMLElement) => slot(c, "main").querySelector<HTMLElement>("[data-roster-lane]")!;
        const head = (c: HTMLElement) => lane(c).querySelector<HTMLElement>("[data-roster-lane-head]")!;
        const skills = (c: HTMLElement) => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-lane-skill]")].map(row => partsOf(row.getAttribute("data-roster-lane-skill")!).at(-1)!);
        const key = lane(first.container).getAttribute("data-roster-lane")!;
        expect(head(first.container).getAttribute("aria-expanded")).toBe("false");
        expect(skills(first.container)).toEqual([]);
        await press(head(first.container));
        expect(head(first.container).getAttribute("aria-expanded")).toBe("true");
        const opened = skills(first.container);
        expect(opened.length).toBeGreaterThan(0);
        const order = ordered(await h.read(ex.rosterActivities));
        expect(opened).toEqual(order.filter(activity => opened.includes(activity)));
        // Its skill rows sit right under it.
        const at = Number(lane(first.container).closest("[data-index]")!.getAttribute("data-index"));
        expect(opened.map((_, i) => slot(first.container, "main").querySelector(`[data-index="${at + 1 + i}"] [data-roster-lane-skill]`) !== null)).toEqual(opened.map(() => true));
        // Remounted, the lane is open still.
        first.unmount();
        const { container: c } = await h.mount(ex.rosterWorkRequirement);
        expect(lane(c).getAttribute("data-roster-lane")).toBe(key);
        expect(head(c).getAttribute("aria-expanded")).toBe("true");
        expect(skills(c)).toEqual(opened);
        await press(head(c));
        expect(head(c).getAttribute("aria-expanded")).toBe("false");
        expect(skills(c)).toEqual([]);
    });

    test("Hide requirements takes the strip away — the band's figures, the eyebrows and the lanes — and Show brings it back; a Roster with no targets draws none", async () => {
        const { container: c } = await open(ex.rosterWorkRequirement);
        expect(slot(c, "main").querySelector(STRIP)).not.toBeNull();
        await display(c, "Hide requirements");
        expect(slot(c, "main").querySelector(STRIP)).toBeNull();
        expect(slot(c, "main").querySelector("[data-roster-person-row]")).not.toBeNull();
        await display(c, "Show requirements");
        expect(slot(c, "main").querySelector(STRIP)).not.toBeNull();
        // The smallest Roster has no targets: its People layout draws no work requirement.
        const minimal = await open(ex.rosterMinimal);
        await press(toolbar(minimal.container).getByRole("radio", { name: "People" }));
        expect(slot(minimal.container, "main").querySelector("[data-roster-person-row]")).not.toBeNull();
        expect(slot(minimal.container, "main").querySelector(STRIP)).toBeNull();
    });

    test("while a week is read each figure is a placeholder — the band's, the eyebrow's and every lane's — its lanes the last week read's; read, its figures land in place", async () => {
        const { container: c } = await open(ex.rosterWorkRequirement);
        const main = () => slot(c, "main");
        const lanes = () => [...main().querySelectorAll("[data-roster-lane]")].map(lane => lane.getAttribute("data-roster-lane"));
        const before = lanes();
        expect(before.length).toBeGreaterThan(0);
        // Two weeks on, past the week read ahead, every read of the weeks and the duties held.
        const held = h.e3.hold(weekRead);
        for (let step = 0; step < 2; step++) { await act(async () => { fireEvent.keyDown(main(), { key: "]" }); }); await settle(); }
        expect(lanes()).toEqual(before);
        expect(main().textContent).not.toMatch(/no target|h needed|h rostered/u);
        // Past the reveal's delay, the placeholders fill: the band's figures, and each day of the eyebrows and the lanes.
        await waitFor(() => expect(main().querySelector("[data-roster-band-demand] [data-shape]")).not.toBeNull());
        const days = [...main().querySelectorAll("[data-roster-demand-day], [data-roster-lane-day]")];
        expect(days.length).toBeGreaterThan(0);
        expect(days.filter(el => el.querySelector("[data-shape]") === null)).toEqual([]);
        expect(main().textContent).not.toMatch(/no target|h needed|h rostered/u);
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(main().querySelector("[data-roster-demand-day] [data-shape], [data-roster-lane-day] [data-shape], [data-roster-band-demand] [data-shape]")).toBeNull());
        expect(main().querySelector("[data-roster-band-demand]")!.textContent).toMatch(/h needed · .+ h rostered/u);
    });
});

describe("the People layout's work requirement by month (#1568)", () => {
    test("each of the month's weeks as the Week layout draws it: the eyebrow's week its band's week, a lane's marks its days — off where the week names none of its shift — and a skill row's its skill's, each a cup filled as its day's bar; the band the month's", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterWorkRequirement);
        const shifts = ordered(await h.read(ex.rosterShiftTimes)), groups = ordered(await h.read(ex.rosterTeams));
        const foot = `requests:${groups.at(-1)!}`;
        // A lane opened, so its skill rows draw by week and by month alike.
        await press(slot(c, "main").querySelector("[data-roster-lane] [data-roster-lane-head]"));
        // Each of the month's weeks by week, from the one before the open week to the last touching the month.
        await step(c, "[");
        const byWeek: Awaited<ReturnType<typeof strip>>[] = [];
        for (const [w] of MONTH.entries()) {
            if (w > 0) await step(c, "]");
            byWeek.push(await strip(c, foot));
        }
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        expect([...slot(c, "main").querySelectorAll("[data-roster-week-column]")].map(el => el.getAttribute("data-roster-week-column"))).toEqual(MONTH.map(week => weekKey(week)));
        const month = await monthStrip(c, foot, MONTH);
        expect(new Set([...slot(c, "main").querySelectorAll("[data-roster-demand-heading]")].map(el => el.textContent))).toEqual(new Set(["Work requirement"]));
        for (const group of groups) {
            // The eyebrow's weeks: each its band's week as the Week layout says it, hours rostered of needed.
            const eyebrow = month.eyebrows.get(group)!;
            expect(eyebrow.map(week => week.full), group).toEqual(byWeek.map(drawn => {
                const [, needed, rostered] = /^(.+) h needed · (.+) h rostered · /u.exec(drawn.bands.get(group)!.said) ?? [];
                return `${rostered} / ${needed} h`;
            }));
            // Each week's other forms say the same hours — the unit dropped, then the hours needed under the hours rostered —
            // and with nothing laid out the full form shows.
            for (const week of eyebrow) {
                expect(week.shown, group).toBe(week.full);
                expect(week.short, group).toBe(week.full.replace(/ h$/u, ""));
                const [rostered, needed] = week.short.split(" / ");
                expect(week.stacked, group).toEqual([rostered, `/ ${needed}`]);
            }
            // A lane a shift any of the month's weeks names, in the shifts' order.
            const named = shifts.filter(shift => byWeek.some(drawn => [...drawn.lanes.values()].some(lane => lane.group === group && lane.shift === shift)));
            expect(named.length, group).toBeGreaterThan(0);
            expect([...month.lanes.values()].filter(lane => lane.group === group).map(lane => lane.shift), group).toEqual(named);
            // The band: its people, and the month's figures in its words.
            expect(month.bands.get(group)?.people, group).toBe(byWeek[1]!.bands.get(group)!.people);
            expect(month.bands.get(group)?.said, group).toMatch(/^.+ h needed · .+ h rostered · .+ h$/u);
        }
        // A lane's marks: each week's days as its lane by week says them; `no target` and off where that week names none of its shift.
        for (const [key, lane] of month.lanes) lane.weeks.forEach((marks, w) => {
            const days = byWeek[w]!.lanes.get(key)?.days;
            expect(marks.map(mark => said(mark.said!)), `${key} ${weekKey(MONTH[w]!)}`).toEqual(days?.map(said) ?? DAYS.map(() => "no target"));
            expect(marks.filter(mark => (said(mark.said!) === "no target") !== (mark.state === "off")), `${key} ${weekKey(MONTH[w]!)}`).toEqual([]);
        });
        // The last two weeks name no target: every lane's marks there are off.
        expect([...month.lanes.values()].flatMap(lane => lane.weeks.slice(3).flat()).filter(mark => mark.state !== "off")).toEqual([]);
        // Each lane's mark is a cup filled as its day's bar by week (ruled 8 Nov 2026): its parts the bar's, in its order, each
        // ending where the bar's ends — the permanent staff's, agency staff's, the agencies' requests' on top — full where the
        // hours rostered reach those needed, what a short day lacks open above them; an off mark empty.
        const kinds = new Set<string>();
        for (const [key, lane] of month.lanes) lane.weeks.forEach((marks, w) => {
            const bars = byWeek[w]!.lanes.get(key)?.bars ?? DAYS.map(() => undefined);
            marks.forEach((mark, day) => {
                const at = `${key} ${weekKey(MONTH[w]!)} ${day}`, bar = bars[day] ?? EMPTY;
                expect(mark.fill.kinds, at).toEqual(bar.kinds);
                mark.fill.ends.forEach((end, part) => expect(end, `${at} ${part}`).toBeCloseTo(bar.ends[part]!, 6));
                for (const kind of mark.fill.kinds) kinds.add(kind);
            });
        });
        // The month draws every part somewhere: some day's cup is short, some has agency staff and some the agencies' requests.
        expect(kinds).toEqual(new Set(["permanent", "agency", "requested", "open"]));
        // The open lane's skill rows: each week's days as its skill rows by week say them, off where none of the day's slots needs the skill.
        expect(month.skills.size).toBeGreaterThan(0);
        for (const [key, weeks] of month.skills) weeks.forEach((marks, w) => {
            expect(marks.map(mark => mark.said === undefined ? undefined : said(mark.said)), `${key} ${weekKey(MONTH[w]!)}`).toEqual(byWeek[w]!.skills.get(key) ?? DAYS.map(() => undefined));
            expect(marks.filter(mark => (mark.said === undefined) !== (mark.state === "off")), `${key} ${weekKey(MONTH[w]!)}`).toEqual([]);
            // Each a cup filled to its hours assigned of needed, as its day's bar by week, and open above them where short.
            const bars = byWeek[w]!.skillBars.get(key) ?? DAYS.map(() => undefined);
            marks.forEach((mark, day) => {
                const at = `${key} ${weekKey(MONTH[w]!)} ${day}`, width = bars[day];
                if (width === undefined) { expect(mark.fill, at).toEqual(EMPTY); return; }
                expect(mark.fill.kinds, at).toEqual([...width > 0 ? ["assigned"] : [], ...width < 100 ? ["open"] : []]);
                for (const end of mark.fill.ends) expect(end, at).toBeCloseTo(width, 6);
            });
        });
    });

    test("a lane's mark selects its slot in its week: the inspector shows that week's slot as the mark says it, and a mark of another week takes the selection there", async () => {
        const { container: c } = await open(ex.rosterWorkRequirement);
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        const lane = slot(c, "main").querySelector<HTMLElement>("[data-roster-lane]")!;
        const key = lane.getAttribute("data-roster-lane")!;
        const label = (await h.read(ex.rosterTeams)).get(lane.getAttribute("data-roster-lane-group")!)!.label;
        const [before, , after] = MONTH;
        // A day the lane's slot has a target in the week before the open one and in the week after.
        const day = DAYS.find(d => [before!, after!].every(week => said(laneMarks(c, key, week)[d]!.getAttribute("aria-label")!) !== "no target"));
        expect(day).toBeDefined();
        for (const week of [after!, before!]) {
            await press(laneMarks(c, key, week)[day!]);
            // Its week's mark is pressed, that day's in no other week.
            expect(MONTH.map(other => laneMarks(c, key, other)[day!]!.getAttribute("aria-pressed"))).toEqual(MONTH.map(other => String(byDate(other, week) === 0)));
            const words = said(laneMarks(c, key, week)[day!]!.getAttribute("aria-label")!);
            await waitFor(() => expect(figuresOf(slot(c, "end"))).toEqual(laneFigures(words)));
            expect(slot(c, "end").textContent).toContain(`Shift · ${label}`);
        }
    });

    test("a change to one of the month's weeks works out that week's coverage again and no other's: the weeks it leaves keep theirs, and the week the inspector reads is its own", async () => {
        const { container: c } = await open(ex.rosterWorkRequirement);
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        const lane = slot(c, "main").querySelector<HTMLElement>("[data-roster-lane]")!;
        const key = lane.getAttribute("data-roster-lane")!;
        const group = lane.getAttribute("data-roster-lane-group")!, shift = lane.getAttribute("data-roster-lane-shift")!;
        const mark = (day: number) => said(laneMarks(c, key, START)[day]!.getAttribute("aria-label")!);
        const duties = await h.read(ex.rosterDuties);
        const dayOf = (start: Date) => Math.floor((start.getTime() - START.getTime()) / DAY);
        const inOpenWeek = (start: Date) => byDate(start, START) >= 0 && byDate(start, NEXT) < 0;
        // A duty of the open week — the month's second — on the lane's shift, on a day its mark counts it: another session takes it off.
        const [taken, duty] = [...duties].find(([, d]) => inOpenWeek(d.start) && d.team === group && d.shift === shift && mark(dayOf(d.start)) !== "no target")!;
        const before = mark(dayOf(duty.start));
        // Another duty of the open week, and one of the month's first week: with nothing selected, the week the inspector reads.
        const kept = [...duties].find(([k, d]) => k !== taken && inOpenWeek(d.start))![0];
        const first = [...duties].find(([, d]) => byDate(d.start, MONTH[0]!) >= 0 && byDate(d.start, START) < 0)![0];
        const domain = rosterDomain(toEastTypeValue(ex.WarehouseDuty));
        const calls = vi.spyOn(domain, "coverage");
        try {
            duties.delete(taken);
            await h.patch(ex.rosterDuties, duties);
            await waitFor(() => expect(mark(dayOf(duty.start))).not.toBe(before));
            await settle();
            const weeks = calls.mock.calls.map(([week]) => week);
            // The open week worked out once, without the duty taken off; the first, the inspector's, as its own coverage alone.
            expect(weeks.filter(week => week.assignments.has(kept))).toHaveLength(1);
            expect(weeks.filter(week => week.assignments.has(taken))).toEqual([]);
            // No other week — the three after, which the change leaves as they were — is worked out again.
            expect(weeks.filter(week => !week.assignments.has(kept) && !week.assignments.has(first))).toEqual([]);
        } finally { calls.mockRestore(); }
    });

    test("with no bands a mark selects the shift's day across the groups in its week, the inspector summing them as the mark says it; each mark says its day as the lane by week does, the difference it states among it (K4)", async () => {
        const { container: c } = await open(ex.rosterPeopleNoBands);
        // The first lane's days of the open week, as its lane by week says them.
        const shift = slot(c, "main").querySelector<HTMLElement>("[data-roster-lane]")!.getAttribute("data-roster-lane-shift")!;
        const byWeek = DAYS.map(d => said(laneDay(c, shift, d).getAttribute("aria-label")!));
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        const lane = slot(c, "main").querySelector<HTMLElement>("[data-roster-lane]")!;
        expect(lane.hasAttribute("data-roster-lane-group")).toBe(false);
        expect(slot(c, "main").querySelector('[data-index="0"] [data-roster-demand]')).not.toBeNull();
        const key = lane.getAttribute("data-roster-lane")!;
        expect(lane.getAttribute("data-roster-lane-shift")).toBe(shift);
        expect(DAYS.map(d => said(laneMarks(c, key, START)[d]!.getAttribute("aria-label")!))).toEqual(byWeek);
        const day = DAYS.find(d => said(laneMarks(c, key, START)[d]!.getAttribute("aria-label")!) !== "no target");
        expect(day).toBeDefined();
        await press(laneMarks(c, key, START)[day!]);
        expect(laneMarks(c, key, START)[day!]!.getAttribute("aria-pressed")).toBe("true");
        const across = await waitFor(() => { const el = slot(c, "end").querySelector<HTMLElement>('[data-roster-shift-day="across"]'); expect(el).not.toBeNull(); return el!; });
        expect(figuresOf(across)).toEqual(laneFigures(said(laneMarks(c, key, START)[day!]!.getAttribute("aria-label")!)));
    });

    test("while the month is read each figure is a placeholder — the band's, the eyebrow's weeks and every lane's marks — its lanes the last month read's; read, its figures land in place", async () => {
        const { container: c } = await open(ex.rosterWorkRequirement);
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        const main = () => slot(c, "main");
        const lanes = () => [...main().querySelectorAll("[data-roster-lane]")].map(lane => lane.getAttribute("data-roster-lane"));
        // Every read of the weeks and the duties held, a month back — February, read ahead, its last week naming the
        // shifts its lanes stand for — then a month further, which nothing has read.
        const held = h.e3.hold(weekRead);
        await step(c, "[");
        const before = lanes();
        expect(before.length).toBeGreaterThan(0);
        await step(c, "[");
        expect(lanes()).toEqual(before);
        expect(main().querySelector("[data-roster-lane-mark], [data-roster-mark-figure]")).toBeNull();
        expect(main().textContent).not.toMatch(/ h needed| \/ .+ h/u);
        // Past the reveal's delay, the placeholders fill: the band's figures, each week of the eyebrows and seven marks each week of every lane.
        const laneWeeks = () => [...main().querySelectorAll("[data-roster-lane-week]")];
        await waitFor(() => expect(laneWeeks().filter(week => week.querySelectorAll("[data-pending]").length !== 7)).toEqual([]));
        expect(laneWeeks().length).toBeGreaterThan(0);
        expect(main().querySelector("[data-roster-band-demand] [data-shape]")).not.toBeNull();
        const weeks = [...main().querySelectorAll("[data-roster-demand-week]")];
        expect(weeks.length).toBeGreaterThan(0);
        expect(weeks.filter(el => el.querySelector("[data-shape]") === null)).toEqual([]);
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(main().querySelector("[data-roster-demand-week] [data-shape], [data-roster-band-demand] [data-shape]")).toBeNull());
        // January names no target: each eyebrow's weeks say their hours, and no lane is drawn.
        const said = [...main().querySelectorAll("[data-roster-demand]")].flatMap(row => [...row.querySelectorAll("[data-roster-demand-week]")].map(cell => shownWeek(row, cell)));
        expect(said.length).toBeGreaterThan(0);
        expect(said.filter(week => !/^.+ \/ .+ h$/u.test(week))).toEqual([]);
        expect(main().querySelector("[data-roster-lane]")).toBeNull();
    });

    test("Hide requirements takes the strip away by month, and Show brings it back", async () => {
        const { container: c } = await open(ex.rosterWorkRequirement);
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        expect(slot(c, "main").querySelector("[data-roster-lane-mark]")).not.toBeNull();
        await display(c, "Hide requirements");
        expect(slot(c, "main").querySelector(STRIP)).toBeNull();
        expect(slot(c, "main").querySelector("[data-roster-person-row]")).not.toBeNull();
        await display(c, "Show requirements");
        expect(slot(c, "main").querySelector("[data-roster-lane-mark]")).not.toBeNull();
    });
});

/** A row of main's frame as it stands: what it draws, its place, and while it sticks its rail and how far under the header. */
interface Placed {
    /** What it draws: `band:<group>`, a work requirement row by its key (`demand:…`, `lane:…`, `skill:…`, `assign:…`), or `row:<key>`. */
    readonly name: string;
    /** Its place, in the rows' own coordinates. */
    readonly place: number;
    /** While it sticks, its rail's height and its top under the header; `undefined` while it scrolls with the rows. */
    readonly stuck: { readonly rail: number; readonly top: number } | undefined;
}
/** What a place box's row draws, named as {@link Placed} names it. */
function nameOf(box: Element): string {
    const row = box.querySelector("[data-roster-group], [data-roster-demand], [data-roster-lane], [data-roster-lane-skill], [data-roster-assign-head], [data-roster-person-row]");
    if (row === null) throw new Error("a place box holds no People row");
    const band = row.getAttribute("data-roster-group"), person = row.getAttribute("data-roster-person-row");
    return band !== null ? `band:${band}` : person !== null ? `row:${person}`
        : row.getAttribute("data-roster-demand") ?? row.getAttribute("data-roster-lane") ?? row.getAttribute("data-roster-lane-skill") ?? row.getAttribute("data-roster-assign-head")!;
}
/** A row's kind, from its name: `band`, `demand`, `lane`, `skill`, `assign` or `row`. */
const kindOf = (name: string) => name.slice(0, name.indexOf(":"));
/** Main's rows as they stand, in their order: each place box's row, where the frame moves it, and how it sticks. */
function placed(c: HTMLElement): Placed[] {
    return [...scroller(c).querySelectorAll<HTMLElement>('[data-slot="virtualRow"]')].map(box => {
        const row = box.firstElementChild as HTMLElement;
        return { name: nameOf(box), place: Number.parseFloat(box.style.top),
            stuck: box.hasAttribute("data-virtual-stuck") ? { rail: Number.parseFloat(box.style.height), top: Number.parseFloat(row.style.top) } : undefined };
    });
}
/** The frame's rows' extent: where the list ends. */
const extent = (c: HTMLElement) => Number(scroller(c).querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"));
/** The rows heading a section as they stand — from `first` to the assignment's eyebrow after it — each with its height: the place of the row after it, less its own. */
function headAt(c: HTMLElement, first: string): { readonly name: string; readonly size: number }[] {
    const rows = placed(c);
    const from = rows.findIndex(row => row.name === first);
    const to = rows.findIndex((row, i) => i > from && kindOf(row.name) === "assign");
    expect([from, to], first).not.toContain(-1);
    return rows.slice(from, to).map((row, i) => ({ name: row.name, size: rows[from + i + 1]!.place - row.place }));
}
/** The height of rows stacked one under another. */
const heightOf = (rows: readonly { readonly size: number }[]) => rows.reduce((sum, row) => sum + row.size, 0);
/** Rests main's view at `top`. */
async function rest(c: HTMLElement, top: number) {
    await act(async () => { scroller(c).scrollTop = top; fireEvent.scroll(scroller(c)); });
    await settle();
}
/** Scrolls main's rows on, three at a time, until the row `name` names is mounted: its place. */
async function placeOf(c: HTMLElement, name: string): Promise<number> {
    for (let step = 0; step <= 80; step++) {
        const found = placed(c).find(row => row.name === name);
        if (found !== undefined) return found.place;
        await rest(c, scroller(c).scrollTop + 3 * 62);
    }
    throw new Error(`${name} never mounted`);
}
/** The group a band, or a row of its work requirement, belongs to; `undefined` for a person's row, or the block of no band's. */
const groupOf = (name: string): string | undefined => kindOf(name) === "band" ? name.slice(name.indexOf(":") + 1)
    : kindOf(name) === "row" ? undefined : partsOf(name)[0];
/**
 * Holds what sticks to the rule (A6): the rows `stuck` names stick, in order, each under the ones above it, at their
 * heights, and each one's rail ends where the stuck rows below it still fit above `end` — the next band's place, or the
 * list's end — so it pushes them out together. Any other row sticking heads the band after them, `next`, its rails laid
 * for when the view reaches it; no person's row nor assignment's eyebrow sticks.
 */
function holdsStuck(c: HTMLElement, stuck: readonly { readonly name: string; readonly size: number }[], end: number, next?: string) {
    const sticking = placed(c).filter(row => row.stuck !== undefined);
    expect(sticking.slice(0, stuck.length).map(row => row.name)).toEqual(stuck.map(row => row.name));
    expect(sticking.slice(stuck.length).filter(row => !["band", "demand", "lane"].includes(kindOf(row.name)) || next === undefined || groupOf(row.name) !== next)
        .map(row => row.name)).toEqual([]);
    const height = heightOf(stuck);
    let above = 0;
    stuck.forEach((row, i) => {
        const at = sticking[i]!;
        expect(at.stuck!.top, row.name).toBe(above);
        above += row.size;
        expect(at.place + at.stuck!.rail, row.name).toBe(end - (height - above));
    });
}

describe("the work requirement sticks under the header while its people scroll (#1568, A6)", () => {
    test("deep in a band's people its band, eyebrow and lanes stick under the header, each under the ones above it, and the next band pushes them out together; the assignment's eyebrow and the people scroll by; deep in the next band's people, its head sticks", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterWorkRequirement);
        const [first, second, third] = ordered(await h.read(ex.rosterTeams));
        const head = headAt(c, `band:${first}`);
        expect(head.length).toBeGreaterThan(2);
        expect(head.map(row => kindOf(row.name))).toEqual(["band", "demand", ...head.slice(2).map(() => "lane")]);
        // Five rows above the band's agency requests, its people under its head.
        await rest(c, await placeOf(c, `row:requests:${first}`) - 300);
        const next = placed(c).find(row => row.name === `band:${second}`);
        expect(next).toBeDefined();
        holdsStuck(c, head, next!.place, second);
        // The next band's head as it stands under the view, and deep in its people, that head sticks in the first's place.
        const theirs = headAt(c, `band:${second}`);
        expect(theirs.map(row => kindOf(row.name))).toEqual(["band", "demand", ...theirs.slice(2).map(() => "lane")]);
        await rest(c, await placeOf(c, `row:requests:${second}`) - 300);
        holdsStuck(c, theirs, placed(c).find(row => row.name === `band:${third}`)?.place ?? extent(c), third);
    });

    test("by month a band's head sticks the same way", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterWorkRequirement);
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        const [first, second] = ordered(await h.read(ex.rosterTeams));
        const head = headAt(c, `band:${first}`);
        expect(head.map(row => kindOf(row.name))).toEqual(["band", "demand", ...head.slice(2).map(() => "lane")]);
        await rest(c, await placeOf(c, `row:requests:${first}`) - 300);
        holdsStuck(c, head, placed(c).find(row => row.name === `band:${second}`)!.place, second);
    });

    test("with no bands the one block at the list's head sticks over everyone, pushed out only at the list's end", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterPeopleNoBands);
        const head = headAt(c, placed(c)[0]!.name);
        expect(head.length).toBeGreaterThan(1);
        expect(head.map(row => kindOf(row.name))).toEqual(["demand", ...head.slice(1).map(() => "lane")]);
        await rest(c, await placeOf(c, "row:requests") - 300);
        holdsStuck(c, head, extent(c));
    });

    test("lanes opened past half of main: their skill rows scroll with the people, and the band, eyebrow and lanes stay (A6.2)", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterWorkRequirement);
        const [first, second] = ordered(await h.read(ex.rosterTeams));
        const half = scroller(c).getBoundingClientRect().height / 2;
        // The first band's lanes opened in turn until its head is taller than half of main.
        const lanes = headAt(c, `band:${first}`).filter(row => kindOf(row.name) === "lane").map(row => row.name);
        for (const lane of lanes) {
            if (heightOf(headAt(c, `band:${first}`)) > half) break;
            const row = [...scroller(c).querySelectorAll("[data-roster-lane]")].find(el => el.getAttribute("data-roster-lane") === lane);
            await press(row?.querySelector("[data-roster-lane-head]"));
        }
        const head = headAt(c, `band:${first}`);
        expect(heightOf(head)).toBeGreaterThan(half);
        expect(head.some(row => kindOf(row.name) === "skill")).toBe(true);
        // What sticks: the rows that do not give way, in order, while they fit in half of main.
        const firm: (typeof head)[number][] = [];
        for (const row of head) {
            if (kindOf(row.name) === "skill") continue;
            if (heightOf(firm) + row.size > half) break;
            firm.push(row);
        }
        expect(firm.map(row => kindOf(row.name))).toEqual(head.filter(row => kindOf(row.name) !== "skill").map(row => kindOf(row.name)));
        await rest(c, await placeOf(c, `row:requests:${first}`) - 300);
        holdsStuck(c, firm, placed(c).find(row => row.name === `band:${second}`)!.place, second);
    });

    test("a stuck band folded keeps its element and the focus, and stays at the view's top, its rows folded away under it", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterWorkRequirement);
        const [, second, third] = ordered(await h.read(ex.rosterTeams));
        await rest(c, await placeOf(c, `row:requests:${second}`) - 300);
        const band = scroller(c).querySelector<HTMLElement>(`[data-roster-group="${second}"]`)!;
        const box = band.closest('[data-slot="virtualRow"]')!;
        expect(box.hasAttribute("data-virtual-stuck")).toBe(true);
        const at = placed(c).find(row => row.name === `band:${second}`)!.place;
        await act(async () => { band.focus(); });
        await press(band);
        expect(band.isConnected).toBe(true);
        expect(document.activeElement).toBe(band);
        expect(band.getAttribute("aria-expanded")).toBe("false");
        expect(scroller(c).scrollTop).toBe(at);
        expect(box.hasAttribute("data-virtual-stuck")).toBe(false);
        // Its rows went with the fold: the next band follows it.
        const rows = placed(c).map(row => row.name);
        expect(rows[rows.indexOf(`band:${second}`) + 1]).toBe(`band:${third}`);
    });
});

/** A day's card on a phone, as it is drawn: what its head says of the day's hours, and each line's shift and what it says of its hours. */
interface DayCard { readonly said: string; readonly lines: readonly { readonly shift: string; readonly said: string }[] }
/**
 * The phone's People cards, read as {@link strip} reads the grid: scrolled from their top a few cards at a time until
 * the card `foot` keys is mounted, each row met taken by its place — a band by its group, the work requirement's cards
 * and the assignment's eyebrow by their scope's group, a person's card by its key — and each scope's block of day cards
 * and its assignment's eyebrow.
 */
async function cards(c: HTMLElement, foot: string) {
    const blocks = new Map<string, { heading: string; week: string; days: DayCard[] }>(), assigns = new Map<string, string>(), rows = new Map<number, string>();
    const scope = (el: Element, attribute: string) => partsOf(el.getAttribute(attribute)!)[0] ?? "";
    const take = () => {
        for (const box of slot(c, "main").querySelectorAll<HTMLElement>("[data-index]")) {
            const band = box.querySelector("[data-roster-group]"), demand = box.querySelector("[data-roster-demand-cards]");
            const assign = box.querySelector("[data-roster-assign-head]"), person = box.querySelector("[data-roster-person-card]");
            if (demand !== null) blocks.set(scope(demand, "data-roster-demand-cards"), {
                heading: demand.querySelector("[data-roster-demand-heading]")!.textContent!, week: demand.querySelector("[data-roster-demand-total]")!.textContent!,
                days: [...demand.querySelectorAll("[data-roster-demand-card]")].map((card): DayCard => ({
                    said: card.querySelector("[data-roster-demand-day]")!.textContent!,
                    lines: [...card.querySelectorAll("[data-roster-lane-day]")].map(line => ({ shift: line.getAttribute("data-roster-lane-shift")!, said: said(line.getAttribute("aria-label")!) })),
                })),
            });
            if (assign !== null) assigns.set(scope(assign, "data-roster-assign-head"), assign.textContent!);
            const name = band !== null ? `band:${band.getAttribute("data-roster-group")}` : demand !== null ? `demand:${scope(demand, "data-roster-demand-cards")}`
                : assign !== null ? `assign:${scope(assign, "data-roster-assign-head")}` : person !== null ? `card:${person.getAttribute("data-roster-person-card")}` : undefined;
            if (name !== undefined) rows.set(Number(box.getAttribute("data-index")), name);
        }
    };
    const at = () => slot(c, "main").querySelector(`[data-roster-person-card="${foot}"]`) !== null;
    take();
    for (let step = 1; step <= 120 && !at(); step++) {
        await act(async () => { scroller(c).scrollTop = step * 3 * 360; fireEvent.scroll(scroller(c)); });
        await settle();
        take();
    }
    expect(at(), foot).toBe(true);
    // Every place from the top to the foot met once: no row skipped on the way.
    const places = [...rows.keys()].sort((a, b) => a - b);
    expect(places).toEqual(places.map((_, i) => i));
    return { blocks, assigns, order: places.map(i => rows.get(i)!) };
}

describe("the work requirement on a phone (#1568)", () => {
    test("before each band's people's cards: the vocabulary's heading and the week's hours as the Shifts layout's band says them, a card a day — its hours as the band says them of that day, a line a lane its slot's hours or `no target` — then the assignment's eyebrow; a line's press opens its slot in the inspector", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterWorkRequirement);
        const targets = await targeted(), shifts = ordered(await h.read(ex.rosterShiftTimes)), groups = ordered(await h.read(ex.rosterTeams));
        const staff = await h.read(ex.rosterStaff);
        // The Shifts layout's figures for the week, then People on a phone.
        const shown = await shiftsLayout(c, groups, shifts);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        await width(390);
        expect(slot(c, "main").querySelector('[data-roster-agenda="people"]')).not.toBeNull();
        const drawn = await cards(c, `requests:${groups.at(-1)!}`);
        for (const group of groups) {
            const block = drawn.blocks.get(group)!;
            expect(block.heading, group).toBe("Work requirement");
            const [, needed, rostered] = /^(.+) h needed · (.+) h rostered · /u.exec(shown.weeks.get(group)!.said) ?? [];
            expect(block.week, group).toBe(`${rostered} / ${needed} h`);
            expect(block.days.map(day => day.said), group).toEqual(shown.days.get(group)!.map(f => `${f.rostered} / ${f.needed} h`));
            // A line a shift the group's targets name, in the shifts' order, each its slot's hours as the Shifts layout draws them.
            const named = shifts.filter(shift => DAYS.some(d => targets.has(slotKey({ day: BigInt(d), group, shift }))));
            expect(named.length, group).toBeGreaterThan(0);
            block.days.forEach((day, d) => {
                expect(day.lines.map(line => line.shift), `${group} ${d}`).toEqual(named);
                for (const line of day.lines) {
                    const key = slotKey({ day: BigInt(d), group, shift: line.shift });
                    const f = shown.slots.get(key)!;
                    expect(line.said, key).toBe(targets.has(key) ? `${f.rostered} of ${f.needed} hours rostered${differenceWords(hoursIn(f.rostered) - hoursIn(f.needed))}` : "no target");
                }
            });
            const people = [...staff.values()].filter(person => person.team === group).length;
            expect(drawn.assigns.get(group), group).toBe(`Assignment · ${peopleSaid(people)}`);
            // The band, then its work requirement's cards and the assignment's eyebrow, then its people's cards.
            const at = drawn.order.indexOf(`band:${group}`);
            expect(drawn.order.slice(at + 1, at + 3), group).toEqual([`demand:${group}`, `assign:${group}`]);
            expect(drawn.order[at + 3]?.startsWith("card:"), group).toBe(true);
        }
        // A line's press opens its slot, its group's, in the inspector: the slot's hours as the line says them — the first
        // band's cards, back at the list's top.
        await act(async () => { scroller(c).scrollTop = 0; fireEvent.scroll(scroller(c)); });
        await settle();
        const line = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-demand-cards] [data-roster-lane-day]")].find(el => said(el.getAttribute("aria-label")!) !== "no target");
        expect(line).toBeDefined();
        await press(line!);
        expect(line!.getAttribute("aria-pressed")).toBe("true");
        await waitFor(() => expect(figuresOf(slot(c, "end"))).toEqual(laneFigures(said(line!.getAttribute("aria-label")!))));
    });

    test("with no bands one block of day cards heads everyone's cards, a line a shift any group's target names; a line's press opens the shift's day across the groups, the sum as the line says it; Hide requirements takes the cards away and Show brings them back", async () => {
        const { container: c } = await open(ex.rosterPeopleNoBands);
        const targets = await targeted(), shifts = ordered(await h.read(ex.rosterShiftTimes)), groups = ordered(await h.read(ex.rosterTeams));
        await width(390);
        const main = () => slot(c, "main");
        expect(main().querySelector('[data-index="0"] [data-roster-demand-cards]')).not.toBeNull();
        const days = [...main().querySelectorAll<HTMLElement>("[data-roster-demand-card]")];
        expect(days.length).toBe(7);
        const named = shifts.filter(shift => groups.some(group => DAYS.some(d => targets.has(slotKey({ day: BigInt(d), group, shift })))));
        expect(named.length).toBeGreaterThan(0);
        for (const card of days) expect([...card.querySelectorAll("[data-roster-lane-day]")].map(el => el.getAttribute("data-roster-lane-shift"))).toEqual(named);
        const lineOf = (shift: string, d: number) => main().querySelectorAll<HTMLElement>("[data-roster-demand-card]")[d]!.querySelector<HTMLElement>(`[data-roster-lane-shift="${shift}"]`)!;
        const shift = named[0]!;
        const d = DAYS.find(day => groups.some(group => targets.has(slotKey({ day: BigInt(day), group, shift }))))!;
        await press(lineOf(shift, d));
        expect(lineOf(shift, d).getAttribute("aria-pressed")).toBe("true");
        const across = await waitFor(() => { const el = slot(c, "end").querySelector<HTMLElement>('[data-roster-shift-day="across"]'); expect(el).not.toBeNull(); return el!; });
        expect(figuresOf(across)).toEqual(laneFigures(said(lineOf(shift, d).getAttribute("aria-label")!)));
        // Hide requirements takes the cards and the assignment's eyebrow away, the people's cards staying; Show brings them back.
        await display(c, "Hide requirements");
        expect(main().querySelector("[data-roster-demand-cards], [data-roster-assign-head]")).toBeNull();
        expect(main().querySelector("[data-roster-person-card]")).not.toBeNull();
        await display(c, "Show requirements");
        expect(main().querySelector('[data-index="0"] [data-roster-demand-cards]')).not.toBeNull();
    });

    test("while a week is read each of the cards' figures is a placeholder — the week's, each day's and each line's — its lines the last week read's; read, its figures land in place", async () => {
        const { container: c } = await open(ex.rosterWorkRequirement);
        await width(390);
        const block = () => slot(c, "main").querySelector<HTMLElement>("[data-roster-demand-cards]")!;
        const lines = () => [...block().querySelectorAll("[data-roster-lane-day]")].map(el => el.getAttribute("data-roster-lane-day"));
        const before = lines();
        expect(before.length).toBeGreaterThan(0);
        // Two weeks on, past the week read ahead, every read of the weeks and the duties held.
        const held = h.e3.hold(weekRead);
        for (let step = 0; step < 2; step++) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "]" }); }); await settle(); }
        expect(lines()).toEqual(before);
        expect(block().textContent).not.toMatch(/\d h\b|no target/u);
        // Past the reveal's delay, the placeholders fill: the week's, and each day's and each line's.
        await waitFor(() => expect(block().querySelector("[data-roster-demand-total] [data-shape]")).not.toBeNull());
        const figures = [...block().querySelectorAll("[data-roster-demand-day], [data-roster-lane-day]")];
        expect(figures.length).toBeGreaterThan(7);
        expect(figures.filter(el => el.querySelector("[data-shape]") === null)).toEqual([]);
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(block().querySelector("[data-shape]")).toBeNull());
        expect(block().querySelector("[data-roster-demand-total]")!.textContent).toMatch(/^.+ \/ .+ h$/u);
    });
});
