/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue's previews on e3 itself (#1453, `Decision Queue Spec.md`
 * §9.5), over the full queue's example (§3.3): the models' cases read through
 * the rail's source, each option's change landing where its tag says — here
 * the warehouse rota's duties, drawn as the Roster draws them, the print
 * works' jobs, drawn as the Plan draws them, the workshop's maintenance,
 * drawn as the Calendar draws it, and the kiln yard's bins, drawn as the
 * Allocation draws them. The cases are laid out by when each is due,
 * money printed as money and the orders as a count — a section of both with
 * no total — the routine case in its band (R1–R3, R28); a card's preview
 * stands between its title and its chip line, open or closed (P1), the People
 * week's crop of the people the change lands on, their hours before → after in
 * the tone the change gives them, the duty it proposes marked where it lands
 * and a ghost where it was, every other as it stands, and one sentence naming
 * it (P4, P13, P14, P19, P24, P25); the Plan's lanes, the presses the change
 * touches over the hours around it, each its booked share before → after
 * (P13–P16, P24, P25); the Calendar's, a lane a day the change lands on over
 * the same hours, each its overlaps before → after (P13–P15, P24, P25); the
 * Allocation's, the kilns a change's bins land on and the Waiting row they
 * leave, beside the kilns' charges, each its load before → after and a bin
 * under its kiln's minimum flagged (P13–P17, P24, P25); the
 * Sheet's, the work orders the change sets under the columns it sets, the
 * model's guess dotted (P3, P13, P25, P26); the recommended option says so on
 * its line (R14); choosing another option draws its change, and one that
 * changes nothing draws the people, or the days, the recommendation lands on,
 * unmarked (P4); Apply, once the question is answered, writes the duty and the
 * verdict through their doors (R16, R23, R29), the print case's the job, the
 * workshop case's the maintenance, the yard case's the bin and the orders
 * case's the work orders; and
 * the routine band's Apply all adds the request it proposes (R28).
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, SortedMap, StringType, compareFor, equalFor, none, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

const verdictEqual = equalFor(ex.OpsVerdict);
const dutiesEqual = equalFor(ex.rosterDuties.type);
const jobsEqual = equalFor(ex.planEventJobs.type);
const servicesEqual = equalFor(ex.calendarServices.type);
const binsEqual = equalFor(ex.kilnBins.type);
const ordersEqual = equalFor(ex.optimiseWorkOrders.type);
const compareTime = compareFor(DateTimeType);
const byString = compareFor(StringType);

/** Saturday's late, which the routine case asks an agency to cover. */
const SAT_LATE = new Date("2028-03-11T14:00:00Z");
const SAT_LATE_END = new Date("2028-03-11T22:00:00Z");
/** The days the orders case gives the ready orders. */
const MON_13 = new Date("2028-03-13T00:00:00Z");
const TUE_14 = new Date("2028-03-14T00:00:00Z");
const WED_15 = new Date("2028-03-15T00:00:00Z");

/** The cases whose cards the list draws, in its order. */
const heads = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-head]")].map(el => el.getAttribute("data-decision-head"));
/** A case's card's head. */
const head = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-head="${key}"]`)!;
/** A case's card. */
const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-card="${key}"]`)!;
/** The open card's case's key; `undefined` while none is open. */
const openCard = (container: HTMLElement) => container.querySelector("[data-decision-card][data-open]")?.getAttribute("data-decision-card") ?? undefined;
/** Each section's head as it reads: its label, its count and its total. */
const sections = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-section]")].map(el =>
    [el.getAttribute("data-decision-section"), [...el.children].map(part => part.textContent).filter(text => text !== "").join(" | ")]);
/** A case's preview: the one image in its card's head. */
const preview = (container: HTMLElement, key: string) => head(container, key).querySelector<HTMLElement>("[data-decision-preview]")!;
/** A preview's rows, by the name each heads. */
const previewRows = (frame: HTMLElement) => [...frame.querySelectorAll<HTMLElement>("[data-preview-row]")].map(row => row.getAttribute("data-preview-row"));
/** A preview's row by the name it heads. */
const previewRow = (frame: HTMLElement, name: string) => frame.querySelector<HTMLElement>(`[data-preview-row="${name}"]`)!;
/** A row's measure, as it reads, and the tone it is drawn in: `undefined` for neither better nor worse. */
function measure(row: HTMLElement, text: string): string | undefined {
    return within(row).getByText(text).getAttribute("data-tone") ?? undefined;
}
/** A duty's tile in a row, as the change marks it: its mark, its fill and its title. */
function tile(row: HTMLElement, key: string) {
    const el = row.querySelector<HTMLElement>(`[data-preview-tile="${key}"]`);
    return el === null ? undefined : { op: el.getAttribute("data-op") ?? undefined, fill: el.getAttribute("data-fill") ?? undefined, title: el.getAttribute("title") };
}
/** Every entry of a key a row draws — a moved event's ghost and where it lands — as the change marks each. */
const tiles = (row: HTMLElement, key: string) => [...row.querySelectorAll<HTMLElement>(`[data-preview-tile="${key}"]`)].map(el =>
    ({ op: el.getAttribute("data-op") ?? undefined, fill: el.getAttribute("data-fill") ?? undefined, title: el.getAttribute("title") }));
/** Every entry a lanes row draws, in its order: its mark, how the board draws it — a resource's job before or after the day — and its title. */
const entries = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-preview-tile]")].map(el =>
    ({ op: el.getAttribute("data-op") ?? undefined, look: el.getAttribute("data-look") ?? undefined, title: el.getAttribute("title") }));
/** The duties a row draws that the change marks. */
const marked = (row: HTMLElement) => [...row.querySelectorAll("[data-preview-tile][data-op]")].map(el => el.getAttribute("data-preview-tile"));
/** A Sheet crop's head: its columns' heads. */
const sheetHead = (frame: HTMLElement) => [...frame.firstElementChild!.children].map(el => el.textContent);
/** A Sheet crop's row's name: its mark and its title. */
function sheetName(row: HTMLElement) {
    const el = row.querySelector<HTMLElement>("[data-preview-name]")!;
    return { op: el.getAttribute("data-op") ?? undefined, title: el.getAttribute("title") };
}
/** A Sheet crop's row's cells, as the change marks each: its column, its value, its mark and fill, its title and its guess's. */
const sheetCells = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-preview-cell]")].map(el => ({
    column: el.getAttribute("data-preview-cell"), value: el.querySelector("[data-value]")?.textContent, op: el.getAttribute("data-op") ?? undefined,
    fill: el.getAttribute("data-fill") ?? undefined, title: el.getAttribute("title"),
    guess: el.querySelector("[data-preview-guess]")?.getAttribute("title") ?? undefined,
}));
/** A lanes crop's ruler: the times it labels. */
const ruler = (frame: HTMLElement) => [...frame.querySelectorAll("[data-preview-ruler] span")].map(el => el.textContent).filter(text => text !== "");
/** One of a card's options, by the start of its name: its label. */
const optionOf = (container: HTMLElement, key: string, label: RegExp) => within(card(container, key)).getByRole("option", { name: label });
/** A card's chip line: `Proposed` or `Modified`, and the summary — the head's part after the preview. */
const chipLine = (container: HTMLElement, key: string) => head(container, key).children[3] as HTMLElement;
/** One of a card's actions. */
const action = (container: HTMLElement, key: string, name: string) => within(card(container, key)).getByRole("button", { name });
/** One of the history item's buttons. */
const history = (container: HTMLElement, name: string) => within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name });
/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();

/** Presses a control, and lets what it records and sends settle. */
async function press(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** Mounts the full queue, and waits until its cards show and the open one's preview has drawn its rows. */
async function open() {
    const ui = await h.mount(ex.decisionQueueOps);
    await waitFor(() => expect(heads(ui.container)).toEqual(["rota-tansy", "print-j3007", "yard-ld2235", "workshop-press1", "orders-ready", "price-coast"]));
    await waitFor(() => expect(previewRows(preview(ui.container, "rota-tansy"))).not.toEqual([]));
    return ui;
}

/** A case's saved verdict, given within a span: its time read off it, and every other field as given. */
async function savedVerdict(key: string, from: Date, to: Date, rest: { option: string; answer?: "yes" | "no" | "unsure" }) {
    const saved = (await h.read(ex.opsVerdicts)).get(key);
    expect(saved).toBeDefined();
    const at = saved!.verdict.value.at;
    expect(compareTime(at, from)).toBeGreaterThanOrEqual(0);
    expect(compareTime(at, to)).toBeLessThanOrEqual(0);
    expect(verdictEqual(saved!, {
        verdict: variant("applied", { at }), option: some(rest.option),
        answer: rest.answer === undefined ? none : some(variant(rest.answer, null)), reason: none, note: none,
    })).toBe(true);
}

// ── Laying out (R1–R3, R28) ─────────────────────────────────────────────────

test("the models' cases by when each is due — Overdue, Due today, This week — each its count and total, money as money; Due today, money beside the orders' count, no total; the routine case in its band; the first opens on its recommendation (R1–R3, R7, R14, R28)", async () => {
    const { container } = await open();
    expect(sections(container)).toEqual([["overdue", "Overdue | 2 | +$86K"], ["today", "Due today | 3"], ["week", "This week | 1 | +$17K"]]);
    expect(slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent).toBe("6");
    const band = container.querySelector<HTMLElement>("[data-decision-routine]")!;
    expect(band.textContent).toContain(m.together({ total: "+$1.2K" }));
    expect(within(band).getByRole("button", { name: m.applyAll({ n: "1" }) })).toBeDefined();
    // The overdue case opens, on its recommendation: its line says so before its note.
    expect(openCard(container)).toBe("rota-tansy");
    const rota = within(head(container, "rota-tansy"));
    expect(rota.getByText("Roster · Picking · W10")).toBeDefined();
    expect(rota.getByText("2h late").getAttribute("data-tone")).toBe("overdue");
    for (const words of [m.chip({ modified: false }), "B. Pumice · Fri 14–22", "+$80K", "uplift"]) expect(rota.getByText(words)).toBeDefined();
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
    // Only the duty the change moves is marked; no other case changes it.
    expect(marked(tansy)).toEqual(["s234"]);
    expect(marked(pumice)).toEqual(["s234"]);
    expect(frame.querySelector("[data-preview-shared]")).toBeNull();
    // The preview sits between the title and the chip line, on the closed card as on the open one.
    const parts = [...head(container, "rota-tansy").children];
    expect(parts.indexOf(frame)).toBe(2);
    await act(async () => { fireEvent.keyDown(container.querySelector<HTMLElement>("[data-decision-main]")!, { key: "Escape" }); });
    await settle();
    expect(openCard(container)).toBeUndefined();
    expect(previewRows(preview(container, "rota-tansy"))).toEqual(["J. Tansy", "B. Pumice"]);
});

test("choosing another option draws its change: A. Osier takes the late, over contract, and the chip reads Modified; an option that changes nothing draws the people the recommendation lands on as they stand, unmarked (P1, P4, P24, R15)", async () => {
    const { container } = await open();
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
    // The queue's now is long past the jobs' day, so no now line.
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
    // Every entry the board's card; nothing breaches, and the queue's now is long past the yard's day.
    expect([...frame().querySelectorAll("[data-preview-tile]")].map(el => el.getAttribute("data-shape"))).toEqual(["bin", "bin", "bin", "bin"]);
    expect(frame().querySelector("[data-breach]")).toBeNull();
    expect(frame().querySelector("[data-preview-now]")).toBeNull();
});

test("choosing the yard case's K-403 on Wed draws LD-2235 booked there on Wed 12, short of the kiln's 10 m³ minimum: its bin flagged with the board's warning, the kiln's load worse, and the chip reads Modified (P15, P17, P24, R15)", async () => {
    const { container } = await open();
    await press(head(container, "yard-ld2235"));
    await press(optionOf(container, "yard-ld2235", /^K-403 on Wed/u));
    const frame = () => preview(container, "yard-ld2235");
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("LD-2235 leaves Waiting and is held in K-403 from Wed 12 07:15 to Fri 21 00:00"));
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
    expect(sheetCells(previewRow(frame(), "WO-1005"))).toEqual(set("13 Mar 28", undefined));
    expect(sheetCells(previewRow(frame(), "WO-1007"))).toEqual(set("14 Mar 28", guess));
    expect(sheetCells(previewRow(frame(), "WO-1008"))).toEqual(set("15 Mar 28", undefined));
    // Each row is named by its first column, unmarked: its cells show its change. No other case changes them.
    expect(sheetName(previewRow(frame(), "WO-1005"))).toEqual({ op: undefined, title: "WO-1005" });
    expect(frame().querySelector("[data-preview-shared]")).toBeNull();
});

test("choosing the orders case's WO-1005 alone draws its row alone, and the chip reads Modified (P1, P4, R15)", async () => {
    const { container } = await open();
    await press(head(container, "orders-ready"));
    await press(optionOf(container, "orders-ready", /^WO-1005 only/u));
    const frame = () => preview(container, "orders-ready");
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("Status and Due change on WO-1005"));
    expect(previewRows(frame())).toEqual(["WO-1005"]);
    expect(sheetHead(frame())).toEqual(["Reference", "Status", "Due"]);
    expect(sheetCells(previewRow(frame(), "WO-1005")).map(cell => [cell.value, cell.op, cell.guess])).toEqual([["Scheduled", "chg", undefined], ["13 Mar 28", "chg", undefined]]);
    expect(chipLine(container, "orders-ready").textContent).toBe(`${m.chip({ modified: true })}WO-1005 only`);
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
    expect(mutated()).toEqual([ex.opsVerdicts.name, ex.optimiseWorkOrders.name].sort());
    await savedVerdict("orders-ready", from, new Date(), { option: "1-all" });
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders), new SortedMap([...orders,
        ["WO-1005", { ...orders.get("WO-1005")!, status: "Scheduled", due: some(MON_13) }],
        ["WO-1007", { ...orders.get("WO-1007")!, status: "Scheduled", due: some(TUE_14) }],
        ["WO-1008", { ...orders.get("WO-1008")!, status: "Scheduled", due: some(WED_15) }],
    ], byString))).toBe(true);
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
    expect(mutated()).toEqual([ex.opsVerdicts.name, ex.planEventJobs.name].sort());
    await savedVerdict("print-j3007", from, new Date(), { option: "1-a1" });
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
    expect(mutated()).toEqual([ex.calendarServices.name, ex.opsVerdicts.name].sort());
    await savedVerdict("workshop-press1", from, new Date(), { option: "1-sat", answer: "yes" });
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
    expect(mutated()).toEqual([ex.kilnBins.name, ex.opsVerdicts.name].sort());
    await savedVerdict("yard-ld2235", from, new Date(), { option: "1-k305", answer: "yes" });
    expect(binsEqual(await h.read(ex.kilnBins), new SortedMap([...bins, ["3127", {
        bay: "B-1", at: new Date("2027-05-11T14:15:00Z"), load: some("LD-2235"), m3: 8, spec: some("MC10"), dryFor: variant("days", 9),
        kilns: new SortedMap([["K-305", 8]], byString), specBooked: "MC10", specMeasured: "MC10", gradeBooked: "P", gradeMeasured: "P1",
        instruction: some("Sticker every 600 mm before loading"),
    }]], byString))).toBe(true);
});

test("Apply waits for the question's answer; answered Yes, it drafts the moved duty and the verdict as one step, and Save writes the duty to B. Pumice and the verdict with its option and answer, a request each (R16, R23, R29)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    const apply = () => action(container, "rota-tansy", m.action({ action: "apply" }));
    expect(apply().getAttribute("aria-disabled")).toBe("true");
    expect(apply().getAttribute("title")).toBe(m.applyOff({ why: "needs" }));
    await press(within(card(container, "rota-tansy")).getByRole("radio", { name: m.answer({ answer: "yes" }) }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="rota-tansy"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsVerdicts.name, ex.rosterDuties.name].sort());
    await savedVerdict("rota-tansy", from, new Date(), { option: "1-pumice", answer: "yes" });
    const friday = duties.get("s234")!;
    expect(dutiesEqual(await h.read(ex.rosterDuties), new SortedMap([...duties, ["s234", { ...friday, who: variant("staff", "bpumice") }]], byString))).toBe(true);
});

// ── The routine band (R28) ──────────────────────────────────────────────────

test("the routine band's Apply all drafts Saturday's agency request and its verdict as one step, its banner's Undo the history's; Save adds the request to the rota (R28, R29)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    const band = () => container.querySelector<HTMLElement>("[data-decision-routine]")!;
    const applyAll = () => within(band()).getByRole("button", { name: m.applyAll({ n: "1" }) });
    await waitFor(() => expect(applyAll().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(applyAll());
    const banner = m.batch({ n: "1" });
    expect(slot(container, "banners").textContent).toContain(banner.description);
    expect(container.querySelector("[data-decision-routine]")).toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsVerdicts.name, ex.rosterDuties.name].sort());
    await savedVerdict("rota-saturday", from, new Date(), { option: "1-request" });
    const thursday = duties.get("s250")!;
    expect(dutiesEqual(await h.read(ex.rosterDuties), new SortedMap([...duties, ["s319", { ...thursday, start: SAT_LATE, end: SAT_LATE_END }]], byString))).toBe(true);
});
