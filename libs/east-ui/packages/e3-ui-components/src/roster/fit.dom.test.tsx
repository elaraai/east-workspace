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
 * Retry (R4). The warehouse's example asks its greedy fit (R5).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { StringType, none, printFor, variant } from "@elaraai/east";
import { BannerView, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { readRosterSource } from "./identity.js";
import { START, act, assignment, narrow, narrowing, open, rosterHarness, settle, slot, warehouseRoster, type Choice } from "./harness.test-utils.js";

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
        // One question: the issue's need and slot, the week as drafted, and every person — the rail's narrowing notwithstanding.
        expect(h.fits.requests()).toHaveLength(1);
        const asked = h.fits.requests()[0]!;
        expect([asked.need, asked.slot, asked.start]).toEqual([LEAD.need, LEAD.slot, START]);
        expect([asked.context.people.size, asked.week.assignments.size]).toEqual([69, 316]);
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
        expect(h.fits.requests()[1]!.week.assignments.has("s1")).toBe(false);
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
        expect(within(slot(c, "end")).getAllByRole("button", { name: "Mark agreed" }).length).toBeGreaterThan(0);
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
        await press(fix(c, "Unloading · 8.0 h short"));
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
        const answers = h.fits.answers();
        // A. Alder's Thursday shift removed first: A. Alder and J. Quartz both have 14 hours to spare, so the fit ranks them in staff order.
        await press(within(assignment(c, "s1")).getByRole("button", { name: "Remove A. Alder" }));
        await issues(c);
        await press(fix(c, LEAD_ISSUE));
        await waitFor(() => expect(found(c)).toEqual([["aalder", "from Inbound · 14 h spare"], ["jquartz", "Dispatch · 14 h spare"]]));
        const answer = answers().at(-1)!;
        expect(["aalder", "jquartz"].map(key => answer.people.get(key))).toEqual([
            variant("fits", { score: 14, why: "from Inbound · 14 h spare", warn: none }),
            variant("fits", { score: 14, why: "Dispatch · 14 h spare", warn: none }),
        ]);
    });
});
