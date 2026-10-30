/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue's previews on e3 itself (#1453, #1455, #1458, `Decision
 * Queue Spec.md` §9.5, §15), over the full queue's example (§3.3) — the mock's
 * cases, like for like: the models' cases read through the rail's source,
 * each option's change landing where its tag says — the warehouse rota's
 * duties, drawn as the Roster draws them, by people and by what they cost,
 * the print works' jobs, drawn as the Plan draws them, the workshop's
 * maintenance, drawn as the Calendar draws it, the kiln yard's bins, drawn as
 * the Allocation draws them, the shop's work orders, drawn as the Sheet draws
 * them, and the stock levels, the lines' cure settings and the price list,
 * which no builder draws, each in its own form. The cases stand in the order
 * the rail's source reads them — the app's index on their judgement, then
 * their area — neither sorted nor sectioned, money printed as money and the
 * orders and the bond as counts, each head where its change lands, when it is
 * due, its title, its chip line, its figure and its status, the routine ones
 * marked so (R1–R3). A
 * card's preview stands between its title and its chip line, open or closed
 * (P1): the People week's crop of the people the change lands on, their hours
 * before → after in the tone the change gives them, the duty it proposes
 * marked where it lands and a ghost where it was, every other as it stands,
 * and one sentence naming it (P4, P13, P14, P19, P24, P25); the Roster's map
 * by cost, each of the warehouse's pay codes its week before → after, as its
 * own pay answers (P7); the Plan's lanes, the presses the change touches over
 * the hours around it, each its booked share before → after (P13–P16, P24,
 * P25); the Calendar's, a lane a day the change lands on over the same hours,
 * each its overlaps before → after (P13–P15, P24, P25); the Allocation's, the
 * kilns a change's bins land on and the Waiting row they leave, beside the
 * kilns' charges, each its load before → after and a bin under its kiln's
 * minimum flagged (P13–P17, P24, P25); the Sheet's, the work orders the change
 * sets under the columns it sets, the model's guess dotted (P3, P13, P25,
 * P26); a record's changed fields, each as it stands and as the change leaves
 * it, printed as its form prints them (P6); the recommended option says so on
 * its line (R14); choosing another option draws its change, and one that
 * changes nothing draws the people, or the days, the recommendation lands on,
 * unmarked (P4); Apply, once the question is answered, writes the duty and the
 * verdict — a field of the case's own row — through their doors (R16, R23,
 * R29), the print case's the job, the workshop case's the maintenance, the
 * yard case's the bin, the stock case's the stock level and the orders case's
 * the work orders; and the routine cases are decided as any case is, Apply on
 * each writing its change — Saturday's cover, Thursday's long shifts trimmed
 * and Press A1's readiness — and its verdict.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { waitFor, within } from "@testing-library/react";
import { DateTimeType, SortedMap, StringType, compareFor, equalFor, none, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, slot } from "../e3-web-mount.test-utils.js";
import { layOutList } from "./list.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import {
    action, axis, card, chartRow, chipLine, entries, fields, head, heads, history, marked, measure, openCard, optionOf, press, preview, previewRow,
    previewRows, ruler, sheetCells, sheetHead, sheetName, tile, tiles,
} from "./preview.test-utils.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

// The list laid out, its frame tall enough that every card mounts.
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = layOutList(12_000); });
afterEach(() => restoreFrame());

const caseEqual = equalFor(ex.OpsCase);
const dutiesEqual = equalFor(ex.rosterDuties.type);
const coverEqual = equalFor(ex.rosterCover.type);
const jobsEqual = equalFor(ex.planEventJobs.type);
const servicesEqual = equalFor(ex.calendarServices.type);
const binsEqual = equalFor(ex.kilnBins.type);
const ordersEqual = equalFor(ex.optimiseWorkOrders.type);
const stockEqual = equalFor(ex.stockLevels.type);
const readinessEqual = equalFor(ex.pressReadiness.type);
const compareTime = compareFor(DateTimeType);
const byString = compareFor(StringType);

/** The queue's cases, in the order the list draws them: the rail's source's, the app's index on their judgement, then their area. */
const CASES = [
    "cover-saturday", "orders-ready", "price-coast", "print-j3007", "ready-a1", "rota-overtime", "rota-tansy", "rota-trim", "stock-c5", "trial-cure",
    "workshop-press1", "yard-ld2235",
];

/** Thursday's long shifts, which the routine trim ends 2h earlier: C. Kestrel's late at 22:00, S. Meadow's night at 06:00. */
const THU_LATE_END = new Date("2028-03-09T22:00:00Z");
const THU_NIGHT_END = new Date("2028-03-10T06:00:00Z");
/** The days the orders case gives the ready orders: Monday to Wednesday next week. */
const MON_16 = new Date("2026-03-16T00:00:00Z");
const TUE_17 = new Date("2026-03-17T00:00:00Z");
const WED_18 = new Date("2026-03-18T00:00:00Z");

/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();
/** Whether a case's preview has drawn what it reads: its rows. */
const drawn = (container: HTMLElement, key: string) => head(container, key).querySelector("[data-decision-preview] [data-preview-row]") !== null;

/**
 * A case's card's head as it reads: where its change lands and the case's scope, when it is due and that word's tone,
 * its title, its chip line, its figure and its unit, and its status.
 *
 * @param container - The page
 * @param key - The case's key
 * @returns Each part's words
 */
function readHead(container: HTMLElement, key: string) {
    const [eyebrow, title, , chips, figures] = [...head(container, key).children];
    const [, scope, due] = [...eyebrow!.children];
    const [value, unit, status] = [...figures!.children];
    return {
        scope: scope!.textContent, due: due?.textContent, tone: due?.getAttribute("data-tone") ?? undefined, title: title!.textContent,
        chips: chips!.textContent, value: value!.textContent, unit: unit!.textContent, status: status?.textContent,
    };
}

/** Mounts the full queue, and waits until its cards show and the open one's preview has drawn its rows. */
async function open() {
    const ui = await h.mount(ex.decisionQueueOps);
    await waitFor(() => expect(heads(ui.container)).toEqual(CASES));
    await waitFor(() => expect(previewRows(preview(ui.container, "rota-tansy"))).not.toEqual([]));
    return ui;
}

/**
 * A case's row as saved: applied within a span — its time read off it — on the option and with the answer given, and
 * every other field as the model wrote it.
 */
async function savedCase(key: string, from: Date, to: Date, rest: { option: string; answer?: "yes" | "no" | "unsure" }) {
    const saved = (await h.read(ex.opsCases)).get(key);
    if (saved === undefined || saved.verdict.type !== "applied") throw new Error(`${key} was not saved applied`);
    const at = saved.verdict.value.at;
    expect(compareTime(at, from)).toBeGreaterThanOrEqual(0);
    expect(compareTime(at, to)).toBeLessThanOrEqual(0);
    expect(caseEqual(saved, {
        ...ex.opsCaseRows.get(key)!, verdict: variant("applied", { at }), option: some(rest.option),
        answer: rest.answer === undefined ? none : some(variant(rest.answer, null)),
    })).toBe(true);
}

// ── Laying out (R1–R3) ──────────────────────────────────────────────────────

test("the mock's cases, like for like, in the order the rail's source reads them — the app's index on their judgement, then their area — neither sorted nor sectioned: each head where its change lands and the case's scope, when it is due, its title, its chip line, its figure and its status, the routine ones marked so, its preview the kind its target draws; the toolbar says e3's count, and the first waiting case opens (R1–R3, R7, R14)", async () => {
    const { container } = await open();
    await waitFor(() => expect(CASES.filter(key => !drawn(container, key))).toEqual([]), { timeout: 15_000 });
    expect(container.querySelector("[data-decision-section]")).toBeNull();
    expect(slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent).toBe("12");
    const proposed = m.chip({ modified: false });
    const needs = m.status({ status: "needsAnswer" });
    const routine = m.status({ status: "routine" });
    expect(CASES.map(key => readHead(container, key))).toEqual([
        { scope: "Capacity · Inbound · Sat 11", title: "Trim Saturday's inbound early cover by one",
            chips: `${proposed}heads 12 → 11`, value: "+$408", unit: "uplift", status: routine },
        { scope: "Sheet · Workshop orders", due: "by Wed 11", title: "Fill 3 due dates on the ready orders from history",
            chips: `${proposed}3 due dates`, value: "+3", unit: "due dates" },
        { scope: "Pricing · Regional list prices", due: "by Fri 13", title: "Raise the Coast list price to $11.00",
            chips: `${proposed}Coast $10.50 → $11.00`, value: "+$17K", unit: "uplift / mo" },
        { scope: "Plan · Print works · Hall B", due: "35m late", tone: "overdue", title: "Move job J-3007 from Press B2 to Press A1",
            chips: `${proposed}A1 · 11:30–14:30`, value: "+$6.2K", unit: "uplift" },
        { scope: "Forecast · Press A1", title: "Confirm Press A1 ready in ~2 days", chips: `${proposed}confirmed`, value: "+2", unit: "days", status: routine },
        { scope: "Roster · Warehouse · W10", due: "by Fri 13", title: "Rebalance week 10 across 3 people",
            chips: `${proposed}3 shifts · 3 people`, value: "+$156", unit: "saved / wk" },
        { scope: "Roster · Picking · W10", due: "2h late", tone: "overdue", title: "Move J. Tansy's Friday late to B. Pumice",
            chips: `${proposed}B. Pumice · Fri 14–22`, value: "+$80K", unit: "uplift", status: needs },
        { scope: "Roster · Inbound · W10", title: "Trim 4h from Thursday's long shifts",
            chips: `${proposed}2 shifts · 10h → 8h`, value: "+$168", unit: "uplift", status: routine },
        { scope: "Inventory · Replenishment", due: "by 16:00", tone: "today", title: "Reorder 2,000 units of C5 envelopes",
            chips: `${proposed}on order 0 → 2,000`, value: "+$42K", unit: "uplift" },
        { scope: "Experiment · Line 2", due: "by Thu 12", title: "Switch line 2 to slow cure",
            chips: `${proposed}cure 40 → 55 min`, value: "+5.2", unit: "MPa bond" },
        { scope: "Calendar · Fabrication", due: "by 17:00", tone: "today", title: "Move Press 1 maintenance to Sat 06:00",
            chips: `${proposed}Press 1 · Sat 3 06:00–08:00`, value: "+$2.4K", unit: "uplift", status: needs },
        { scope: "Allocation · Kiln yard", due: "by 14:00", tone: "today", title: "Load LD-2235 (8 m³) into kiln K-305",
            chips: `${proposed}K-305 · Tue 11 14:15`, value: "+$1.9K", unit: "uplift", status: needs },
    ]);
    expect(CASES.map(key => [preview(container, key).getAttribute("data-kind"), preview(container, key).getAttribute("data-layout")])).toEqual([
        ["record", "fields"], ["sheet", "sheet"], ["record", "fields"], ["plan", "lanes"], ["record", "fields"], ["roster", "cost"],
        ["roster", "roster"], ["roster", "roster"], ["record", "fields"], ["record", "fields"], ["calendar", "lanes"], ["allocation", "lanes"],
    ]);
    // The first waiting case opens.
    expect(openCard(container)).toBe("cover-saturday");
    // Opened, the rota case is on its recommendation: its line says so before its note.
    await press(head(container, "rota-tansy"));
    expect(openCard(container)).toBe("rota-tansy");
    const recommended = optionOf(container, "rota-tansy", /^B\. Pumice/u);
    expect(recommended.getAttribute("aria-selected")).toBe("true");
    expect(within(recommended).getByText(m.recommendedLine({ note: "B. Pumice lands at 32h of 38" }))).toBeDefined();
    expect(within(optionOf(container, "rota-tansy", /^A\. Osier/u)).getByText("A. Osier lands at 40h of 38")).toBeDefined();
});

// ── The Roster's crop (P1, P4, P13, P14, P19, P24, P25) ─────────────────────

test("the rota case's preview is the People week's crop of the people its change lands on: J. Tansy's late on Friday a ghost moving to B. Pumice, where it lands proposed; their hours before → after, J. Tansy's better; every other duty as it stands, and one sentence (P4, P13, P14, P19, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "rota-tansy");
    expect(frame.getAttribute("role")).toBe("img");
    expect(frame.getAttribute("data-kind")).toBe("roster");
    expect(frame.getAttribute("data-layout")).toBe("roster");
    expect(frame.getAttribute("aria-label")).toBe("J. Tansy's Late shift on Fri moves to B. Pumice");
    expect(previewRows(frame)).toEqual(["J. Tansy", "B. Pumice"]);
    const tansy = previewRow(frame, "J. Tansy"), pumice = previewRow(frame, "B. Pumice");
    expect(measure(tansy, "42 → 34h")).toBe("better");
    expect(measure(pumice, "24 → 32h")).toBeUndefined();
    expect(tile(tansy, "s234")).toEqual({ op: "from", fill: undefined, title: "Late · Fri 10 · moves to B. Pumice" });
    expect(tile(pumice, "s234")).toEqual({ op: "add", fill: "own", title: "Late · Fri 10 · proposed" });
    // Only the duty the change moves is marked.
    expect(marked(tansy)).toEqual(["s234"]);
    expect(marked(pumice)).toEqual(["s234"]);
    // The preview sits between the title and the chip line, on the closed card as on the open one.
    expect(openCard(container)).toBe("cover-saturday");
    const parts = [...head(container, "rota-tansy").children];
    expect(parts.indexOf(frame)).toBe(2);
    await press(head(container, "rota-tansy"));
    expect(openCard(container)).toBe("rota-tansy");
    expect(previewRows(preview(container, "rota-tansy"))).toEqual(["J. Tansy", "B. Pumice"]);
});

test("choosing another option draws its change: A. Osier takes the late, over contract, and the chip reads Modified; an option that changes nothing draws the people the recommendation lands on as they stand, unmarked (P1, P4, P24, R15)", async () => {
    const { container } = await open();
    await press(head(container, "rota-tansy"));
    await press(optionOf(container, "rota-tansy", /^A\. Osier/u));
    const frame = () => preview(container, "rota-tansy");
    await waitFor(() => expect(previewRows(frame())).toEqual(["J. Tansy", "A. Osier"]));
    expect(frame().getAttribute("aria-label")).toBe("J. Tansy's Late shift on Fri moves to A. Osier");
    expect(measure(previewRow(frame(), "A. Osier"), "32 → 40h")).toBe("worse");
    expect(tile(previewRow(frame(), "A. Osier"), "s234")).toEqual({ op: "add", fill: "own", title: "Late · Fri 10 · proposed" });
    expect(chipLine(container, "rota-tansy").textContent).toBe(`${m.chip({ modified: true })}A. Osier`);
    expect(within(head(container, "rota-tansy")).getByText("+$72K")).toBeDefined();
    // Keep with J. Tansy changes nothing: J. Tansy and B. Pumice as the week stands, J. Tansy still over contract.
    await press(optionOf(container, "rota-tansy", /^Keep with J\. Tansy/u));
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("Nothing changes for J. Tansy and B. Pumice"));
    expect(previewRows(frame())).toEqual(["J. Tansy", "B. Pumice"]);
    expect(measure(previewRow(frame(), "J. Tansy"), "42h of 38")).toBe("worse");
    expect(measure(previewRow(frame(), "B. Pumice"), "24h of 38")).toBeUndefined();
    expect(frame().querySelectorAll("[data-preview-tile][data-op]")).toHaveLength(0);
    expect(tile(previewRow(frame(), "J. Tansy"), "s234")).toEqual({ op: undefined, fill: undefined, title: "Late · Fri 10" });
    expect(tile(previewRow(frame(), "B. Pumice"), "s234")).toBeUndefined();
    // Back on the recommendation, its change again.
    await press(optionOf(container, "rota-tansy", /^B\. Pumice/u));
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("J. Tansy's Late shift on Fri moves to B. Pumice"));
    expect(chipLine(container, "rota-tansy").textContent).toBe(`${m.chip({ modified: false })}B. Pumice · Fri 14–22`);
});

// ── The Roster's map by cost (P7, P13, P14, P24) ────────────────────────────

test("the overtime case's preview is the Roster's map by cost: week 10's pay by the warehouse's own codes, before and after, as its pay answers — the agency request and the overtime it saves, ghosts left of zero, the ordinary hours they move to glowing right of it — its changes, −$408, +$504 and −$252, the $156 a week the case is worth (P7, P13, P14, P24, P25)", async () => {
    const { container } = await open();
    const frame = () => preview(container, "rota-overtime");
    await waitFor(() => expect(previewRows(frame())).toEqual(["AGENCY", "ORD", "OT1"]));
    expect(frame().getAttribute("data-layout")).toBe("cost");
    expect(frame().getAttribute("aria-label")).toBe("Week 10 pay by code: AGENCY -$408, ORD +$504 and OT1 -$252");
    expect(within(frame()).getByText(m.previewCaption({ caption: "payCode" }))).toBeDefined();
    expect(axis(frame())).toEqual(["-$1K", "0", "+$1K"]);
    expect(chartRow(previewRow(frame(), "AGENCY"))).toEqual({
        title: "AGENCY · $816 → $408 a week", marks: [{ at: undefined, op: "from", fill: undefined }], figures: [{ text: "-$408", tone: "better" }],
    });
    expect(chartRow(previewRow(frame(), "ORD"))).toEqual({
        title: "ORD · $103.3K → $103.8K a week", marks: [{ at: undefined, op: "add", fill: "own" }], figures: [{ text: "+$504", tone: "worse" }],
    });
    expect(chartRow(previewRow(frame(), "OT1"))).toEqual({
        title: "OT1 · $3.8K → $3.5K a week", marks: [{ at: undefined, op: "from", fill: undefined }], figures: [{ text: "-$252", tone: "better" }],
    });
});

// ── The Plan's lanes (P13–P16, P19, P24, P25) ───────────────────────────────

test("the print case's preview is the Plan's lanes over the hours around its change: J-3007's loyalty cards a ghost leaving Press B2, where they overlapped J-3006's market posters, and proposed on Press A1; each press's booked share before → after, B2's better; the window's hours on the ruler, and one sentence (P13–P16, P19, P24, P25)", async () => {
    const { container } = await open();
    const frame = () => preview(container, "print-j3007");
    await waitFor(() => expect(previewRows(frame())).toEqual(["Press B2", "Press A1"]));
    expect(frame().getAttribute("role")).toBe("img");
    expect(frame().getAttribute("data-kind")).toBe("plan");
    expect(frame().getAttribute("data-layout")).toBe("lanes");
    expect(frame().getAttribute("aria-label")).toBe("Loyalty cards leaves Press B2, where it overlapped Market posters, and runs on Press A1 from 11:30 to 14:30");
    // Two hours either side of what the change touches, in whole hours, labelled every three.
    expect(ruler(frame())).toEqual(["08", "11", "14", "17"]);
    const b2 = previewRow(frame(), "Press B2"), a1 = previewRow(frame(), "Press A1");
    expect(measure(b2, "78 → 44%")).toBe("better");
    expect(measure(a1, "0 → 33%")).toBeUndefined();
    expect(tiles(b2, "J-3007")).toEqual([{ op: "from", fill: undefined, title: "Loyalty cards · 10:00–13:00 · moves to Press A1" }]);
    expect(tiles(a1, "J-3007")).toEqual([{ op: "add", fill: "own", title: "Loyalty cards · 11:30–14:30 · proposed" }]);
    // The market posters stand as they are, unmarked, and nothing overlaps once the change is made.
    expect(tiles(b2, "J-3006")).toEqual([{ op: undefined, fill: undefined, title: "Market posters · 06:00–12:00" }]);
    expect(marked(b2)).toEqual(["J-3007"]);
    expect(marked(a1)).toEqual(["J-3007"]);
    expect(frame().querySelector("[data-breach]")).toBeNull();
    // The queue's now is months before the jobs' day, so no now line.
    expect(frame().querySelector("[data-preview-now]")).toBeNull();
});

test("choosing the print case's later start draws J-3007 along Press B2 to 12:00–15:00, clear of the market posters — proposed where it lands, a ghost where it was — B2's share unchanged but better (P13, P14, P24, P25, R15)", async () => {
    const { container } = await open();
    await press(head(container, "print-j3007"));
    await press(optionOf(container, "print-j3007", /^12:00 on B2/u));
    const frame = () => preview(container, "print-j3007");
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("Loyalty cards on Press B2, where it overlapped Market posters, moves to 12:00–15:00"));
    expect(previewRows(frame())).toEqual(["Press B2"]);
    const b2 = previewRow(frame(), "Press B2");
    expect(measure(b2, "78%")).toBe("better");
    expect(tiles(b2, "J-3007")).toEqual([
        { op: "add", fill: "own", title: "Loyalty cards · 12:00–15:00 · proposed" },
        { op: "from", fill: undefined, title: "Loyalty cards · 10:00–13:00 · moves to 12:00–15:00" },
    ]);
    expect(chipLine(container, "print-j3007").textContent).toBe(`${m.chip({ modified: true })}12:00 on B2`);
});

// ── The Calendar's lanes, a day a lane (P4, P13–P15, P24, P25) ──────────────

test("the workshop case's preview is the Calendar's crop, a lane a day over the same hours: Press 1's maintenance a ghost leaving Thursday, where it overlapped the mounting brackets, and proposed on Saturday; each day's overlaps before → after, Thursday's better; the hours on the ruler, and one sentence (P13–P15, P24, P25)", async () => {
    const { container } = await open();
    const frame = () => preview(container, "workshop-press1");
    await waitFor(() => expect(previewRows(frame())).toEqual(["Thu 1", "Sat 3"]));
    expect(frame().getAttribute("data-kind")).toBe("calendar");
    expect(frame().getAttribute("data-layout")).toBe("lanes");
    expect(frame().getAttribute("aria-label"))
        .toBe("Preventive maintenance leaves Thu 1, where it overlapped Mounting brackets · batch 42, and runs on Sat 3 from 06:00 to 08:00");
    // Two hours either side of the times of day the change touches, every day's lane over the same hours.
    expect(ruler(frame())).toEqual(["04", "07", "10", "13"]);
    const thu = previewRow(frame(), "Thu 1"), sat = previewRow(frame(), "Sat 3");
    expect(measure(thu, "overlap 1 → 0")).toBe("better");
    expect(measure(sat, "no overlap")).toBeUndefined();
    expect(tiles(thu, "service1")).toEqual([{ op: "from", fill: undefined, title: "Preventive maintenance · 09:00–11:00 · moves to Sat 3" }]);
    expect(tiles(sat, "service1")).toEqual([{ op: "add", fill: "own", title: "Preventive maintenance · 06:00–08:00 · proposed" }]);
    // The mounting brackets stand as they are, unmarked; nothing on another machine is drawn, and nothing overlaps once
    // the change is made.
    expect(tiles(thu, "job1")).toEqual([{ op: undefined, fill: undefined, title: "Mounting brackets · batch 42 · 06:00–10:00" }]);
    expect(marked(thu)).toEqual(["service1"]);
    expect(marked(sat)).toEqual(["service1"]);
    expect(frame().querySelectorAll("[data-preview-tile]")).toHaveLength(3);
    expect(frame().querySelector("[data-breach]")).toBeNull();
});

test("the workshop case's Keep changes nothing: Thursday as it stands, the maintenance and the brackets overlapping, beside the Saturday the recommendation would land on, free (P4, P15, P24)", async () => {
    const { container } = await open();
    await press(head(container, "workshop-press1"));
    await press(optionOf(container, "workshop-press1", /^Keep Thu 09:00/u));
    const frame = () => preview(container, "workshop-press1");
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("Nothing changes for Thu 1 and Sat 3"));
    expect(previewRows(frame())).toEqual(["Thu 1", "Sat 3"]);
    const thu = previewRow(frame(), "Thu 1");
    expect(measure(thu, "1 overlap")).toBe("worse");
    expect(measure(previewRow(frame(), "Sat 3"), "free")).toBeUndefined();
    expect(frame().querySelectorAll("[data-preview-tile][data-op]")).toHaveLength(0);
    expect(tiles(thu, "service1")).toEqual([{ op: undefined, fill: undefined, title: "Preventive maintenance · 09:00–11:00 · overlaps Mounting brackets · batch 42" }]);
    expect(tiles(thu, "job1")).toEqual([{ op: undefined, fill: undefined, title: "Mounting brackets · batch 42 · 06:00–10:00 · overlaps Preventive maintenance" }]);
    expect(chipLine(container, "workshop-press1").textContent).toBe(`${m.chip({ modified: true })}Keep Thu 09:00`);
});

// ── The Allocation's crop (P13–P17, P24, P25) ───────────────────────────────

test("the yard case's preview is the Allocation's crop: LD-2235 booked into K-305 on Tue 11 at 14:15 and held to Thu 20, between the kiln's charge before it and the one planned after, its window a ghost on the Waiting row it leaves; each lane's load before → after, the Waiting row's better; the weeks on the ruler, and one sentence (P13–P16, P24, P25)", async () => {
    const { container } = await open();
    const frame = () => preview(container, "yard-ld2235");
    await waitFor(() => expect(previewRows(frame())).toEqual(["K-305", "Waiting"]));
    expect(frame().getAttribute("data-kind")).toBe("allocation");
    expect(frame().getAttribute("data-layout")).toBe("lanes");
    expect(frame().getAttribute("aria-label")).toBe("LD-2235 leaves Waiting and is held in K-305 from Tue 11 14:15 to Thu 20 00:00");
    // Whole days either side of what the change touches — the load's window and the bin's hold — past a week by weeks.
    expect(ruler(frame())).toEqual(["May 9", "May 16"]);
    const kiln = previewRow(frame(), "K-305"), waiting = previewRow(frame(), "Waiting");
    expect(measure(kiln, "0 → 8 m³")).toBeUndefined();
    expect(measure(waiting, "8 → 0 m³")).toBe("better");
    expect(entries(kiln)).toEqual([
        { op: undefined, look: "prior", title: "C-3151 · Wed 28 00:00–Tue 11 00:00" },
        { op: undefined, look: "next", title: "planned · Thu 20 00:00–Fri 28 00:00" },
        { op: "add", look: undefined, title: "LD-2235 · 8 m³ · Tue 11 14:15–Thu 20 00:00 · proposed" },
    ]);
    expect(entries(waiting)).toEqual([{ op: "from", look: undefined, title: "LD-2235 · Mon 10 00:00–Thu 13 00:00 · moves to K-305" }]);
    // Every entry the board's card; nothing breaches, and the queue's now is a year before the yard's day.
    expect([...frame().querySelectorAll("[data-preview-tile]")].map(el => el.getAttribute("data-shape"))).toEqual(["bin", "bin", "bin", "bin"]);
    expect(frame().querySelector("[data-breach]")).toBeNull();
    expect(frame().querySelector("[data-preview-now]")).toBeNull();
});

test("choosing the yard case's K-403 on Wed draws LD-2235 booked there on Wed 12, short of the kiln's 10 m³ minimum: its bin flagged with the board's warning, which the sentence names, the kiln's load worse, and the chip reads Modified (P15, P17, P24, P25, R15)", async () => {
    const { container } = await open();
    await press(head(container, "yard-ld2235"));
    await press(optionOf(container, "yard-ld2235", /^K-403 on Wed/u));
    const frame = () => preview(container, "yard-ld2235");
    await waitFor(() => expect(frame().getAttribute("aria-label"))
        .toBe("LD-2235 leaves Waiting and is held in K-403 from Wed 12 07:15 to Fri 21 00:00, which the check flags: 8 m³ · min 10 · 2 short · a warning, Save still works"));
    expect(previewRows(frame())).toEqual(["K-403", "Waiting"]);
    const kiln = previewRow(frame(), "K-403");
    expect(measure(kiln, "0 → 8 m³")).toBe("worse");
    expect(measure(previewRow(frame(), "Waiting"), "8 → 0 m³")).toBe("better");
    // K-403's charges fall outside the days drawn: the one before ends on the 8th, the next starts on the 22nd.
    expect(entries(kiln)).toEqual([
        { op: "add", look: undefined, title: "LD-2235 · 8 m³ · Wed 12 07:15–Fri 21 00:00 · proposed · 8 m³ · min 10 · 2 short · a warning, Save still works" },
    ]);
    expect(kiln.querySelector("[data-preview-tile]")?.hasAttribute("data-breach")).toBe(true);
    expect(chipLine(container, "yard-ld2235").textContent).toBe(`${m.chip({ modified: true })}K-403 on Wed`);
});

// ── A record's changed fields (P1, P6, P24, P25) ────────────────────────────

test("the stock case's preview is the stock levels' changed fields: the C5 envelopes' units on order and their stock-out risk in week 11, each as it stands struck and as the reorder leaves it, printed as the row's own form prints them; choosing 1,500 units draws its change, and the chip reads Modified (P1, P6, P24, P25, R15)", async () => {
    const { container } = await open();
    const frame = () => preview(container, "stock-c5");
    await waitFor(() => expect(previewRows(frame())).toEqual(["C5 envelopes", "C5 envelopes"]));
    expect(frame().getAttribute("aria-label")).toBe("C5 envelopes · On order · 0 → 2,000; C5 envelopes · Stock-out risk · wk 11 · 34 → 3");
    expect(fields(frame())).toEqual([
        { caption: "C5 envelopes · On order", was: "0", now: "2,000", op: "chg", title: "C5 envelopes · On order · 0 → 2,000" },
        { caption: "C5 envelopes · Stock-out risk · wk 11", was: "34", now: "3", op: "chg", title: "C5 envelopes · Stock-out risk · wk 11 · 34 → 3" },
    ]);
    await press(head(container, "stock-c5"));
    await press(optionOf(container, "stock-c5", /^1,500 units/u));
    await waitFor(() => expect(fields(frame()).map(field => [field.was, field.now])).toEqual([["0", "1,500"], ["34", "9"]]));
    expect(chipLine(container, "stock-c5").textContent).toBe(`${m.chip({ modified: true })}1,500 units`);
});

test("the trial case's preview is the cure settings' changed fields: line 2's cure time and the bond strength it gives, as they stand and as the switch leaves them; choosing Trial first draws its one field, the batches on trial (P1, P6, P24, P25, R15)", async () => {
    const { container } = await open();
    const frame = () => preview(container, "trial-cure");
    await waitFor(() => expect(previewRows(frame())).toEqual(["Line 2", "Line 2"]));
    expect(frame().getAttribute("aria-label")).toBe("Line 2 · Cure time · 40 → 55; Line 2 · Bond strength · 41 → 46.2");
    expect(fields(frame())).toEqual([
        { caption: "Line 2 · Cure time", was: "40", now: "55", op: "chg", title: "Line 2 · Cure time · 40 → 55" },
        { caption: "Line 2 · Bond strength", was: "41", now: "46.2", op: "chg", title: "Line 2 · Bond strength · 41 → 46.2" },
    ]);
    await press(head(container, "trial-cure"));
    await press(optionOf(container, "trial-cure", /^Trial first/u));
    await waitFor(() => expect(fields(frame())).toEqual([
        { caption: "Line 2 · Batches on trial", was: "0", now: "48", op: "chg", title: "Line 2 · Batches on trial · 0 → 48" },
    ]));
    expect(chipLine(container, "trial-cure").textContent).toBe(`${m.chip({ modified: true })}Trial first`);
});

// ── The Sheet's crop (P3, P4, P13, P25, P26) ────────────────────────────────

test("the orders case's preview is the Sheet's crop of the work orders its change sets: WO-1005, WO-1007 and WO-1008 under Reference, Status and Due, each set Scheduled and given its due date on the dirty fill; WO-1007's cells the model's guess, dotted; one sentence (P3, P13, P25, P26)", async () => {
    const { container } = await open();
    const frame = () => preview(container, "orders-ready");
    await waitFor(() => expect(previewRows(frame())).toEqual(["WO-1005", "WO-1007", "WO-1008"]));
    expect(frame().getAttribute("data-kind")).toBe("sheet");
    expect(frame().getAttribute("data-layout")).toBe("sheet");
    expect(frame().getAttribute("aria-label")).toBe("Status and Due change on WO-1005, WO-1007 and WO-1008. WO-1007 is a low-confidence guess");
    expect(sheetHead(frame())).toEqual(["Reference", "Status", "Due"]);
    const guess = m.guess({ confidence: "0.69" });
    const set = (due: string, guessed: string | undefined) => [
        { column: "status", value: "Scheduled", op: "chg", fill: "cell", title: "Status: Ready → Scheduled", guess: guessed },
        { column: "due", value: due, op: "chg", fill: "cell", title: `Due: — → ${due}`, guess: guessed },
    ];
    expect(sheetCells(previewRow(frame(), "WO-1005"))).toEqual(set("16 Mar 26", undefined));
    expect(sheetCells(previewRow(frame(), "WO-1007"))).toEqual(set("17 Mar 26", guess));
    expect(sheetCells(previewRow(frame(), "WO-1008"))).toEqual(set("18 Mar 26", undefined));
    // Each row is named by its first column, unmarked: its cells show its change.
    expect(sheetName(previewRow(frame(), "WO-1005"))).toEqual({ op: undefined, title: "WO-1005" });
});

test("choosing the orders case's two sure ones draws WO-1005 and WO-1008 alone, neither a guess, and the chip reads Modified (P1, P4, R15)", async () => {
    const { container } = await open();
    await press(head(container, "orders-ready"));
    await press(optionOf(container, "orders-ready", /^Fill the 2 sure ones/u));
    const frame = () => preview(container, "orders-ready");
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("Status and Due change on WO-1005 and WO-1008"));
    expect(previewRows(frame())).toEqual(["WO-1005", "WO-1008"]);
    expect(sheetHead(frame())).toEqual(["Reference", "Status", "Due"]);
    expect(sheetCells(previewRow(frame(), "WO-1005")).map(cell => [cell.value, cell.op, cell.guess])).toEqual([["Scheduled", "chg", undefined], ["16 Mar 26", "chg", undefined]]);
    expect(sheetCells(previewRow(frame(), "WO-1008")).map(cell => [cell.value, cell.op, cell.guess])).toEqual([["Scheduled", "chg", undefined], ["18 Mar 26", "chg", undefined]]);
    expect(chipLine(container, "orders-ready").textContent).toBe(`${m.chip({ modified: true })}Fill the 2 sure ones`);
});

// ── Apply and Save (R16, R23, R29) ──────────────────────────────────────────

test("the orders case's Apply drafts the three orders and the verdict as one step, and Save writes them Scheduled with their due dates and the verdict, a request each (R16, R29)", async () => {
    const { container } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    await press(head(container, "orders-ready"));
    const apply = () => action(container, "orders-ready", m.action({ action: "apply" }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="orders-ready"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsCases.name, ex.optimiseWorkOrders.name].sort());
    await savedCase("orders-ready", from, new Date(), { option: "1-all" });
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders), new SortedMap([...orders,
        ["WO-1005", { ...orders.get("WO-1005")!, status: "Scheduled", due: some(MON_16) }],
        ["WO-1007", { ...orders.get("WO-1007")!, status: "Scheduled", due: some(TUE_17) }],
        ["WO-1008", { ...orders.get("WO-1008")!, status: "Scheduled", due: some(WED_18) }],
    ], byString))).toBe(true);
});

test("the stock case's Apply drafts the C5 envelopes' reorder and the verdict as one step, and Save writes 2,000 units on order at a 3% risk and the verdict, a request each (R16, R29)", async () => {
    const { container } = await open();
    const stock = await h.read(ex.stockLevels);
    await press(head(container, "stock-c5"));
    const apply = () => action(container, "stock-c5", m.action({ action: "apply" }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="stock-c5"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsCases.name, ex.stockLevels.name].sort());
    await savedCase("stock-c5", from, new Date(), { option: "1-q2000" });
    expect(stockEqual(await h.read(ex.stockLevels), new SortedMap([...stock, ["c5", { ...stock.get("c5")!, onOrder: 2_000, risk: 3 }]], byString))).toBe(true);
});

test("the print case's Apply drafts J-3007's move and the verdict as one step, and Save writes the job to Press A1 11:30–14:30 and the verdict, a request each (R16, R29)", async () => {
    const { container } = await open();
    const jobs = await h.read(ex.planEventJobs);
    await press(head(container, "print-j3007"));
    const apply = () => action(container, "print-j3007", m.action({ action: "apply" }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="print-j3007"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsCases.name, ex.planEventJobs.name].sort());
    await savedCase("print-j3007", from, new Date(), { option: "1-a1" });
    const cards = jobs.get("J-3007")!;
    expect(jobsEqual(await h.read(ex.planEventJobs), new SortedMap([...jobs, ["J-3007", {
        ...cards, press: some("a1"), start: some(new Date("2026-10-20T11:30:00Z")), end: some(new Date("2026-10-20T14:30:00Z")),
    }]], byString))).toBe(true);
});

test("the workshop case's Apply waits for its question; answered Yes, it drafts the maintenance's move and the verdict as one step, and Save writes the maintenance to Saturday 06:00–08:00 and the verdict, a request each (R16, R23, R29)", async () => {
    const { container } = await open();
    const services = await h.read(ex.calendarServices);
    await press(head(container, "workshop-press1"));
    const apply = () => action(container, "workshop-press1", m.action({ action: "apply" }));
    expect(apply().getAttribute("aria-disabled")).toBe("true");
    await press(within(card(container, "workshop-press1")).getByRole("radio", { name: m.answer({ answer: "yes" }) }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="workshop-press1"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.calendarServices.name, ex.opsCases.name].sort());
    await savedCase("workshop-press1", from, new Date(), { option: "1-sat", answer: "yes" });
    const service = services.get("service1")!;
    expect(servicesEqual(await h.read(ex.calendarServices), new SortedMap([...services, ["service1", {
        ...service, start: new Date("2026-10-03T06:00:00Z"), end: new Date("2026-10-03T08:00:00Z"),
    }]], byString))).toBe(true);
});

test("the yard case's Apply waits for its question; answered Yes, it drafts LD-2235's bin and the verdict as one step, and Save adds the bin in K-305 to the yard's bins and writes the verdict, a request each (R16, R23, R29)", async () => {
    const { container } = await open();
    const bins = await h.read(ex.kilnBins);
    await press(head(container, "yard-ld2235"));
    const apply = () => action(container, "yard-ld2235", m.action({ action: "apply" }));
    expect(apply().getAttribute("aria-disabled")).toBe("true");
    await press(within(card(container, "yard-ld2235")).getByRole("radio", { name: m.answer({ answer: "yes" }) }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="yard-ld2235"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.kilnBins.name, ex.opsCases.name].sort());
    await savedCase("yard-ld2235", from, new Date(), { option: "1-k305", answer: "yes" });
    expect(binsEqual(await h.read(ex.kilnBins), new SortedMap([...bins, ["3127", {
        bay: "B-1", at: new Date("2027-05-11T14:15:00Z"), load: some("LD-2235"), m3: 8, spec: some("MC10"), dryFor: variant("days", 9),
        kilns: new SortedMap([["K-305", 8]], byString), specBooked: "MC10", specMeasured: "MC10", gradeBooked: "P", gradeMeasured: "P1",
        instruction: some("Sticker every 600 mm before loading"),
    }]], byString))).toBe(true);
});

test("Apply waits for the question's answer; answered Yes, it drafts the moved duty and the verdict as one step, and Save writes the duty to B. Pumice and the verdict with its option and answer, a request each (R16, R23, R29)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    await press(head(container, "rota-tansy"));
    const apply = () => action(container, "rota-tansy", m.action({ action: "apply" }));
    expect(apply().getAttribute("aria-disabled")).toBe("true");
    expect(apply().getAttribute("title")).toBe(m.applyOff({ why: "needs" }));
    await press(within(card(container, "rota-tansy")).getByRole("radio", { name: m.answer({ answer: "yes" }) }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="rota-tansy"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsCases.name, ex.rosterDuties.name].sort());
    await savedCase("rota-tansy", from, new Date(), { option: "1-pumice", answer: "yes" });
    const friday = duties.get("s234")!;
    expect(dutiesEqual(await h.read(ex.rosterDuties), new SortedMap([...duties, ["s234", { ...friday, who: variant("staff", "bpumice") }]], byString))).toBe(true);
});

// ── The routine cases (R16, R29) ────────────────────────────────────────────

test("the routine cases are decided as any case is, each on its own card: Saturday's cover — the first waiting, open — Thursday's long shifts and Press A1's readiness each applied, a step each; Save writes Saturday's inbound early cover at 11 heads, Thursday's two long shifts ended 2h earlier, Press A1's readiness confirmed and the three verdicts, a request a record (R16, R23, R29)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    const cover = await h.read(ex.rosterCover);
    const readiness = await h.read(ex.pressReadiness);
    const from = new Date();
    for (const key of ["cover-saturday", "rota-trim", "ready-a1"]) {
        if (openCard(container) !== key) await press(head(container, key));
        const apply = () => action(container, key, m.action({ action: "apply" }));
        await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
        await press(apply());
        expect(container.querySelector(`[data-decision-receipt="${key}"]`)).not.toBeNull();
    }
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsCases.name, ex.pressReadiness.name, ex.rosterCover.name, ex.rosterDuties.name].sort());
    const to = new Date();
    await savedCase("cover-saturday", from, to, { option: "1-trim" });
    await savedCase("rota-trim", from, to, { option: "1-trim" });
    await savedCase("ready-a1", from, to, { option: "1-confirm" });
    expect(dutiesEqual(await h.read(ex.rosterDuties), new SortedMap([...duties,
        ["s121", { ...duties.get("s121")!, end: THU_LATE_END }],
        ["s153", { ...duties.get("s153")!, end: THU_NIGHT_END }],
    ], byString))).toBe(true);
    const early = cover.get("2028-03-11-inbound-early")!;
    expect(coverEqual(await h.read(ex.rosterCover), new SortedMap([...cover, ["2028-03-11-inbound-early", { ...early, heads: 11n }]], byString))).toBe(true);
    expect(readinessEqual(await h.read(ex.pressReadiness), new SortedMap([...readiness, ["a1", { ...readiness.get("a1")!, confirmed: true }]], byString))).toBe(true);
});
