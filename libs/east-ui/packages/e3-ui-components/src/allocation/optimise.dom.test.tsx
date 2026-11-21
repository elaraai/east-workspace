/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Allocation (#1409, #1420, east-workspace#1622; `Optimise
 * Spec.md` §9) on e3: the yard's optimiser is the example's own `e3.function`,
 * called by name on e3 once per run. The eye shows only with an optimiser
 * (R6); a click sends one call over the day — the day, the run's number and
 * the rail's narrowing, and no row (R1, R26): the function reads the bins, the
 * loads and the kilns itself, the board's unsaved edits laid over them as
 * drafts — and while it is out the eye runs, the footer counts, the
 * history is locked and nothing drags (R2); the answer's patch lands as one edit
 * (R7, R8): every load not yet booked booked into a free bay slot and onto
 * the kilns the fit ranks best, the kiln over its maximum relieved — each new
 * bin marked and named for the run, the relinked one marked with where it
 * was, the links the run added or changed drawn outlined in the Elara tone
 * with the kilns' loads glowing, the banner saying what changed, the lane
 * heads and the Arrivals count flashing — and one Undo reverts it all, Redo
 * replays the landing without the banner, Save commits it with everything
 * else (R9, R11). Stop and a day change ignore a late answer (R3, R4);
 * nothing to change and a failed call say so (R10). A run over a day not read
 * yet that turns out to take no edit — published — has its answer wait for
 * the day's read, then refused whole, naming the bin (rule 11). Below 480px the eye is
 * in the toolbar still, and the landing is on the cards; at a phone's toolbar
 * floor it is the View's entry — named for the day, a run and its Stop from
 * there, and on while a day's reads are in flight, which it waits on none of
 * (ruled 27 Oct 2026, "Into the View menu"). What it does with any answer —
 * one that inserts, updates and deletes, one that replaces the whole Dict, one
 * that moves a bin out of the day, another page's save while the call is out,
 * a key another page takes, a bin whose measured spec builds its key
 * (east-workspace#1709, ruling 14) — is the builders' shared cases
 * (`optimise-cases.test-utils.ts`), over the day's bins.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { decodeBeast2For, diffFor, encodeBeast2For, some } from "@elaraai/east";
import { editingMessages, optimiseMessages } from "@elaraai/east-ui-components";
import { Allocation } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import * as opt from "@elaraai/e3-ui/examples/allocation/optimise";
import { act, e3Harness, settle, slot, toolbarAtFloor, width } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { optimiseCases } from "../shared/func/optimise-cases.test-utils.js";
import { kilnYard, stubLinkGeometry } from "./harness.test-utils.js";
import "./index.js";

const h = e3Harness({ "allocation/allocation": ex, "allocation/optimise": opt }, { main: "data-allocation-main" });
const calls = fitCalls(h, { request: Allocation.Types.OptimiseRequest, result: Allocation.Types.OptimiseResult(opt.KilnBins) });
/** The yard's plan day, Tue 11 May 2027. */
const TUE = new Date("2027-05-11T00:00:00Z");
/** The loads the day has not booked, which the optimiser books into its free bay slots, under keys of the run's own. */
const WAITING = ["LD-2231", "LD-2232", "LD-2233", "LD-2234", "LD-2235", "LD-2236"];
/** The bin on the kiln over its maximum, K-207, whose 4 m³ over the optimiser moves to another kiln: a change, in its slot. */
const RELINKED = "3109";

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const history = (c: HTMLElement, name: string) => toolbar(c).getByRole("button", { name });
const added = (c: HTMLElement) => c.querySelectorAll<HTMLElement>('[data-allocation-card][data-op="add"]');
/** Waits for a run's answer to land — e3 runs the optimiser's function for it, which takes its time. */
const landed = (c: HTMLElement, n: number) => waitFor(() => expect(added(c)).toHaveLength(n), { timeout: 10_000 });
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-allocation-footer] [data-footer-line]")!;
/** The links the runs added or changed, drawn for the highlight: each link's group, its casing and its caption carry the Elara tone. */
const elaraLinks = (c: HTMLElement, part = "[data-plan-link]") => c.querySelectorAll(`[data-allocation-links] ${part}[data-tone="elara"]`);
const glowingLoads = (c: HTMLElement) => c.querySelectorAll<HTMLElement>("[data-allocation-load][data-op]");
const lit = (c: HTMLElement) => c.querySelector("[data-allocation-frame]")!.hasAttribute("data-optimise-lit");
/** The day, as the eye names it: `Optimise {period}`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
/** What a day not read yet waits on: a page, a key search, or runs or rows by key, of the bins or of the days. */
const DAY_READS = new Set(["page", "find", "runs", "rows"]);
const dayRead = (request: E3Request) => DAY_READS.has(request.kind)
    && (request.dataset === `records.${ex.kilnBins.name}` || request.dataset === `records.${ex.yardDays.name}`);
/** Presses a key on the board, as the frame hears it: `]` steps the day. */
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
/** Opens the toolbar's View, and finds the eye's entry in it, as it is drawn at each look. */
async function viewEntry(c: HTMLElement): Promise<() => HTMLButtonElement> {
    await press(toolbar(c).getByRole("button", { name: "View" }));
    const view = within(document.body).getByRole("dialog");
    const entry = () => view.querySelector<HTMLButtonElement>("[data-optimise-entry]")!;
    expect(entry()).not.toBeNull();
    return entry;
}
const commits = async () => (await h.history(ex.kilnBins)).commits.map(commit => commit.mutation);
/** The board with its optimiser, its day read: the eye is enabled once the day's bins have landed. */
async function mounted() {
    const { container } = await h.mount(opt.allocationOptimise);
    await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
    return container;
}

describe("the eye in the Allocation", () => {
    test("R6 — the eye shows for a board with an optimiser, named for the day; a board without one has none", async () => {
        const plain = await h.mount(ex.allocationKilnYard);
        expect(eye(plain.container)).toBeNull();
        plain.unmount();
        const container = await mounted();
        expect([eye(container)!.getAttribute("aria-label")!.startsWith("Optimise "), eye(container)!.hasAttribute("data-running")]).toEqual([true, false]);
        // Immediately before the history item.
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2, R26 — one call over the day: the day, the run's number and the rail's narrowing, and no row; the lock while it is out", async () => {
        const container = await mounted();
        const at = period(container);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect([eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("aria-label")]).toEqual([true, "Stop optimising"]);
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${at}`]);
        for (const name of [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()]) {
            expect(history(container, name).getAttribute("aria-disabled")).toBe("true");
        }
        expect([container.querySelector("[data-draggable]"), container.querySelector("[data-allocation-connector]")]).toEqual([null, null]);
        expect(calls.requests()).toHaveLength(1);
        const asked = calls.requests()[0]!;
        // The request names the day and carries no row: no bin, no arrival, nothing of the board's context.
        expect(Object.keys(asked).sort()).toEqual(["day", "run", "slice"]);
        expect([asked.run, asked.day.getTime()]).toEqual([1n, TUE.getTime()]);
        // The rail's narrowing, by source: each of the rail's four, nothing chosen — the bins' their date window alone, the day's.
        expect([...asked.slice].map(([source, where]) => [source, [...where].map(([field, by]) => [field, by.type])]))
            .toEqual([["arrivals", []], ["bays", []], ["bin", [["at", "range"]]], ["kilns", []]]);
        hold.release();
        await landed(container, WAITING.length);
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
        expect([container.querySelector("[data-draggable]"), container.querySelector("[data-allocation-connector]")]).not.toEqual([null, null]);
    });

    test("R7–R9, R11 — the result lands as one edit: the loads booked and marked, the relinked bin marked with where it was, the run's links outlined in the Elara tone and their kilns' loads glowing, the banner and the legend for the highlight, the lane heads and the Arrivals count flashing; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        stubLinkGeometry();
        const container = await mounted();
        const deployed = await commits();
        expect(container.querySelector("[data-allocation-links]")).toBeNull();
        await press(eye(container));
        await landed(container, WAITING.length);
        const at = period(container);
        expect([...added(container)].every(el => el.getAttribute("title")!.startsWith("Added by Elara · run #1"))).toBe(true);
        // The bin relinked in its slot: a change with no ghost, its provenance saying where it was.
        const relinked = container.querySelector<HTMLElement>(`[data-allocation-card="${RELINKED}"]`)!;
        expect([relinked.getAttribute("data-op"), relinked.getAttribute("title")!.startsWith("Was B-2 06:36 on K-207 · Elara run #1"), container.querySelector("[data-allocation-ghost]")]).toEqual(["chg", true, null]);
        // The links the run added or changed draw with nothing selected, outlined in the Elara tone — the six loads' nine parts and the
        // relinked bin's two (its part on K-207 changed, the 4 m³ new on K-401) — each with its casing and its caption in the tone; the
        // kilns they land on take the landing and the glow on their loads, their own fill kept.
        expect([elaraLinks(container).length, elaraLinks(container, "[data-plan-ribbon-casing]").length, elaraLinks(container, "[data-plan-ribbon-label]").length]).toEqual([11, 11, 11]);
        // The layer runs behind the cards while they show: the links pass under the cards they cross, never over their words.
        expect(container.querySelector("[data-allocation-links]")!.hasAttribute("data-under")).toBe(true);
        expect(glowingLoads(container).length).toBeGreaterThan(0);
        expect([...glowingLoads(container)].every(el => el.getAttribute("data-op") === "chg" && el.getAttribute("data-fill") === "own")).toBe(true);
        expect(words(banner(container, "done")!)).toEqual([`Elara optimised ${at}`, `${WAITING.length + 1} changes: ${WAITING.length} added, 1 changed. Undo or apply them like any edit.`]);
        expect([lit(container), container.querySelector("[data-allocation-footer] [data-optimise-legend]")?.textContent]).toEqual([true, "Elara change"]);
        // Every lane took a load: each head's figures flash; the loads left the Arrivals to book, whose count flashes.
        expect(container.querySelectorAll("[data-allocation-lane] [data-opn]")).toHaveLength(3);
        expect(slot(container, "start").querySelector("[data-tab-count][data-opn]")).not.toBeNull();
        const arrivals = within(slot(container, "start"));
        expect(arrivals.queryByRole("button", { name: /Overdue/ })).toBeNull();
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([added(container).length, lit(container), container.querySelectorAll("[data-allocation-card]").length]).toEqual([0, false, 26]);
        expect([container.querySelector("[data-allocation-links]"), glowingLoads(container).length]).toEqual([null, 0]);
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing.
        await press(history(container, editingMessages.redo()));
        await landed(container, WAITING.length);
        await waitFor(() => expect(lit(container)).toBe(true));
        expect(container.querySelector('[data-optimise-banner="done"]:not([data-leaving])')).toBeNull();
        // Save commits the run with everything else, as one patch; nothing is marked once nothing is pending.
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]));
        await waitFor(() => expect(container.querySelectorAll("[data-op]")).toHaveLength(0));
        const bins = await h.read(ex.kilnBins);
        expect(WAITING.map(load => { const bin = bins.get(`elara-1-${load}`); return bin?.load.type === "some" && bin.load.value === load && bin.kilns.size > 0; })).toEqual(WAITING.map(() => true));
        expect(bins.get(RELINKED)!.kilns.get("K-207")).toBe(40);
        expect([lit(container), container.querySelector("[data-optimise-banner]")]).toEqual([false, null]);
    });

    test("R3 — Stop cancels the call: the footer says so, a late answer is ignored, and nothing is recorded", async () => {
        const container = await mounted();
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await press(eye(container));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent])
            .toEqual([false, "note", "Stopped · nothing changed"]);
        hold.release();
        await settle();
        expect([calls.requests().length, added(container).length, container.querySelector("[data-optimise-banner]")]).toEqual([1, 0, null]);
        expect((history(container, editingMessages.apply()) as HTMLButtonElement).disabled).toBe(true);
    });

    test("R4 — a step to another day stops the run as Stop does", async () => {
        const container = await mounted();
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await press(toolbar(container).getByRole("button", { name: "Next day" }));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line")]).toEqual([false, "note"]);
        hold.release();
        await settle();
        expect([calls.requests().length, container.querySelectorAll("[data-op]").length]).toEqual([1, 0]);
    });

    test("rule 11 — a run over a day not read yet that turns out published: the answer waits for the day's read, then is refused whole, naming the bin, and nothing is recorded on the published day", async () => {
        const container = await mounted();
        const deployed = await commits();
        // A week back, to Tue 4 May, published, its reads held: the eye is on, as it waits on none of the day's reads.
        const held = h.e3.hold(dayRead);
        for (let i = 0; i < 7; i++) await key(container, "[");
        await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
        const at = period(container);
        // An answer that changes one of Tue 4's bins, LD-2201's: its loading instruction.
        const Bins = ex.kilnBins.type;
        const before = await h.read(ex.kilnBins);
        const after = decodeBeast2For(Bins)(encodeBeast2For(Bins)(before));
        after.set("3001", { ...before.get("3001")!, instruction: some("Stack on bearers") });
        calls.answer({ bins: diffFor(Bins)(before, after) as never });
        await press(eye(container));
        await waitFor(() => expect(calls.answers()).toHaveLength(1), { timeout: 10_000 });
        await settle();
        // Answered, the run waits: whether the day takes edits is not known until it is read.
        expect([eye(container)!.hasAttribute("data-running"), container.querySelectorAll("[data-op]").length, banner(container, "fail")]).toEqual([true, 0, null]);
        await act(async () => { held.release(); });
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([optimiseMessages.fail({ period: at }),
            optimiseMessages.refusedDetail({ reason: "Elara's answer changes LD-2201, on a day not available to edit." })]);
        expect([container.querySelectorAll("[data-op]").length, await commits()]).toEqual([0, deployed]);
    });

    test("R10 — a result that changes nothing is said so, the eye blinking; a failed call is an alert until the next run", async () => {
        const container = await mounted();
        await press(eye(container));
        await landed(container, WAITING.length);
        // The drafts are the next run's input (O5): with every load booked, the optimiser changes nothing. The blink lasts
        // 560ms, which a slow machine can spend before the banner is read: what it did is watched, not looked at after.
        let blinked = false;
        const watching = new MutationObserver(() => { blinked ||= eye(container)!.hasAttribute("data-blink"); });
        watching.observe(container, { subtree: true, attributes: true, attributeFilter: ["data-blink"] });
        await press(eye(container));
        await said(container, "none");
        watching.disconnect();
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, blinked, calls.requests().length]).toEqual([true, true, 2]);
        expect(added(container)).toHaveLength(WAITING.length);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, added(container).length]).toEqual([true, WAITING.length]);
        restore();
    });

    test("narrow — below 480px the eye is in the toolbar still, and the landing is on the Table's cards", async () => {
        const container = await mounted();
        await press(toolbar(container).getByRole("radio", { name: "Table" }));
        await width(400);
        await waitFor(() => expect(container.querySelector('[data-allocation-cards="table"]')).not.toBeNull());
        await press(eye(container));
        await waitFor(() => expect(container.querySelectorAll('[data-allocation-row-card][data-op="add"]').length).toBeGreaterThan(0), { timeout: 10_000 });
        const card = container.querySelector<HTMLElement>('[data-allocation-row-card][data-op="add"]')!;
        expect([card.getAttribute("title"), card.getAttribute("data-fill"), lit(container)]).toEqual(["Added by Elara · run #1", "own", true]);
        expect(container.querySelector("[data-allocation-band-count][data-opn]")).not.toBeNull();
    });

    test("narrow — at a phone's toolbar floor the eye is the View's entry, never out of the toolbar: named for the day, a run and its Stop from there, and on while a day's reads are in flight (ruled 27 Oct 2026, \"Into the View menu\")", async () => {
        const container = await mounted();
        const at = period(container);
        await toolbarAtFloor();
        // No eye in the row — the history's Save is — and the View lists it in its place.
        expect([eye(container), history(container, editingMessages.apply()) !== null]).toEqual([null, true]);
        const entry = await viewEntry(container);
        expect([entry().getAttribute("aria-label"), entry().textContent, entry().disabled]).toEqual([`Optimise ${at}`, `Optimise ${at}`, false]);
        // A run from it: one call over the day, the footer's line saying so, the entry its Stop.
        const hold = calls.hold();
        await press(entry());
        await hold.holding;
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${at}`]);
        expect([entry().getAttribute("aria-label"), entry().textContent, entry().hasAttribute("data-running")]).toEqual(["Stop optimising", "Stop optimising", true]);
        // Stop from it: the run over, the line saying so, a late answer ignored and nothing recorded.
        await press(entry());
        expect([entry().getAttribute("aria-label"), line(container).getAttribute("data-loading-line")]).toEqual([`Optimise ${at}`, "note"]);
        hold.release();
        await settle();
        expect([calls.requests().length, added(container).length, container.querySelector("[data-optimise-banner]")]).toEqual([1, 0, null]);
        await act(async () => { fireEvent.keyDown(within(document.body).getByRole("dialog"), { key: "Escape" }); });
        await settle();
        // Two days on, the second's reads held — the first read ahead: the entry is on still, named for that day. The
        // request carries no row, so a run waits on none of the day's reads (east-workspace#1622).
        const held = h.e3.hold(dayRead);
        await key(container, "]");
        await key(container, "]");
        const on = await viewEntry(container);
        expect([on().disabled, on().getAttribute("aria-label")?.startsWith("Optimise "), on().querySelector("[data-entry-reason]")]).toEqual([false, true, null]);
        await act(async () => { held.release(); });
        await settle();
    });
});

// The plan day in view, Tue 11 May 2027: its bins, and one the optimiser adds — a load's second bin, later in Bay 1.
optimiseCases<typeof ex.kilnBins.type.value>({
    builder: "the Allocation", h,
    mounted,
    record: ex.kilnBins,
    answer: (patch) => { calls.answer({ bins: patch as never }); },
    add: ["elara-second-bin", (bins) => ({ ...bins.get("3101")!, bay: "B-1", at: new Date("2027-05-11T09:15:00Z") })],
    change: ["3102", (bin) => ({ ...bin, specMeasured: "MC20" })],
    remove: "3109",
    other: ["3101", (bin) => ({ ...bin, instruction: some("Stack on bearers") })],
    // The same slot a day on.
    outside: { to: (bin) => ({ ...bin, at: new Date("2027-05-12T01:56:00Z") }), named: "LD-2202" },
    // Each bin keyed by its measured spec: one the answer measures anew stands under it; one measured as another bin's key, refused.
    keyed: {
        mounted: async () => {
            const { container } = await h.mount(kilnYard({ key: (bin) => bin.specMeasured, optimise: true }));
            await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
            return container;
        },
        move: ["3102", (bin) => ({ ...bin, specMeasured: "MC-3102" }), "MC-3102"],
        taken: [(bin) => ({ ...bin, specMeasured: "3101" }), 'Another bin is keyed "3101" already'],
        op: (c, key) => c.querySelector<HTMLElement>(`[data-allocation-card="${key}"]`)?.getAttribute("data-op") ?? undefined,
    },
});
