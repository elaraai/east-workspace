/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster follows its rail (#1342) over the warehouse's records: each source
 * of the one `Slice.bindRecords` narrows every place its rows appear — the
 * people the board's rows, the People layout's rows and phone cards, the person
 * chooser and the People tab; the activities the Activities tab and an
 * assignment's activity choices — and each tab counts what it shows, `People 37
 * of 69`; a tab its source empties says so and clears that source alone, the
 * People tab above its agency requests, which stay; the People tab has no
 * filter of its own, and a Find fix's result — the app's fit's answer (#1334),
 * among what the rail shows — is shown in it with a chip that clears it; the
 * rail's fields each offer something to choose, its Skill a search;
 * coverage and costs read every person and activity, whatever the rail hides.
 * A filter change builds nothing again: the Roster's body runs no more, and no
 * payload is decoded (#1354).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionType, StringType, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { readRosterSource, rosterSourceKey } from "./identity.js";
import { act, assignment, narrow, narrowing, open, programOf, rosterHarness, settle, slot, width, type Choice } from "./harness.test-utils.js";
import { countBuilds } from "../shared/builds.test-utils.js";

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
type Person = ValueTypeOf<typeof ex.rosterStaff.type> extends Map<string, infer P> ? P : never;
/** The staff's keys whose row passes the test, in key order. */
const staff = (test: (person: Person) => boolean) => [...h.read(ex.rosterStaff)].filter(([, person]) => test(person)).map(([key]) => key);
/** The inspector summary's figure under a label: `Cost`, `Filled`. */
const stat = (c: HTMLElement, label: string) => within(slot(c, "end")).getByText(label, { selector: "div" }).nextElementSibling?.textContent;
/** Opens a form's select, reads what it offers, and closes it again. */
async function offered(field: HTMLElement) {
    const trigger = field.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await press(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const choices = within(screen.getByRole("listbox")).getAllByRole("option").map(option => option.textContent ?? "");
    await press(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    return choices.filter(choice => choice !== "Unassigned");
}
/** The agency's request card in the People tab: its key is an East literal, compared whole, not spliced into a selector. */
const request = (c: HTMLElement) => [...pane(c, "people").querySelectorAll("[data-library-item]")]
    .find(el => el.getAttribute("data-library-item") === rosterSourceKey("agency", "northside")) ?? null;

describe("the Roster's Library follows the rail (#1342)", () => {
    test("the people source narrows the People tab as it narrows the board: its cards, `People 37 of 69`; agency requests stay; coverage is every person's", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        expect(tabs(c)).toEqual(["People 69", "Activities 17", "Positions 4"]);
        const coverage = marks(c);
        const inbound = staff(person => person.team === "inbound");
        await narrow(store, "rosterWarehouse", "people", values("team", [text("inbound")]));
        await waitFor(() => expect(tabs(c)).toEqual([`People ${inbound.length} of 69`, "Activities 17", "Positions 4"]));
        expect(people(c).length).toBeGreaterThan(0);
        expect(people(c).every(key => inbound.includes(key))).toBe(true);
        // The agency's request card is an action, not staff: it stays, found by the tab's search.
        await act(async () => { fireEvent.change(within(pane(c, "people")).getByRole("textbox", { name: "Search library" }), { target: { value: "Northside" } }); });
        await settle();
        expect(request(c)).not.toBeNull();
        // The board shows inbound staff only; coverage still counts every person.
        expect([...slot(c, "main").querySelectorAll("[data-roster-assignment]:not([data-request])")].every(el => el.closest('[data-roster-slot*="inbound"]') !== null)).toBe(true);
        expect(marks(c)).toEqual(coverage);
    });

    test("a People tab the rail empties says so above the agency requests, which stay; its Clear filters clears the people alone", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("picking"))]));
        await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "Zz")]]));
        const empty = await waitFor(() => { const el = pane(c, "people").querySelector<HTMLElement>("[data-library-empty][data-narrowed]"); expect(el).not.toBeNull(); return el!; });
        expect(within(empty).getByText("No people match the filters")).toBeTruthy();
        expect(tabs(c)[0]).toBe("People 0 of 69");
        // The request card stays, after the words.
        expect(request(c)).not.toBeNull();
        expect(empty.compareDocumentPosition(request(c)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(people(c)).toEqual([]);
        await press(within(empty).getByRole("button", { name: "Clear filters" }));
        expect(narrowing(store, "rosterWarehouse", "people").size).toBe(0);
        expect([...narrowing(store, "rosterWarehouse", "activities").keys()]).toEqual(["group"]);
        await waitFor(() => expect(tabs(c)[0]).toBe("People 69"));
    });

    test("the activities source narrows the Activities tab: `Activities 6 of 17` for a group's skills, in the activities' order; the duty alone for no group", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        await tab(c, "Activities");
        const shown = () => [...pane(c, "activities").querySelectorAll("[data-library-item]")].map(el => el.getAttribute("data-library-item"));
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("inbound"))]));
        await waitFor(() => expect(tabs(c)).toEqual(["People 69", "Activities 6 of 17", "Positions 4"]));
        // The warehouse's own order (Roster.activities' `order`), not its keys' — Unloading first, as the mock lists it.
        expect(shown()).toEqual(["unload", "putaway", "reach", "xdock", "rcvqa", "yard"]);
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

    test("the People tab has no segment and no Filter menu; a Find fix's result is the app's fit's answer among what the rail shows, with a chip that clears it", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        expect(within(pane(c, "people")).queryByRole("radiogroup")).toBeNull();
        expect(within(pane(c, "people")).queryByRole("button", { name: /^Filter/ })).toBeNull();
        await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
        await press(within(slot(c, "end")).getAllByRole("button", { name: "Find a lead" })[0]);
        const chip = await waitFor(() => { const el = pane(c, "people").querySelector<HTMLElement>("[data-roster-find] button"); expect(el).not.toBeNull(); return el!; });
        // The chip shows what the find looks for, and is named for what pressing it does.
        expect([chip.textContent, chip.getAttribute("aria-label")]).toEqual(["Find · Leads", "Clear find · Leads"]);
        // The fit says J. Quartz, the one lead off on Thursday, fits Dispatch's early shift (#1334).
        await waitFor(() => expect(people(c)).toEqual(["jquartz"]));
        expect(tabs(c)[0]).toBe("People 1 of 69");
        // Under the rail, the fits it shows: J. Quartz is Dispatch's, so Inbound shows no one; the agency's request card stays.
        await narrow(store, "rosterWarehouse", "people", values("team", [text("inbound")]));
        await waitFor(() => expect(people(c)).toEqual([]));
        expect(request(c)).not.toBeNull();
        expect(tabs(c)[0]).toBe("People 0 of 69");
        await press(chip);
        expect(pane(c, "people").querySelector("[data-roster-find]")).toBeNull();
        expect(tabs(c)[0]).toBe(`People ${staff(person => person.team === "inbound").length} of 69`);
    });

    test("a Find that finds no one says `No one found` above the agency requests, with no Clear filters: its chip clears it", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        // Every trainer is rostered on Thursday, and Dispatch has none: the fit finds no one, whatever the rail shows.
        expect(staff(person => person.trainer && person.team === "dispatch")).toEqual([]);
        await narrow(store, "rosterWarehouse", "people", values("team", [text("dispatch")]));
        await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
        await press(within(slot(c, "end")).getAllByRole("button", { name: "Find a trainer" })[0]);
        const empty = await waitFor(() => { const el = pane(c, "people").querySelector<HTMLElement>("[data-library-empty]"); expect(el).not.toBeNull(); return el!; });
        expect(within(empty).getByText("No one found")).toBeTruthy();
        expect([empty.hasAttribute("data-narrowed"), within(empty).queryByRole("button", { name: "Clear filters" })]).toEqual([false, null]);
        expect(people(c)).toEqual([]);
        expect(request(c)).not.toBeNull();
        expect(tabs(c)[0]).toBe("People 0 of 69");
    });

    test("the rail's Skill narrows the people through its search: typing finds a skill, and choosing it shows its holders", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        const user = userEvent.setup();
        await user.click(slot(c, "toolbar").querySelector<HTMLElement>('[data-record-slice-source="people"][data-record-slice-field="skills"]')!);
        const editor = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-record-slice-editor="skills"]'); expect(el).not.toBeNull(); return el!; });
        const search = within(editor).getByRole("combobox");
        await user.click(search);
        await user.type(search, "unl");
        await waitFor(() => expect(search.getAttribute("aria-busy")).toBe("false"));
        await waitFor(() => expect(screen.getByRole("option", { name: /^unload/ })).toBeTruthy());
        await user.keyboard("{ArrowDown}{Enter}");
        await waitFor(() => expect(narrowing(store, "rosterWarehouse", "people").get("skills")).toEqual(variant("values", [text("unload")])));
        const holders = staff(person => person.skills.has("unload"));
        await waitFor(() => expect(tabs(c)[0]).toBe(`People ${holders.length} of 69`));
        expect(people(c).every(key => holders.includes(key))).toBe(true);
    });
});

describe("each source narrows every place its rows appear (#1342)", () => {
    test("the people source narrows the People layout's rows, and on a phone its cards", async () => {
        const { container: c, store } = await open(ex.rosterPeople);
        const rows = () => [...slot(c, "main").querySelectorAll("[data-roster-person-row]")].map(el => el.getAttribute("data-roster-person-row")!);
        const dispatch = staff(person => person.team === "dispatch"), keys = staff(() => true);
        // The rows start with the first group's people, none of them Dispatch's.
        expect(rows().filter(key => keys.includes(key)).some(key => !dispatch.includes(key))).toBe(true);
        await narrow(store, "rosterPeople", "people", values("team", [text("dispatch")]));
        await waitFor(() => expect(rows().filter(key => keys.includes(key)).length).toBeGreaterThan(0));
        expect(rows().filter(key => keys.includes(key)).every(key => dispatch.includes(key))).toBe(true);
        // On a phone each group's agency requests head its cards, a card filling the window: narrow to R. Birch, an Inbound
        // person after its leads, so the person card that shows is the narrowing's, not the leads' that show first.
        await width(390);
        const cards = () => [...slot(c, "main").querySelectorAll("[data-roster-person-card]")].map(el => el.getAttribute("data-roster-person-card")!).filter(key => keys.includes(key));
        await narrow(store, "rosterPeople", "people", new Map());
        await waitFor(() => expect(cards()[0]).toBe("aalder"));
        expect(cards()).not.toContain("rbirch");
        await narrow(store, "rosterPeople", "people", new Map<string, Choice>([["name", variant("prefix", "R. Bi")]]));
        await waitFor(() => expect(cards()).toEqual(["rbirch"]));
    });

    test("the person chooser offers the people the rail shows", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        await narrow(store, "rosterWarehouse", "people", values("team", [text("picking")]));
        await press(slot(c, "main").querySelector("[data-roster-requirement]"));
        await press(within(slot(c, "end")).getAllByRole("button", { name: "Assign person" })[0]);
        const form = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-field="person"]'); expect(el).not.toBeNull(); return el!; });
        const picking = [...h.read(ex.rosterStaff)].filter(([, person]) => person.team === "picking").map(([, person]) => person.name);
        expect(await offered(form)).toEqual(picking);
    });

    test("the activities source narrows an assignment's activity choices, keeping its own; coverage and costs read every activity", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        const coverage = marks(c), cost = stat(c, "Cost");
        expect(cost).toBeTruthy();
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("picking"))]));
        await waitFor(() => expect(tabs(c)[1]).toBe("Activities 4 of 17"));
        expect(marks(c)).toEqual(coverage);
        expect(stat(c, "Cost")).toBe(cost);
        // C. Clover's Put-away, on Inbound's early shift: none of Inbound's skills shows but its own, and the duty is no group's.
        await press(assignment(c, "s37"));
        const field = () => slot(c, "end").querySelector<HTMLElement>('[data-field="activity"]')!;
        expect(await offered(field())).toEqual(["Put-away"]);
        // With the activities narrowing nothing, every one of Inbound's skills and the duty, in the activities' order.
        await narrow(store, "rosterWarehouse", "activities", new Map());
        await waitFor(() => expect(tabs(c)[1]).toBe("Activities 17"));
        expect(await offered(field())).toEqual(["Unloading", "Put-away", "Reach truck", "Cross-dock", "Receiving QA", "Yard", "General duties"]);
    });
});

describe("a filter change rebuilds no builder (#1354)", () => {
    test("a choice on the rail builds the Roster no more: the board and the People and Activities tabs follow it over the payload it mounted with", async () => {
        const builds = countBuilds("Roster", programOf(ex.rosterWarehouse));
        const { container: c, store } = await open(builds.program);
        expect(tabs(c)).toEqual(["People 69", "Activities 17", "Positions 4"]);
        const mounted = [builds.runs, builds.decodes];
        expect(Math.min(...mounted)).toBeGreaterThan(0);
        const inbound = staff(person => person.team === "inbound");
        await narrow(store, "rosterWarehouse", "people", values("team", [text("inbound")]));
        await waitFor(() => expect(tabs(c)[0]).toBe(`People ${inbound.length} of 69`));
        expect([...slot(c, "main").querySelectorAll("[data-roster-assignment]:not([data-request])")].every(el => el.closest('[data-roster-slot*="inbound"]') !== null)).toBe(true);
        await narrow(store, "rosterWarehouse", "activities", values("group", [group(some("inbound"))]));
        await waitFor(() => expect(tabs(c)[1]).toBe("Activities 6 of 17"));
        expect([builds.runs, builds.decodes], "no choice runs the body again or decodes a payload").toEqual(mounted);
    });
});
