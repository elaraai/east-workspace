/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A duty in no group yet (#1548) on e3, over the two steps' example
 * (`rosterNoGroup`): its duties' team an Option field, and the first step's
 * week every one in none. In Shifts they stand in the No group band after the
 * groups — by week a count a shift's day, which opens the day; by day their
 * chips, which a drag places in a group's slot, writing `some(team)`, or takes
 * back out, writing `none`, each one edit that Undo reverts and Save commits
 * through the duties' patch door. In People each stands on its person's row,
 * its tile saying No group, and the inspector's Group field offers the groups
 * and No group. The eye's run asks the week and sends no duty — the function
 * reads them, the page's unsaved edits laid over them (east-workspace#1622) —
 * and lands its placements as one edit; an unsaved target and an unsaved duty
 * go with the call as drafts of their two records, and the function plans
 * over both; below 480px of main a No group card stands for each of the day's
 * shifts holding duties in none.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionType, StringType, equalFor, none, printFor, some } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Roster } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { act, assignment, cell, drop, history, press, rosterHarness, settle, slot, width } from "./harness.test-utils.js";

const h = rosterHarness();
const calls = fitCalls(h, { request: Roster.Types.OptimiseRequest(), result: Roster.Types.OptimiseResult(ex.NoGroupDuties) });
/** The second step's optimiser, by its `e3.function` name. */
const RUN = "rota_place_shifts";
/** The week the example opens on: its Monday. */
const MONDAY = new Date("2028-03-06T00:00:00Z");
const sameTeam = equalFor(OptionType(StringType));
const placeText = printFor(Roster.Types.Place);
/** A group's slot — its day of the week, from zero, its group and its shift — as a requirement's cell names it. */
const slotText = printFor(Roster.Types.Slot);
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
/**
 * A shift's day's cell in the No group band, by day.
 *
 * @param c - What the example rendered into
 * @param day - The day of the week, from zero
 * @param shift - The shift's key
 * @returns Its cell
 * @throws {Error} When the board draws no such cell
 */
function loose(c: HTMLElement, day: number, shift: string): HTMLElement {
    const key = placeText({ day: BigInt(day), group: none, shift });
    const found = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-place]")].find(el => el.getAttribute("data-roster-place") === key);
    if (found === undefined) throw new Error(`the board draws no No group cell for ${key}`);
    return found;
}
/** A shift's day's count in the No group band, by week, by what it says to a screen reader. */
const count = (c: HTMLElement, name: string) => within(slot(c, "main")).getByRole("button", { name });
/** Each duty's team, as e3 holds it. */
const teams = async () => new Map([...(await h.read(ex.noGroupDuties))].map(([key, duty]) => [key, duty.team] as const));
/** The duties' commits, newest first. */
const commits = async () => (await h.history(ex.noGroupDuties)).commits.map(commit => commit.mutation);
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
/** Runs the eye over the week, and waits for its answer to land. */
async function optimised(c: HTMLElement) {
    await waitFor(() => expect(eye(c)?.disabled).toBe(false), { timeout: 10_000 });
    await press(eye(c));
    await waitFor(() => expect(c.querySelector('[data-optimise-banner="done"]')).not.toBeNull(), { timeout: 10_000 });
}

describe("a duty in no group yet (#1548)", () => {
    test("Shifts by week: the first step's week stands in the No group band after the groups, a count a shift's day, the band saying the hours rostered there; a count opens its day, the duties' chips in its cell", async () => {
        const { container: c } = await h.mount(ex.rosterNoGroup);
        const bands = [...slot(c, "main").querySelectorAll<HTMLElement>("button[data-roster-group]")];
        expect(bands.map(band => band.getAttribute("data-roster-group"))).toEqual(["dispatch", "inbound", ""]);
        expect([bands[2]!.querySelector("[data-schedule-group-label]")?.textContent, bands[2]!.textContent?.includes("224 h rostered")]).toEqual(["No group", true]);
        expect([count(c, "No group Mon Early, 3 duties").textContent, count(c, "No group Fri Early, 2 duties").textContent,
            count(c, "No group Sat Early, 0 duties").textContent]).toEqual(["3", "2", "0"]);
        await press(count(c, "No group Mon Early, 3 duties"));
        expect(toolbar(c).getByRole("radio", { name: "Day" }).getAttribute("aria-checked")).toBe("true");
        for (const key of ["mon-w-01", "mon-w-02", "mon-w-03"]) expect(loose(c, 0, "early").contains(assignment(c, key)), key).toBe(true);
        expect(cell(c, 0, "inbound", "early").querySelector("[data-roster-assignment]")).toBeNull();
    });

    test("by day, a drag from the band into a group's slot places the duty and one back takes it out, each one edit Undo reverts; Save writes them through the duties' patch door: `some(team)` and `none`", async () => {
        const { container: c } = await h.mount(ex.rosterNoGroup);
        await press(toolbar(c).getByRole("radio", { name: "Day" }));
        const deployed = await commits();
        await drop(assignment(c, "mon-w-01"), cell(c, 0, "inbound", "early"));
        expect(cell(c, 0, "inbound", "early").contains(assignment(c, "mon-w-01"))).toBe(true);
        await press(history(c, editingMessages.undo()));
        expect(loose(c, 0, "early").contains(assignment(c, "mon-w-01"))).toBe(true);
        await press(history(c, editingMessages.redo()));
        expect(cell(c, 0, "inbound", "early").contains(assignment(c, "mon-w-01"))).toBe(true);
        // Sam's late placed in Dispatch, then taken back out: in no group again, and Undo puts it back.
        await drop(assignment(c, "mon-w-04"), cell(c, 0, "dispatch", "late"));
        expect(cell(c, 0, "dispatch", "late").contains(assignment(c, "mon-w-04"))).toBe(true);
        await drop(assignment(c, "mon-w-04"), loose(c, 0, "late"));
        expect(loose(c, 0, "late").contains(assignment(c, "mon-w-04"))).toBe(true);
        await press(history(c, editingMessages.undo()));
        expect(cell(c, 0, "dispatch", "late").contains(assignment(c, "mon-w-04"))).toBe(true);
        await press(history(c, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]));
        const held = await teams();
        expect([sameTeam(held.get("mon-w-01")!, some("inbound")), sameTeam(held.get("mon-w-04")!, some("dispatch"))]).toEqual([true, true]);
        expect([...held].filter(([key]) => key !== "mon-w-01" && key !== "mon-w-04").every(([, team]) => sameTeam(team, none))).toBe(true);
        // And back out, saved: `none` written.
        await drop(assignment(c, "mon-w-04"), loose(c, 0, "late"));
        await press(history(c, editingMessages.apply()));
        await waitFor(async () => expect(sameTeam((await teams()).get("mon-w-04")!, none)).toBe(true));
    });

    test("People: each duty stands on its person's row on its day, its tile saying No group; the inspector's Group field offers the groups and No group, a choice placing the duty", async () => {
        const { container: c } = await h.mount(ex.rosterNoGroup);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        const tile = () => slot(c, "main").querySelector<HTMLElement>('[data-roster-tile][data-roster-assignment="wed-w-05"]')!;
        expect(tile().closest("[data-roster-person-row]")?.textContent).toContain("Lea Fox");
        // A tile names a group not its person's own in capitals, as it names every group.
        expect(tile().textContent).toContain("NO GROUP");
        await press(tile());
        // Its Details names its Group once — the field's own label, no heading over it saying the same.
        const details = slot(c, "end").querySelector<HTMLElement>('[data-roster-inspector="details"]')!;
        expect([...details.querySelectorAll("*")].filter(el => el.childElementCount === 0 && el.textContent?.trim() === "Group")).toHaveLength(1);
        const trigger = slot(c, "end").querySelector<HTMLElement>('[data-field="group"] [data-scope=select][data-part=trigger]')!;
        await act(async () => { fireEvent.click(trigger); });
        await settle();
        expect(within(screen.getByRole("listbox")).getAllByRole("option").map(option => option.textContent)).toEqual(["Dispatch", "Inbound", "No group"]);
        await act(async () => { fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Inbound" })); });
        await settle();
        // In her own group: the tile names none.
        expect(tile().textContent).not.toContain("NO GROUP");
        await press(history(c, editingMessages.apply()));
        await waitFor(async () => expect(sameTeam((await teams()).get("wed-w-05")!, some("inbound"))).toBe(true));
    });

    test("the eye runs the second step over the week, asking the week and sending no duty: the function reads every one in no group; the answer lands as one edit — each placed in a team, Lea's Wednesday late, which no team needs, left in the band — which one Undo reverts and Save commits", async () => {
        const { container: c } = await h.mount(ex.rosterNoGroup);
        const deployed = await commits();
        await optimised(c);
        const asked = calls.requests(RUN)[0]!;
        // The request names the week and carries no row; the answer is a patch of the duties the function placed, each read in none.
        expect(Object.keys(asked).sort()).toEqual(["from", "period", "run", "slice", "to"]);
        expect([asked.from.getTime(), asked.to.getTime(), asked.period.type]).toEqual([MONDAY.getTime(), MONDAY.getTime() + 7 * 86_400_000, "week"]);
        const answered = calls.answers(RUN)[0]!.duties;
        expect([answered.type, answered.type === "patch" ? answered.value.size : 0]).toEqual(["patch", 27]);
        expect([count(c, "No group Wed Late, 1 duty").textContent, count(c, "No group Mon Early, 0 duties").textContent]).toEqual(["1", "0"]);
        await press(history(c, editingMessages.undo()));
        expect(count(c, "No group Mon Early, 3 duties").textContent).toBe("3");
        await press(history(c, editingMessages.redo()));
        await press(history(c, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]));
        const held = await teams();
        expect([sameTeam(held.get("wed-w-05")!, none), sameTeam(held.get("thu-w-05")!, some("dispatch")), sameTeam(held.get("mon-w-01")!, some("inbound"))])
            .toEqual([true, true, true]);
        expect([...held.values()].filter(team => sameTeam(team, none))).toHaveLength(1);
    });

    test("two records' drafts in one call — a target raised and a duty placed, neither saved, go with the run as drafts of the targets' record and the duties': the function reads both, placing the duty the week's saved targets leave in the band and leaving the placed one where it is; Save writes each record", async () => {
        const { container: c } = await h.mount(ex.rosterNoGroup);
        const user = userEvent.setup();
        const cover = async () => (await h.history(ex.noGroupCover)).commits.map(commit => commit.mutation);
        const deployed = [await commits(), await cover()];
        // Sam's Monday late placed in Inbound by hand — not his own team — and not saved.
        await press(toolbar(c).getByRole("radio", { name: "Day" }));
        await drop(assignment(c, "mon-w-04"), cell(c, 0, "inbound", "late"));
        await press(toolbar(c).getByRole("radio", { name: "Week" }));
        // Wednesday's late in Inbound needs one; raised to two, and not saved.
        const requirement = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-requirement]")]
            .find(el => el.getAttribute("data-roster-requirement") === slotText({ day: 2n, group: "inbound", shift: "late" }));
        await press(requirement ?? null);
        const heads = within(slot(c, "end")).getByRole("spinbutton", { name: "Positions" });
        await user.clear(heads); await settle();
        await user.type(heads, "2"); await settle();
        await user.keyboard("{Enter}"); await settle();
        // The target's cell opened its day: back to the week, which the run is asked of.
        await press(toolbar(c).getByRole("radio", { name: "Week" }));
        expect([await commits(), await cover()]).toEqual(deployed);
        await optimised(c);
        expect(calls.requests(RUN)[0]!.period.type).toBe("week");
        // One call, two drafts: the duties' and the targets', each a call of its record's patch door.
        expect(calls.drafts(RUN)).toEqual([[{ record: ex.noGroupDuties.name, mutation: "patch" }, { record: ex.noGroupCover.name, mutation: "patch" }]]);
        // The function read the target as raised — Lea's Wednesday late has a place in Inbound, and no duty is left in the band —
        // and the duty as placed: Sam's Monday late is none of its answer.
        const answered = calls.answers(RUN)[0]!.duties;
        const placed = answered.type === "patch" ? answered.value : new Map<string, never>();
        expect([placed.has("wed-w-05"), placed.has("mon-w-04"), placed.size]).toEqual([true, false, 27]);
        expect(count(c, "No group Wed Late, 0 duties").textContent).toBe("0");
        // Nothing was written by the call; Save commits each record's edits through its own door.
        expect([await commits(), await cover()]).toEqual(deployed);
        await press(history(c, editingMessages.apply()));
        await waitFor(async () => expect([await commits(), await cover()]).toEqual([["patch", ...deployed[0]!], ["patch", ...deployed[1]!]]), { timeout: 10_000 });
        const held = await teams();
        expect([sameTeam(held.get("wed-w-05")!, some("inbound")), sameTeam(held.get("mon-w-04")!, some("inbound")), [...held.values()].filter(team => sameTeam(team, none)).length])
            .toEqual([true, true, 0]);
        expect((await h.read(ex.noGroupCover)).get("wed-inbound-late")!.heads).toBe(2n);
    });

    test("below 480px of main, a No group card stands for each of the day's shifts holding duties in none, saying its hours; once they are placed, none", async () => {
        const { container: c } = await h.mount(ex.rosterNoGroup);
        await press(toolbar(c).getByRole("radio", { name: "Day" }));
        await width(400);
        await waitFor(() => expect(c.querySelector("[data-roster-agenda]")).not.toBeNull());
        const cards = () => [...c.querySelectorAll<HTMLElement>("[data-roster-agenda-place]")];
        expect(cards().map(card => card.getAttribute("data-roster-agenda-place")))
            .toEqual([placeText({ day: 0n, group: none, shift: "early" }), placeText({ day: 0n, group: none, shift: "late" })]);
        expect([cards()[0]!.textContent?.includes("No group · Early"), cards()[0]!.textContent?.includes("24 h rostered")]).toEqual([true, true]);
        await optimised(c);
        expect(cards()).toEqual([]);
    });
});
