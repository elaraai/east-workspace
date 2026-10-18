/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster follows its rail (#1342) over the warehouse's records: each source
 * of the one `Slice.bindRecords` narrows every place its rows appear — the
 * people the board's rows and the People tab, the activities the Activities
 * tab — and each tab counts what it shows, `People 37 of 69`; a tab its source
 * empties says so and clears that source alone; the People tab has no filter
 * of its own, and a Find fix is a result in it with a chip that clears it;
 * coverage reads every person, whatever the rail hides.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { OptionType, StringType, none, printFor, some, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { readRosterSource, rosterSourceKey } from "./identity.js";
import { act, assignment, narrow, narrowing, open, rosterHarness, settle, slot, type Choice } from "./harness.test-utils.js";

const h = rosterHarness();
const text = printFor(StringType), group = printFor(OptionType(StringType));
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const tabs = (c: HTMLElement) => within(slot(c, "start")).getAllByRole("tab").map(t => t.textContent);
const tab = (c: HTMLElement, name: string) => press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith(name)));
const pane = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`[data-roster-library="${name}"]`)!;
/** The people a tab's mounted cards show, by their staff key. */
const people = (c: HTMLElement) => [...pane(c, "people").querySelectorAll("[data-library-item]")].flatMap(el => {
    const source = readRosterSource(el.getAttribute("data-library-item")!);
    return source.success && source.value.type === "person" ? [source.value.value] : [];
});
const marks = (c: HTMLElement) => [...slot(c, "main").querySelectorAll('[role="img"][aria-label]')].map(el => el.getAttribute("aria-label"));
const values = (field: string, chosen: readonly string[]) => new Map<string, Choice>([[field, variant("values", [...chosen])]]);

describe("the Roster's Library follows the rail (#1342)", () => {
    test("the people source narrows the People tab as it narrows the board: its cards, `People 37 of 69`; agency requests stay; coverage is every person's", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        expect(tabs(c)).toEqual(["People 69", "Activities 17", "Positions 4"]);
        const coverage = marks(c);
        const inbound = [...h.read(ex.rosterStaff)].filter(([, person]) => person.team === "inbound").map(([key]) => key);
        await narrow(store, "rosterWarehouse", "people", values("team", [text("inbound")]));
        await waitFor(() => expect(tabs(c)).toEqual([`People ${inbound.length} of 69`, "Activities 17", "Positions 4"]));
        expect(people(c).length).toBeGreaterThan(0);
        expect(people(c).every(key => inbound.includes(key))).toBe(true);
        // The agency's request card is an action, not staff: it stays, found by the tab's search.
        await act(async () => { fireEvent.change(within(pane(c, "people")).getByRole("textbox", { name: "Search library" }), { target: { value: "Northside" } }); });
        await settle();
        expect([...pane(c, "people").querySelectorAll("[data-library-item]")].some(el => el.getAttribute("data-library-item") === rosterSourceKey("agency", "northside"))).toBe(true);
        // The board shows inbound staff only; coverage still counts every person.
        expect([...slot(c, "main").querySelectorAll("[data-roster-assignment]:not([data-request])")].every(el => el.closest('[data-roster-slot*="inbound"]') !== null)).toBe(true);
        expect(marks(c)).toEqual(coverage);
    });

    test("the activities source narrows the Activities tab: `Activities 4 of 17` for a group's skills, the duty alone for no group", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        await tab(c, "Activities");
        const shown = () => [...pane(c, "activities").querySelectorAll("[data-library-item]")].map(el => el.getAttribute("data-library-item")).sort();
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("picking"))]));
        await waitFor(() => expect(tabs(c)).toEqual(["People 69", "Activities 4 of 17", "Positions 4"]));
        expect(shown()).toEqual(["cold", "pick", "replen", "voice"]);
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(none)]));
        await waitFor(() => expect(tabs(c)).toEqual(["People 69", "Activities 1 of 17", "Positions 4"]));
        expect(shown()).toEqual(["general"]);
    });

    test("a tab its source empties says `No activities match the filters`; its Clear filters clears that source alone", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        await narrow(store, "rosterWarehouse", "people", values("team", [text("inbound")]));
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("nowhere"))]));
        await tab(c, "Activities");
        const empty = await waitFor(() => { const el = pane(c, "activities").querySelector<HTMLElement>("[data-library-empty][data-narrowed]"); expect(el).not.toBeNull(); return el!; });
        expect(within(empty).getByText("No activities match the filters")).toBeTruthy();
        expect(within(empty).getByText("Change or clear the filters to see more activities.")).toBeTruthy();
        expect(tabs(c)[1]).toBe("Activities 0 of 17");
        await press(within(empty).getByRole("button", { name: "Clear filters" }));
        expect(narrowing(store, "rosterWarehouse", "activities").size).toBe(0);
        expect([...narrowing(store, "rosterWarehouse", "people").keys()]).toEqual(["team"]);
        await waitFor(() => expect(tabs(c)[1]).toBe("Activities 17"));
    });

    test("the People tab has no segment and no Filter menu; a Find fix is a result in it, with a chip that clears it", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        expect(within(pane(c, "people")).queryByRole("radiogroup")).toBeNull();
        expect(within(pane(c, "people")).queryByRole("button", { name: /^Filter/ })).toBeNull();
        await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
        const find = within(slot(c, "end")).getAllByRole("button").find(button => /^Find /.test(button.textContent ?? ""));
        await press(find);
        const chip = await waitFor(() => { const el = pane(c, "people").querySelector<HTMLElement>("[data-roster-find] button"); expect(el).not.toBeNull(); return el!; });
        expect(chip.textContent).toMatch(/^Find · /);
        expect(tabs(c)[0]).toMatch(/^People \d+ of 69$/);
        await press(chip);
        expect(pane(c, "people").querySelector("[data-roster-find]")).toBeNull();
        expect(tabs(c)[0]).toBe("People 69");
    });

    test("a failed activities read keeps the last membership, says `Activity results unavailable`, the Activities tab takes no gesture; Retry reads again", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("picking"))]));
        await waitFor(() => expect(tabs(c)[1]).toBe("Activities 4 of 17"));
        h.paging.failing.add("records.roster_activities");
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("dispatch"))]));
        const banner = () => within(slot(c, "banners")).queryByText("Activity results unavailable");
        await waitFor(() => expect(banner()).not.toBeNull());
        await tab(c, "Activities");
        expect(tabs(c)[1]).toBe("Activities 4 of 17");
        expect([pane(c, "activities").hasAttribute("inert"), pane(c, "activities").getAttribute("aria-busy")]).toEqual([true, "true"]);
        // The board and the People tab take their gestures: only the activities failed.
        expect(slot(c, "main").querySelector("[data-roster-main]")?.hasAttribute("inert") ?? false).toBe(false);
        expect(assignment(c, "s37")).not.toBeNull();
        h.paging.failing.clear();
        await press(within(slot(c, "banners")).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(banner()).toBeNull());
        await waitFor(() => expect(tabs(c)[1]).toBe("Activities 6 of 17"));
        expect(pane(c, "activities").hasAttribute("inert")).toBe(false);
    });
});
