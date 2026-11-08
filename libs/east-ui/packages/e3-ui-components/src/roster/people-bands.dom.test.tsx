/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The People layout without its groups' bands (`peopleBands={false}`, #1567) on e3 itself: by week, by month and on a
 * phone, every person the rail shows in one list — the leads, then the rest, then agency staff — with no band, and every
 * group's agency requests in one row at its foot, a tile naming its group; a person's `+ Assign` places them in their
 * home group; the requests' row takes a request along it, in its own group, and refuses a card in words; the Shifts
 * layout keeps its bands.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DateTimeType, IntegerType, SortedSet, StringType, compareFor } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { NEXT, START, act, assignment, at, drop, history, hover, libraryCard, open, press, release, reveal, rosterHarness, scrollsAsAPageDoes, settle, slot, width } from "./harness.test-utils.js";
import { DAY } from "./model.js";

const h = rosterHarness();
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const scroller = (c: HTMLElement) => slot(c, "main").querySelector<HTMLElement>("[data-virtual-rows]")!;
/** The requests' row's day cell in the week grid. */
const requestsDay = (c: HTMLElement, d: number) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-person-day="requests.${d}"]`)!;

/**
 * Every People row, by its place in the list: the grid scrolled from its top to its foot a few rows at a time, each
 * row mounted on the way taken by its index — a person's row by their key, a band by its group's, the requests' row by
 * its own, and the work requirement's (#1568) by its kind: `demand`, a lane by its shift, `assign`.
 */
async function listed(c: HTMLElement): Promise<string[]> {
    const rows = new Map<number, string>();
    const keyOf = (el: Element): string | null | undefined => el.querySelector("[data-roster-person-row]")?.getAttribute("data-roster-person-row")
        ?? el.querySelector("[data-roster-group]")?.getAttribute("data-roster-group")
        ?? (el.querySelector("[data-roster-demand]") !== null ? "demand" : undefined)
        ?? (el.querySelector("[data-roster-lane]") === null ? undefined : `lane.${el.querySelector("[data-roster-lane]")!.getAttribute("data-roster-lane-shift")}`)
        ?? (el.querySelector("[data-roster-assign-head]") !== null ? "assign" : undefined);
    const take = () => {
        for (const el of slot(c, "main").querySelectorAll<HTMLElement>("[data-index]")) {
            const key = keyOf(el);
            if (key !== null && key !== undefined) rows.set(Number(el.getAttribute("data-index")), key);
        }
    };
    for (let step = 0; step <= 60 && ![...rows.values()].includes("requests"); step++) {
        await act(async () => { scroller(c).scrollTop = step * 3 * 62; fireEvent.scroll(scroller(c)); });
        await settle();
        take();
    }
    const places = [...rows.keys()].sort((a, b) => a - b);
    // Every place from the top to the foot taken once: no row skipped on the way.
    expect(places).toEqual(places.map((_, i) => i));
    return places.map(i => rows.get(i)!);
}
/**
 * The warehouse's people as one list ranks them, as e3 holds them: its leads, then the rest, then agency staff, each
 * rank in the staff record's order.
 */
async function ranked(): Promise<string[]> {
    const staff = await h.read(ex.rosterStaff), positions = await h.read(ex.rosterPositions);
    const rank = (person: { agency: boolean; position: string }) => person.agency ? 2 : positions.get(person.position)?.lead === true ? 0 : 1;
    return [...staff].map(([key, person]) => ({ key, rank: rank(person) })).sort((a, b) => a.rank - b.rank).map(person => person.key);
}
const byString = compareFor(StringType), byDate = compareFor(DateTimeType), byOrder = compareFor(IntegerType);
/**
 * The shifts a target of the days from `from` up to `to` names — the open week's, unless told — in the shifts' order, as
 * e3 holds the targets: the work requirement's lanes (#1568).
 */
async function lanes(from: Date = START, to: Date = NEXT): Promise<string[]> {
    const cover = await h.read(ex.rosterCover), times = await h.read(ex.rosterShiftTimes);
    const named = new SortedSet([...cover.values()].filter(target => byDate(target.day, from) >= 0 && byDate(target.day, to) < 0).map(target => target.shift), byString);
    return [...times].sort(([a, x], [b, y]) => byOrder(x.order, y.order) || byString(a, b)).map(([key]) => key).filter(key => named.has(key));
}
/** Another session's request for agency cover in Inbound on Monday's Early, beside the warehouse's two in Picking on Thursday. */
async function requestInbound(): Promise<void> {
    const newer = await h.read(ex.rosterDuties);
    newer.set("r-inbound", { ...newer.get("s217")!, team: "inbound", start: at("2028-03-06T06:00:00"), end: at("2028-03-06T14:00:00") });
    await h.patch(ex.rosterDuties, newer);
}

describe("the People layout without bands (#1567)", () => {
    test("by week every person the rail shows is in one list — the leads, then the rest, then agency staff — with no band, and every group's agency requests in one row at its foot, each tile naming its group; Shifts keeps its bands", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterPeopleNoBands);
        expect(slot(c, "main").querySelector('[data-roster-grid="people"]')).not.toBeNull();
        const people = await ranked(), shifts = await lanes();
        expect(people.length).toBeGreaterThan(0);
        expect(shifts.length).toBeGreaterThan(0);
        // The work requirement's one block heads the list (#1568), then the people, then the requests.
        expect(await listed(c)).toEqual(["demand", ...shifts.map(shift => `lane.${shift}`), "assign", ...people, "requests"]);
        expect(slot(c, "main").querySelector("[data-roster-group]")).toBeNull();
        // The requests' row, named by the vocabulary's word, holds every group's: Picking's two on Thursday, the first
        // tile and `+1`, and — once another session asks for cover in Inbound — Inbound's on Monday, each tile naming its group.
        await requestInbound();
        const row = await reveal(c, '[data-roster-person-row="requests"]', 62);
        expect(row.querySelector("[data-roster-person-name] button")!.textContent).toBe("Agency requests");
        await waitFor(() => expect(requestsDay(c, 1).querySelector('[data-roster-assignment="r-inbound"] [data-group]')?.textContent).toBe("INBOUND"));
        expect(requestsDay(c, 4).querySelector('[data-roster-assignment="s217"] [data-group]')!.textContent).toBe("PICKING");
        expect(requestsDay(c, 4).querySelector("[data-roster-more]")!.textContent).toBe("+1");
        // Shifts is unchanged: its bands are its slots.
        await press(toolbar(c).getByRole("radio", { name: "Shifts" }));
        await waitFor(() => expect(slot(c, "main").querySelector("[data-roster-group]")).not.toBeNull());
    });
    test("a person's `+ Assign` places them in their home group, though no band says which: the tile names no group, and Save writes the duty to it", async () => {
        const { container: c } = await open(ex.rosterPeopleNoBands);
        const original = await h.read(ex.rosterDuties);
        const trigger = await waitFor(() => { const el = slot(c, "main").querySelector<HTMLElement>("[data-roster-assign]"); expect(el).not.toBeNull(); return el!; });
        const [person, d] = trigger.getAttribute("data-roster-assign")!.split(".") as [string, string];
        await press(trigger);
        await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBeGreaterThan(0));
        const late = screen.getAllByRole("menuitem").find(item => item.getAttribute("data-roster-assign-shift") === "late")!;
        await act(async () => { fireEvent.pointerDown(late); });
        await act(async () => { fireEvent.click(late); });
        await settle();
        const placed = await waitFor(() => {
            const el = slot(c, "main").querySelector<HTMLElement>(`[data-roster-person-day="${person}.${d}"] [data-roster-tile][data-added]`);
            expect(el).not.toBeNull();
            return el!;
        });
        expect(placed.querySelector("[data-group]")).toBeNull();
        await press(history(c, "Save"));
        const added = [...(await h.read(ex.rosterDuties))].filter(([key]) => !original.has(key)).map(([, duty]) => duty);
        expect(added).toHaveLength(1);
        expect(added[0]!.shift).toBe("late");
        expect(added[0]!.team).toBe((await h.read(ex.rosterStaff)).get(person)!.team);
    });
    test("the requests' row takes a request along it, in its own group, and refuses an agency card in words: it has no group to request cover in", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterPeopleNoBands);
        await reveal(c, '[data-roster-person-row="requests"]', 62);
        // An agency's card over the row's Wednesday: refused, the caption saying where it goes; let go, nothing is placed.
        await hover(await libraryCard(c, "Northside Staffing"), requestsDay(c, 3));
        expect(requestsDay(c, 3).hasAttribute("data-drop-invalid")).toBe(true);
        expect(document.querySelector("[data-drag-caption]")?.textContent).toBe("Drop this card onto a group's shift.");
        await release();
        expect(slot(c, "main").querySelector("[data-roster-assignment][data-added]")).toBeNull();
        // Picking's Thursday Early request moved to Wednesday: still Picking's, and saved there.
        await drop(assignment(c, "s217"), requestsDay(c, 3));
        expect(requestsDay(c, 3).querySelector('[data-roster-assignment="s217"] [data-group]')!.textContent).toBe("PICKING");
        await press(history(c, "Save"));
        const saved = (await h.read(ex.rosterDuties)).get("s217")!;
        expect([saved.team, saved.shift, saved.start, saved.end]).toEqual(["picking", "early", at("2028-03-08T06:00:00"), at("2028-03-08T14:00:00")]);
    });
    test("by month the same one list under the work requirement's one block, the requests' row at its foot naming its weeks by the vocabulary's word, and no band", async () => {
        scrollsAsAPageDoes();
        const { container: c } = await open(ex.rosterPeopleNoBands);
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        await waitFor(() => expect(slot(c, "main").querySelector('[data-roster-grid="people-month"]')).not.toBeNull());
        // March's weeks, W9–W13: a lane a shift a target of any of them names (#1568).
        const shifts = await lanes(new Date(START.getTime() - 7 * DAY), new Date(START.getTime() + 28 * DAY));
        expect(shifts.length).toBeGreaterThan(0);
        expect(await listed(c)).toEqual(["demand", ...shifts.map(shift => `lane.${shift}`), "assign", ...await ranked(), "requests"]);
        expect(slot(c, "main").querySelector("[data-roster-group]")).toBeNull();
        const cells = [...slot(c, "main").querySelectorAll<HTMLElement>('[data-roster-person-week^="requests."]')];
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every(cell => /^Agency requests · W\d+$/u.test(cell.getAttribute("aria-label") ?? ""))).toBe(true);
    });
    test("on a phone a card a person in the same one list under the work requirement's one block, and every group's requests in one card at its foot, each group's under its name", async () => {
        const { container: c } = await open(ex.rosterPeopleNoBands);
        await width(390);
        expect(slot(c, "main").querySelector('[data-roster-agenda="people"]')).not.toBeNull();
        expect(slot(c, "main").querySelector("[data-roster-group]")).toBeNull();
        // The work requirement's day cards head the list (#1568), then the assignment's eyebrow, then everyone's cards.
        const first = (await ranked())[0]!;
        expect(slot(c, "main").querySelector('[data-index="0"] [data-roster-demand-cards]')).not.toBeNull();
        expect(slot(c, "main").querySelector('[data-index="1"] [data-roster-assign-head]')).not.toBeNull();
        expect(slot(c, "main").querySelector('[data-index="2"] [data-roster-person-card]')!.getAttribute("data-roster-person-card")).toBe(first);
        await requestInbound();
        const card = await reveal(c, '[data-roster-person-card="requests"]', 360);
        expect(card.firstElementChild!.textContent).toBe("Agency requests");
        await waitFor(() => expect([...card.querySelectorAll("[data-roster-requests-group]")].map(group => group.getAttribute("data-roster-requests-group"))).toEqual(["inbound", "picking"]));
        const picking = card.querySelector<HTMLElement>('[data-roster-requests-group="picking"]')!;
        expect(picking.firstElementChild!.textContent).toBe("Picking");
        expect([...picking.querySelectorAll("[data-roster-card]")].map(el => el.getAttribute("data-roster-card"))).toEqual(["s217", "s250"]);
        expect(card.querySelector('[data-roster-requests-group="inbound"] [data-roster-card="r-inbound"]')).not.toBeNull();
    });
});
