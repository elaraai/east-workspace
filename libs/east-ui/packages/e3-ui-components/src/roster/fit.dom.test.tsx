/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster's Find fixes on the app's fit (#1334, `Allocation Spec.md` §13),
 * on e3 (#1376). A find asks the app's `e3.function` — the warehouse's own,
 * called by name on e3 — who fits its issue's need on its slot, over the
 * complete staff; the People tab shows the fits among what the rail shows,
 * best first in the fit's order, each card with the fit's reason, under a chip
 * that clears it, and asks again when the drafts change, one question in
 * flight (R1). Without a fit no Find fix is offered (R2). While its answer is
 * on its way the fix reads `Finding…`, and a failure is a warning banner with
 * Retry (R4). The warehouse's example asks its greedy fit (R5). Whom a find
 * found, assigned, is a new duty of the app's `values` (#1526).
 *
 * The fit's contract (east-workspace#1624): a request is the question and the
 * page's scope, and no row; the call carries the Roster's unsaved edits as
 * drafts, which the function reads laid over the records and nothing saves; an
 * answer names whom the function considered (rule 6); a record that refuses
 * the edits fails the fit in its words (rule 9); a record that changed under
 * them takes the optimiser's path (rule 12); and a question is asked again on
 * a draft, on another page's save and on a change of what the page reads,
 * never on a choice on the rail (rule 11).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { SortedMap, StringType, compareFor, none, printFor, variant } from "@elaraai/east";
import { BannerView, editingMessages, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { conflictCards } from "../e3-web-mount.test-utils.js";
import { patchRecord } from "../e3-web.test-utils.js";
import { readRosterSource } from "./identity.js";
import { START, act, assignment, cell, drop, history, narrow, narrowing, open, rosterHarness, settle, slot, warehouseRoster, type Choice } from "./harness.test-utils.js";

const h = rosterHarness();
const text = printFor(StringType);
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const pane = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-roster-library="people"]')!;
const tabs = (c: HTMLElement) => within(slot(c, "start")).getAllByRole("tab").map(t => t.textContent);
/** The People tab's people in the order their cards stand, each with the reason its card carries: staff key, reason. */
const found = (c: HTMLElement) => [...pane(c).querySelectorAll("[data-library-item]")].flatMap(el => {
    const source = readRosterSource(el.getAttribute("data-library-item")!);
    return source.success && source.value.type === "person" ? [[source.value.value, el.querySelector("[data-library-note]")?.textContent ?? null]] : [];
});
/** A person's card in the People tab. */
const card = (c: HTMLElement, key: string) => [...pane(c).querySelectorAll<HTMLElement>("[data-library-item]")].find(el => {
    const source = readRosterSource(el.getAttribute("data-library-item")!);
    return source.success && source.value.type === "person" && source.value.value === key;
});
const chip = (c: HTMLElement) => pane(c).querySelector<HTMLElement>("[data-roster-find] button");
async function issues(c: HTMLElement) { await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ })); }
/** An issue's fix in the inspector: the button under the issue of that title. */
function fix(c: HTMLElement, title: string): HTMLElement | undefined {
    const issue = [...slot(c, "end").querySelectorAll<HTMLElement>("[data-roster-issue]")].find(el => el.querySelector("button")?.textContent === title);
    const buttons = issue === undefined ? [] : within(issue).getAllByRole("button");
    return buttons.length > 1 ? buttons.at(-1) : undefined;
}
const LEAD_ISSUE = "No lead on Dispatch · Early", TRAINER_ISSUE = "B. Swale · trainee without trainer";
/** Every Find fix the inspector offers, by its words. */
const finds = (c: HTMLElement) => within(slot(c, "end")).queryAllByRole("button").map(b => b.textContent ?? "").filter(words => /^Find/.test(words));
const values = (field: string, chosen: readonly string[]) => new Map<string, Choice>([[field, variant("values", [...chosen])]]);
/** The banner the fit's failure shows. */
const failure = (c: HTMLElement) => within(slot(c, "banners")).queryAllByRole("alert").find(el => el.textContent?.includes("Fits couldn't be checked"));
/** A banner of a status, as the shared BannerView draws it: what a banner of the Roster's is told apart by. */
function drawn(status: "warning" | "error") {
    const { container, unmount } = render(<ChakraProvider value={system}><BannerView status={status} title="Fits couldn't be checked" description="the reference" /></ChakraProvider>);
    const className = container.querySelector<HTMLElement>('[role="alert"]')!.className;
    unmount();
    return className;
}
const LEAD = { need: variant("leads", null), slot: { day: 4n, group: "dispatch", shift: "early" } };

describe("a Find fix asks the app's fit, and the People tab shows its answer (R1)", () => {
    test("R1 — a find asks the fit for its issue's need and slot over the complete staff, whatever the rail shows; the tab shows the fits with their reasons, and its chip clears it", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        const dispatch = [...(await h.read(ex.rosterStaff)).values()].filter(person => person.team === "dispatch").length;
        await narrow(store, "rosterWarehouse", "people", values("team", [text("dispatch")]));
        await waitFor(() => expect(tabs(c)[0]).toBe(`People ${dispatch} of 69`));
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        // One question (#1624, rule 1): the issue's need and slot, the week's first day and the page's scope, here none — and
        // no duty, no person and nothing of the configuration. The rail's narrowing is not sent.
        expect(h.fits.requests()).toHaveLength(1);
        const asked = h.fits.requests()[0]!;
        expect(Object.keys(asked).sort()).toEqual(["need", "scope", "slot", "start"]);
        expect([asked.need, asked.slot, asked.start, asked.scope.size]).toEqual([LEAD.need, LEAD.slot, START, 0]);
        // Nothing is unsaved: the call carries no draft.
        expect(h.fits.drafts()).toEqual([[]]);
        expect(tabs(c)[0]).toBe("People 1 of 69");
        // The card carries the reason, and its tooltip the whole of it, which a narrow card cuts.
        expect(card(c, "jquartz")!.getAttribute("title")).toBe("Dispatch · 14 h spare");
        expect([chip(c)!.textContent, chip(c)!.getAttribute("aria-label")]).toEqual(["Find · Leads", "Clear find · Leads"]);
        await press(chip(c));
        expect(chip(c)).toBeNull();
        expect(tabs(c)[0]).toBe(`People ${dispatch} of 69`);
        expect(found(c).length).toBe(dispatch);
        expect(found(c).every(([, reason]) => reason === null)).toBe(true);
        // A find leaves the rail as it was.
        expect([...narrowing(store, "rosterWarehouse", "people").keys()]).toEqual(["team"]);
    });

    test("R1 — best first is the fit's order: each card carries the fit's own reason and warning, its groups stand where their best cards do, and whom it refuses does not show", async () => {
        // The staff as another session leaves them: N. Ochre and B. Pumice, both off on Thursday, made deputies, B. Pumice on
        // the longer contract; J. Quartz's contract cut, so Dispatch's early shift would take him past it.
        const staff = await h.read(ex.rosterStaff);
        staff.set("nochre", { ...staff.get("nochre")!, position: "deputy", contract: 40 });
        staff.set("bpumice", { ...staff.get("bpumice")!, position: "deputy", contract: 46 });
        staff.set("jquartz", { ...staff.get("jquartz")!, contract: 30 });
        await h.patch(ex.rosterStaff, staff);
        // The warehouse asking another app's fit: its order, and a warning past contract.
        const { container: c } = await open(warehouseRoster({ fit: "contract" }));
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([
            ["bpumice", "from Picking · 22 h spare"], ["nochre", "from Inbound · 16 h spare"], ["jquartz", "Dispatch · 6 h spare · past contract"],
        ]));
        expect(h.fits.requests(ex.rosterContractFit.name)).toHaveLength(1);
        expect(tabs(c)[0]).toBe("People 3 of 69");
        // A warning reads in its tone; a plain reason in none.
        expect(card(c, "jquartz")!.querySelector("[data-library-note]")!.getAttribute("data-tone")).toBe("warning");
        expect(card(c, "bpumice")!.querySelector("[data-library-note]")!.hasAttribute("data-tone")).toBe(false);
        // A lead the fit refuses, rostered that day, does not show.
        expect(card(c, "aalder")).toBeUndefined();
        // The agency's request card stays, after the people.
        const requests = [...pane(c).querySelectorAll("[data-library-item]")].map(el => readRosterSource(el.getAttribute("data-library-item")!))
            .flatMap(source => source.success ? [source.value.type] : []);
        expect(requests).toEqual(["person", "person", "person", "agency"]);
    });

    test("R1 — a find asks again when the drafts change: while it is asked the tab shows no verdict, only what the rail shows, busy; then the new answer", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        const held = h.fits.hold();
        // A. Alder's Thursday shift removed: a draft, and A. Alder off that day.
        await press(within(assignment(c, "s1")).getByRole("button", { name: "Remove A. Alder" }));
        await waitFor(() => expect(h.fits.requests()).toHaveLength(2));
        // The same question, and the unsaved removal as a draft of the duties' record: the function reads the week without it.
        expect(h.fits.requests()[1]).toEqual(h.fits.requests()[0]);
        expect(h.fits.drafts()[1]).toEqual([{ record: ex.rosterDuties.name, mutation: "patch" }]);
        // The answer the drafts before had is no verdict on these (F2): every person the rail shows, none with a reason, busy under the find's chip.
        expect(pane(c).getAttribute("aria-busy")).toBe("true");
        expect(tabs(c)[0]).toBe("People 69");
        expect(found(c).length).toBeGreaterThan(1);
        expect(found(c).every(([, reason]) => reason === null)).toBe(true);
        expect([chip(c)!.textContent, fix(c, LEAD_ISSUE)!.textContent]).toEqual(["Find · Leads", "Finding…"]);
        await act(async () => { held.release(); }); await settle();
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 14 h spare"]]));
        expect(pane(c).hasAttribute("aria-busy")).toBe(false);
        expect(tabs(c)[0]).toBe("People 2 of 69");
    });

    test("R1 — one question in flight, the latest asked next: a find pressed while another is asked goes once it lands, and the tab shows its answer", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        const held = h.fits.hold();
        await press(fix(c, LEAD_ISSUE));
        await press(fix(c, TRAINER_ISSUE));
        expect(h.fits.requests()).toHaveLength(1);
        expect(chip(c)!.textContent).toBe("Find · Trainers");
        await act(async () => { held.release(); }); await settle();
        await waitFor(() => expect(h.fits.requests()).toHaveLength(2));
        expect(h.fits.requests()[1]!.need).toEqual(variant("trainers", null));
        // Every trainer is rostered on Thursday: the fit finds no one.
        await waitFor(() => expect(pane(c).querySelector("[data-library-empty]")?.textContent).toContain("No one found"));
        expect(found(c)).toEqual([]);
        expect(tabs(c)[0]).toBe("People 0 of 69");
    });
});

describe("without a fit, no Find fix is offered (R2)", () => {
    test("R2 — Roster.check still reports the issues, and the renderer drops their Find buttons; the other fixes stay", async () => {
        const { container: c } = await open(ex.rosterCustomInspector);
        await issues(c);
        expect(within(slot(c, "end")).getByText("No lead on Dispatch · Early")).toBeTruthy();
        expect(within(slot(c, "end")).getByText("B. Swale · trainee without trainer")).toBeTruthy();
        expect(finds(c)).toEqual([]);
        expect(within(slot(c, "end")).getAllByRole("button", { name: "Request from Northside Staffing" }).length).toBeGreaterThan(0);
        expect(h.fits.requests()).toHaveLength(0);
    });

    test("R2 — with the fit, each of the day's needs offers its Find fix", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        expect(finds(c).sort()).toEqual(["Find a lead", "Find a trainer", "Find skilled staff", "Find skilled staff", "Find skilled staff"]);
    });
});

describe("a find on its way, and failed (R4)", () => {
    test("R4 — while its answer is on its way the fix reads `Finding…`, the other fixes keep their words, and the People tab is busy under the find's chip", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        const held = h.fits.hold();
        await press(fix(c, LEAD_ISSUE));
        expect(fix(c, LEAD_ISSUE)!.textContent).toBe("Finding…");
        expect(finds(c).filter(words => words === "Finding…")).toHaveLength(1);
        expect(fix(c, TRAINER_ISSUE)!.textContent).toBe("Find a trainer");
        expect(chip(c)!.textContent).toBe("Find · Leads");
        expect(pane(c).getAttribute("aria-busy")).toBe("true");
        await act(async () => { held.release(); }); await settle();
        await waitFor(() => expect(fix(c, LEAD_ISSUE)!.textContent).toBe("Find a lead"));
        expect(finds(c).filter(words => words === "Finding…")).toHaveLength(0);
        expect(pane(c).hasAttribute("aria-busy")).toBe(false);
        expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]);
    });

    test("R4 — a failure is a warning banner with the fit's message and Retry, which asks again; the find pressed again asks again too; cleared, its banner goes", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        // e3 cannot serve the fit: it answers each call 503, unavailable.
        let failing = h.fits.fail();
        await press(fix(c, LEAD_ISSUE));
        const banner = await waitFor(() => { const el = failure(c); expect(el).toBeTruthy(); return el!; });
        // What e3's client makes of the answer.
        expect(banner.textContent).toContain("API error: unavailable");
        // A warning's banner, as the shared BannerView draws one — not an error's.
        expect(banner.className).toBe(drawn("warning"));
        expect(banner.className).not.toBe(drawn("error"));
        // Failed, the fix reads its words again, and the tab keeps what it showed.
        expect(fix(c, LEAD_ISSUE)!.textContent).toBe("Find a lead");
        expect(pane(c).hasAttribute("aria-busy")).toBe(false);
        failing();
        await press(within(banner).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        expect(failure(c)).toBeUndefined();
        expect(h.fits.requests()).toHaveLength(2);
        // Failed again on a new question, the fix pressed again asks again.
        failing = h.fits.fail();
        await press(fix(c, TRAINER_ISSUE));
        await waitFor(() => expect(failure(c)).toBeTruthy());
        failing();
        await press(fix(c, TRAINER_ISSUE));
        await waitFor(() => expect(pane(c).querySelector("[data-library-empty]")?.textContent).toContain("No one found"));
        expect(failure(c)).toBeUndefined();
        expect(h.fits.requests()).toHaveLength(4);
        // An answer is kept by its question and the drafts: the lead found again asks nothing, failing service or not.
        failing = h.fits.fail();
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        expect([h.fits.requests().length, failure(c)]).toEqual([4, undefined]);
        // A failure's banner stands only while its find does.
        await press(fix(c, "Unloading · 8 h short"));
        await waitFor(() => expect(failure(c)).toBeTruthy());
        await press(chip(c));
        expect(failure(c)).toBeUndefined();
        failing();
    });
});

describe("the warehouse's example asks its greedy fit (R5)", () => {
    test("R5 — rosterWarehouse asks `roster_staff_fit` on e3, and the People tab is its ranking: the most spare contract hours first, a tie in staff order", async () => {
        expect(ex.rosterStaffFit.name).toBe("roster_staff_fit");
        const { container: c } = await open(ex.rosterWarehouse);
        // A. Alder's Thursday shift removed first: A. Alder and J. Quartz both have 14 hours to spare, so the fit ranks them in staff order.
        await press(within(assignment(c, "s1")).getByRole("button", { name: "Remove A. Alder" }));
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 14 h spare"]]));
        const answer = h.fits.answers(ex.rosterStaffFit.name).at(-1)!;
        expect(["aalder", "jquartz"].map(key => answer.people.get(key))).toEqual([
            variant("fits", { score: 14, why: "from Inbound · 14 h spare", warn: none }),
            variant("fits", { score: 14, why: "Dispatch · 14 h spare", warn: none }),
        ]);
    });
});

describe("whom a find found, assigned (#1526)", () => {
    test("dropped on the find's slot from the People tab, the new duty saves with the duty kind's `values` of it: half an hour's break on the eight-hour shift, and its team's cost centre", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        const before = await h.read(ex.rosterDuties);
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        await drop(card(c, "jquartz")!, cell(c, 4, "dispatch", "early"));
        await press(history(c, editingMessages.apply()));
        const added = [...(await h.read(ex.rosterDuties))].filter(([key]) => !before.has(key))
            .map(([, duty]) => [duty.who, duty.team, duty.shift, duty.unpaidBreak, duty.agreed, duty.costCentre, duty.note]);
        expect(added).toEqual([[variant("staff", "jquartz"), "dispatch", "early", 30, none, "CC-DS", ""]]);
    });
});

describe("the fit reads the Roster's unsaved edits as drafts, and nothing is saved (#1624)", () => {
    const byKey = compareFor(StringType);
    const commits = async () => (await h.history(ex.rosterDuties)).commits.map(commit => commit.mutation);
    const removeAlder = async (c: HTMLElement) => { await press(within(assignment(c, "s1")).getByRole("button", { name: "Remove A. Alder" })); };
    /** The duties as another page leaves them, committed as its Save — and this page told nothing of it. */
    async function another(change: (duties: Map<string, NonNullable<ReturnType<Awaited<ReturnType<typeof h.read<typeof ex.rosterDuties.type>>>["get"]>>>) => void) {
        const next = new Map(await h.read(ex.rosterDuties));
        change(next);
        await patchRecord(h.e3, h.workspace, ex.rosterDuties, new SortedMap([...next], byKey));
    }

    test("seen and not saved — a person given an unsaved duty on the slot's day is refused `Rostered`, and one whose duty that day was removed and not saved fits; the duties' record is as it was", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        const before = await commits();
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        // J. Quartz given a duty on Thursday, on Inbound's night shift, and not saved: the question is asked again of the new drafts.
        await drop(card(c, "jquartz")!, cell(c, 4, "inbound", "night"));
        await waitFor(() => expect(h.fits.answers()).toHaveLength(2));
        await waitFor(() => expect(pane(c).querySelector("[data-library-empty]")?.textContent).toContain("No one found"));
        const rostered = h.fits.answers()[1]!.people.get("jquartz");
        expect(rostered?.type === "refused" ? [rostered.value.group, rostered.value.reason] : rostered).toEqual(["Rostered", "rostered on Inbound · Night"]);
        expect(h.fits.drafts()).toEqual([[], [{ record: ex.rosterDuties.name, mutation: "patch" }]]);
        // A. Alder's Thursday shift removed and not saved: A. Alder fits, off that day in the drafts alone.
        await removeAlder(c);
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"]]));
        // Nothing was saved: no commit was made, and the record holds what it held.
        expect(await commits()).toEqual(before);
        expect((await h.read(ex.rosterDuties)).has("s1")).toBe(true);
    });

    test("rule 6 — an answer that names fewer: a person it names no verdict for is not listed", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        // A function that asks about fewer: its answer names every lead but J. Quartz.
        const fewer = h.fits.answer((made) => ({ ...made, people: new SortedMap([...made.people].filter(([key]) => key !== "jquartz"), byKey) }));
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(pane(c).querySelector("[data-library-empty]")?.textContent).toContain("No one found"));
        expect([found(c), tabs(c)[0], card(c, "jquartz")]).toEqual([[], "People 0 of 69", undefined]);
        fewer();
    });

    test("rule 9 — a roster whose record refuses every Save: with nothing unsaved the fit answers; with an unsaved edit the call ends as the Save would, and the fit fails in the record's words", async () => {
        const { container: c } = await open(warehouseRoster({ locked: true }));
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        expect([h.fits.outcomes(ex.rosterLockedFit.name), h.fits.drafts(ex.rosterLockedFit.name)]).toEqual([["success"], [[]]]);
        // An unsaved removal: e3 lays it as the Save would write it, and the locked record refuses it — there is no state of the
        // record with that edit to ask about.
        await removeAlder(c);
        const banner = await waitFor(() => { const el = failure(c); expect(el).toBeTruthy(); return el!; });
        expect(banner.textContent).toContain("the roster is locked for the week");
        expect(h.fits.drafts(ex.rosterLockedFit.name)[1]).toEqual([{ record: ex.rosterLockedDuties.name, mutation: "patch" }]);
        expect(fix(c, LEAD_ISSUE)!.textContent).toBe("Find a lead");
    });

    test("rule 12 — a record that changed under the edits, nothing to choose: the call ends `conflict`, the Roster takes the other page's save in, and the question is asked again by itself and answered", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        await removeAlder(c);
        // Another page removes the same duty: this page's draft of it no longer fits the record.
        await another(duties => { duties.delete("s1"); });
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 14 h spare"]]), { timeout: 15_000 });
        // Two calls for the one find: the first over a draft of the record as the Roster held it, refused; the second with no
        // draft left to send — the other page's save is the Roster's edit.
        expect([h.fits.outcomes(), h.fits.drafts().map(drafts => drafts.length)]).toEqual([["conflict", "success"], [1, 0]]);
        expect([failure(c), c.querySelector('[data-session-banner="conflicts"]')]).toEqual([undefined, null]);
    });

    test("rule 12 — a conflict to choose: the fit fails in the refused Save's words until the person chooses; chosen, the question is asked again and answered", async () => {
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        await removeAlder(c);
        // Another page moves the duty the Roster removed: a conflict for the person to choose.
        await another(duties => { const duty = duties.get("s1")!; duties.set("s1", { ...duty, note: "Covering the dock" }); });
        await press(fix(c, LEAD_ISSUE));
        const banner = await waitFor(() => { const el = failure(c); expect(el).toBeTruthy(); return el!; }, { timeout: 15_000 });
        expect(banner.textContent).toContain(`${editingMessages.bannerConflicts({ n: 1, count: "1" })}.`);
        expect(h.fits.outcomes()).toEqual(["conflict"]);
        await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        // Chosen — the removal kept — the drafts change, and the find is asked again of them.
        const [conflict] = await conflictCards(c);
        await act(async () => { fireEvent.click(conflict!.radio("draft")); });
        await settle();
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 14 h spare"]]), { timeout: 15_000 });
        expect([h.fits.outcomes(), failure(c)]).toEqual([["conflict", "success"], undefined]);
    });

    test("rule 11 — asked again on a save by another page and on a change of what the page reads; a choice on the rail asks nothing again", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        expect(h.fits.calls()).toBe(1);
        // A choice on the rail: the tab lists the fit among what the rail shows, and nothing is asked.
        await narrow(store, "rosterWarehouse", "people", values("team", [text("inbound")]));
        await waitFor(() => expect(pane(c).querySelector("[data-library-empty]")?.textContent).toContain("No one found"));
        await narrow(store, "rosterWarehouse", "people", new Map());
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        expect(h.fits.calls()).toBe(1);
        // Another page's save of the duties: A. Alder's Thursday shift removed, which the page hears of and reads.
        const duties = new Map(await h.read(ex.rosterDuties));
        duties.delete("s1");
        await h.patch(ex.rosterDuties, new SortedMap([...duties], byKey));
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 14 h spare"]]), { timeout: 15_000 });
        const afterSave = h.fits.calls();
        expect(afterSave).toBeGreaterThan(1);
        // A change of what the page reads: J. Quartz's contract cut, in the staff's record.
        const staff = await h.read(ex.rosterStaff);
        staff.set("jquartz", { ...staff.get("jquartz")!, contract: 30 });
        await h.patch(ex.rosterStaff, staff);
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 6 h spare"]]), { timeout: 15_000 });
        expect(h.fits.calls()).toBeGreaterThan(afterSave);
    });

    test("counted — a second ask over the same drafts and the same saved state runs no mutation's program: the function's alone", async () => {
        // The duties as no other test leaves them — a note on one duty — so nothing this test asks is in e3's execution cache
        // before it asks: the cache is the repository's, which every test's workspace shares.
        const duties = new Map(await h.read(ex.rosterDuties));
        duties.set("s2", { ...duties.get("s2")!, note: "Counted" });
        await h.patch(ex.rosterDuties, new SortedMap([...duties], byKey));
        const { container: c } = await open(ex.rosterWarehouse);
        await issues(c);
        /**
         * How many units e3 runs for the call a click starts, each let go as it is held, until the call has its answer.
         * Nothing settles while e3's units are held, so the click is fired alone.
         */
        const unitsFor = async (target: Element | null | undefined) => {
            expect(target).toBeTruthy();
            const units = h.e3.holdUnits();
            const before = h.fits.outcomes().length;
            await act(async () => { fireEvent.click(target!); });
            let ran = 0;
            for (let waited = 0; h.fits.outcomes().length === before && waited < 4_000; waited++) {
                if (units.held > 0) { await act(async () => { await units.releaseOne(); }); ran++; }
                else await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 5); }); });
            }
            units.release();
            await settle();
            return ran;
        };
        // Nothing unsaved: the call lays nothing, and e3 runs the function's program alone.
        const plain = await unitsFor(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["jquartz", "Dispatch · 14 h spare"]]));
        // An unsaved removal: the same question's call lays the draft first — the write a Save runs, without its commit.
        const first = await unitsFor(within(assignment(c, "s1")).getByRole("button", { name: "Remove A. Alder" }));
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 14 h spare"]]));
        // Another question over the same drafts and the same saved state: the laying is served from e3's execution cache.
        const second = await unitsFor(fix(c, TRAINER_ISSUE));
        expect([plain > 0, first > plain, second]).toEqual([true, true, plain]);
        expect(h.fits.drafts().map(drafts => drafts.length)).toEqual([0, 1, 1]);
    });
});
