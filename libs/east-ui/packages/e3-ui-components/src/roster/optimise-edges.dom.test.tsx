/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise with the week's edges in the Roster (#1553) on e3: the night
 * warehouse's optimiser is the example's own `e3.function`, which takes the
 * edges, called by name on e3 once per run. A run sends the week's duties and,
 * apart, the duties its window holds that the Roster places in another week —
 * as the session holds them, an unsaved draft among them — with the keys of
 * those whose week is published; the answer's edges land with its duties as
 * one edit, each edge duty marked in its own week, and one Undo reverts it.
 * An answer that changes what a gesture could not — a fixed duty, or one whose
 * week was published while the run was out — is refused, naming the duty, and
 * records nothing.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, SortedMap, compareFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Func, Record, Roster, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import * as opt from "@elaraai/e3-ui/examples/roster/optimise";
import type { Example } from "../e3-web-mount.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { act, at, history, rosterHarness, settle, slot } from "./harness.test-utils.js";

const h = rosterHarness({ "roster/optimise": opt });
const calls = fitCalls(h, { request: Roster.Types.OptimiseRequest(opt.NightsShift, { edges: true }), result: Roster.Types.OptimiseResult(opt.NightsShift, { edges: true }) });
/** The night warehouse's optimiser, by its `e3.function` name. */
const RUN = "rota_plan_nights";
/** The optimiser that takes every duty at the week's edges away, by its name. */
const CLEAR = "rota_clear_edges";

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
/** A duty's live tile in the week grid — never the tombstone of one a draft removes. */
const tileOf = (c: HTMLElement, id: string) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-tile][data-roster-assignment="${id}"]:not([data-removed])`);
/** The person-day a tile is drawn in: `w-02.6`, Tom's Sunday. */
const dayOf = (tile: HTMLElement) => tile.closest("[data-roster-person-day]")?.getAttribute("data-roster-person-day");
const commits = async () => (await h.history(opt.nightsShifts)).commits.map(commit => commit.mutation);
const row = printFor(opt.NightsShift);
const instant = printFor(DateTimeType);

/** The night warehouse's Roster, its optimiser's week read: the eye is enabled once the weeks either side are read too. */
async function mounted(example: Example = opt.rosterOptimiseEdges) {
    const { container } = await h.mount(example);
    await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
    return container;
}
/** The weeks of the rota with the week before published, as another session's Publish leaves them. */
function weekBeforeIssued(): SortedMap<Date, ValueTypeOf<typeof opt.NightsWeek>> {
    const weeks = new SortedMap<Date, ValueTypeOf<typeof opt.NightsWeek>>(opt.nightsWeekRows, compareFor(DateTimeType));
    weeks.set(at("2028-02-28T00:00:00"), { state: variant("issued", { at: at("2028-03-03T17:00:00") }) });
    return weeks;
}
/**
 * Assigns a person a shift on an off day of the week in view through its `+ Assign` menu, picked as a pointer does.
 *
 * @returns The new duty's key
 */
async function assign(c: HTMLElement, person: string, day: number, shift: string): Promise<string> {
    const cell = `[data-roster-person-day="${person}.${day}"]`;
    const trigger = await waitFor(() => { const el = slot(c, "main").querySelector<HTMLElement>(`${cell} [data-roster-assign]`); expect(el).not.toBeNull(); return el!; });
    await press(trigger);
    const item = await waitFor(() => { const el = document.body.querySelector<HTMLElement>(`[role="menuitem"][data-roster-assign-shift="${shift}"]`); expect(el).not.toBeNull(); return el!; });
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
    await settle();
    const placed = await waitFor(() => { const el = slot(c, "main").querySelector<HTMLElement>(`${cell} [data-roster-tile][data-added]`); expect(el).not.toBeNull(); return el!; });
    return placed.getAttribute("data-roster-assignment")!;
}
/** The night warehouse's Roster as `rosterOptimiseEdges` binds it, its optimiser the one that takes every duty at the week's edges away. */
function clearingRoster(): Example {
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const rota = $.let(Record.bind(opt.nightsShifts));
        const weeks = $.let(Record.bind(opt.nightsWeeks));
        const staff = $.let(Data.bind(opt.nightsWorkers));
        const times = $.let(Data.bind(opt.nightsShiftTimes));
        const teams = $.let(Data.bind(ex.minimalTeams));
        const optimise = $.let(Func.bind(opt.rotaClearEdges));
        return Roster({
            id: "clearingRoster", week: { start: "monday" }, inspector: true, optimise,
            view: { layout: "people", period: "week", date: at("2028-03-06T00:00:00") },
            events: { duty: Schedule.events(rota, {
                name: "Shift", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: "people" }, shift: "shift", group: "team",
            }) },
            resources: { people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: w => w.name, group: w => w.team, usual: w => w.usual }) },
            periods: Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" } }),
            shifts: Roster.shifts(times.read(), { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, order: s => s.order }),
            groups: Roster.groups(teams.read(), { label: t => t.name }),
        });
    }))) };
}

/** The week planned's duties, by key in East's order: W10's, Monday 6 March 2028 to the next. */
const WEEK = ["ada-fri", "ada-mon", "ada-thu", "ada-tue", "ada-wed", "mia-fri", "mia-thu", "mia-tue", "mia-wed", "tom-mon", "tom-sun", "tom-thu", "tom-tue", "tom-wed"];
/** The stored duties the week's window holds that the Roster places in another week: the next Monday's early, and the two nights before the week. */
const EDGES = ["ada-next-mon", "mia-sun-before", "tom-sun-before"];

describe("Optimise with the week's edges in the Roster (#1553)", () => {
    test("a run sends the week's duties and its edges apart, an unsaved draft of the week before among them; the answer's edges land with its duties as one edit — each edge duty marked in its own week — one Undo reverts it, and Save writes both through the patch door", async () => {
        const c = await mounted();
        const deployed = await commits();
        // Ada's Sunday in the week before, a Late not saved: a duty at the week's edges as the session holds it.
        await press(toolbar(c).getByRole("button", { name: "Previous week" }));
        const late = await assign(c, "w-01", 6, "late");
        await press(toolbar(c).getByRole("button", { name: "Next week" }));
        await waitFor(() => expect(eye(c)?.disabled).toBe(false), { timeout: 10_000 });
        await press(eye(c));
        await said(c, "done");
        // One call: the week's duties, and apart from them its edges — the stored ones and the draft, its row as drafted — none fixed.
        expect(calls.requests(RUN)).toHaveLength(1);
        const asked = calls.requests(RUN)[0]!;
        expect([instant(asked.from), instant(asked.to), asked.run, [...asked.duties.keys()], asked.fixed.size])
            .toEqual([instant(at("2028-03-06T00:00:00")), instant(at("2028-03-13T00:00:00")), 1n, WEEK, 0]);
        expect([asked.edges.size, ...EDGES.map(key => asked.edges.has(key)), asked.edges.has(late)]).toEqual([4, true, true, true, true]);
        expect(row(asked.edges.get(late)!)).toBe(row({ who: "w-01", shift: "late", team: "inbound", start: at("2028-03-05T14:00:00"), end: at("2028-03-05T22:00:00") }));
        // The answer: Tom's night before the week at the night's own times, Mia's taken away, and her Monday early added.
        const answered = calls.answers(RUN).at(-1)!;
        const added = [...answered.duties.keys()].filter(key => !asked.duties.has(key));
        expect(added).toHaveLength(1);
        const monday = added[0]!;
        expect(monday).toMatch(/^elara-1-\d+$/);
        expect(words(banner(c, "done")!)).toEqual(["Elara optimised W10", "3 changes: 1 added, 1 changed, 1 removed. Undo or apply them like any edit."]);
        const add = tileOf(c, monday)!;
        expect([dayOf(add), add.getAttribute("data-op"), add.getAttribute("title")!.startsWith("Added by Elara · run #1 · ")]).toEqual(["w-03.0", "add", true]);
        // The week before: the changed night marked there, its provenance where it stood in its own week; Mia's night gone,
        // and Ada's Late standing, no run's.
        await press(toolbar(c).getByRole("button", { name: "Previous week" }));
        const night = await waitFor(() => { const el = tileOf(c, "tom-sun-before"); expect(el).not.toBeNull(); return el!; });
        expect([dayOf(night), night.getAttribute("data-op"), night.getAttribute("title")!.startsWith("Was Sun Night 21–05 · Dispatch · Elara run #1 · "), night.querySelector("[data-roster-times]")])
            .toEqual(["w-02.6", "chg", true, null]);
        expect([tileOf(c, "mia-sun-before"), tileOf(c, late)?.hasAttribute("data-op")]).toEqual([null, false]);
        // One step: one Undo takes the whole run back — and only the run: Ada's Late is a step of its own.
        await press(history(c, editingMessages.undo()));
        expect(c.querySelectorAll("[data-op]")).toHaveLength(0);
        expect([tileOf(c, "tom-sun-before")?.querySelector("[data-roster-times]")?.textContent, tileOf(c, "mia-sun-before") !== null, tileOf(c, late) !== null]).toEqual(["21–05", true, true]);
        await press(history(c, editingMessages.redo()));
        await waitFor(() => expect(tileOf(c, "tom-sun-before")?.getAttribute("data-op")).toBe("chg"));
        // Save writes the run and the draft together, as one patch.
        await press(history(c, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]));
        const saved = await h.read(opt.nightsShifts);
        expect([saved.size, saved.has("mia-sun-before"), row(saved.get("tom-sun-before")!), row(saved.get(late)!), row(saved.get(monday)!)]).toEqual([
            opt.nightsShiftRows.size + 1, false,
            row({ who: "w-02", shift: "night", team: "dispatch", start: at("2028-03-05T22:00:00"), end: at("2028-03-06T06:00:00") }),
            row({ who: "w-01", shift: "late", team: "inbound", start: at("2028-03-05T14:00:00"), end: at("2028-03-05T22:00:00") }),
            row({ who: "w-03", shift: "early", team: "inbound", start: at("2028-03-06T06:00:00"), end: at("2028-03-06T14:00:00") }),
        ]);
    });

    test("the edge duties of a published week are fixed: the run is told so, and leaves them as they are", async () => {
        await h.patch(opt.nightsWeeks, weekBeforeIssued());
        const c = await mounted();
        await press(eye(c));
        await said(c, "none");
        const asked = calls.requests(RUN).at(-1)!;
        expect([[...asked.edges.keys()], [...asked.fixed]]).toEqual([EDGES, ["mia-sun-before", "tom-sun-before"]]);
        expect(words(banner(c, "none")!)).toEqual(["No changes", "Elara found nothing to improve in W10."]);
        expect(c.querySelectorAll("[data-op]")).toHaveLength(0);
    });

    test("an answer that removes a fixed duty is refused, naming the duty, and records nothing", async () => {
        await h.patch(opt.nightsWeeks, weekBeforeIssued());
        const c = await mounted(clearingRoster());
        await press(eye(c));
        await said(c, "fail");
        expect(words(banner(c, "fail")!)).toEqual(["Couldn't optimise W10", "Elara's answer removes Mia Hart · Sun Mar 5 Night · Inbound, in a week not available to edit. Nothing changed."]);
        expect([banner(c, "fail")!.querySelector("[role=alert]") !== null, calls.requests(CLEAR).length, c.querySelectorAll("[data-op]").length, (history(c, editingMessages.apply()) as HTMLButtonElement).disabled])
            .toEqual([true, 1, 0, true]);
    });

    test("an answer that changes a duty whose week another session published while the run was out is refused, naming the duty as it was asked", async () => {
        const c = await mounted();
        const hold = calls.hold(RUN);
        await press(eye(c));
        await hold.holding;
        await h.patch(opt.nightsWeeks, weekBeforeIssued());
        hold.release();
        await said(c, "fail");
        expect(words(banner(c, "fail")!)).toEqual(["Couldn't optimise W10", "Elara's answer changes Tom Vale · Sun Mar 5 Night 21–05 · Dispatch, in a week not available to edit. Nothing changed."]);
        expect([calls.requests(RUN)[0]!.fixed.size, c.querySelectorAll("[data-op]").length]).toEqual([0, 0]);
    });
});
