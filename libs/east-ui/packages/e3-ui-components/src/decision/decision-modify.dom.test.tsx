/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Modify on e3 itself (#1453, #1458, `Decision Queue Spec.md` D9, R19–R21), over
 * the full queue's example (§3.3): each row a case's change writes is edited
 * in the form its builder's inspector shows for one row — the Roster's duty,
 * its times, its position and the duty kind's other fields; the Calendar's
 * maintenance, its title, its placement and its kind's own Details; the
 * Allocation's bin, its lane, its time and its quantity; the Sheet's work
 * order, in its row form; and the price list's row, in its fields. Each edit
 * rewrites the option's change, so the card's preview follows it, the field
 * tinted with its Reset, the panel counting the fields changed, the chip
 * reading Modified and Apply `Apply with edits`; a row kept as it is writes
 * nothing; the record's `ready` holds Apply, in its own words, while an edit
 * fails it; Reset and Reset all put the proposal back; and Save writes each
 * row as edited, and the verdict into the case's own row.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortedMap, StringType, compareFor, equalFor, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { layOutList } from "./list.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import { action, card, chipLine, head, heads, history, measure, press, preview, previewRow, previewRows, sheetCells } from "./preview.test-utils.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

// The list laid out, its frame tall enough that every card mounts.
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = layOutList(12_000); });
afterEach(() => restoreFrame());

const dutiesEqual = equalFor(ex.rosterDuties.type);
const servicesEqual = equalFor(ex.calendarServices.type);
const binsEqual = equalFor(ex.kilnBins.type);
const ordersEqual = equalFor(ex.optimiseWorkOrders.type);
const pricesEqual = equalFor(ex.listPrices.type);
const byString = compareFor(StringType);

/** The days the orders case gives the ready orders: Monday and Tuesday next week. */
const MON_16 = new Date("2026-03-16T00:00:00Z");
const TUE_17 = new Date("2026-03-17T00:00:00Z");
/** Saturday's early slot the workshop case moves Press 1's maintenance to. */
const SAT_06 = new Date("2026-10-03T06:00:00Z");
const SAT_08 = new Date("2026-10-03T08:00:00Z");

/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();
/** A row of a case's Edit panel, by its key. */
const editRow = (container: HTMLElement, key: string, row: string) => card(container, key).querySelector<HTMLElement>(`[data-decision-row="${row}"]`)!;
/** A field of a row's form, by its path. */
const field = (row: HTMLElement, path: string) => row.querySelector<HTMLElement>(`[data-field="${path}"]`)!;
/** A case's Edit panel. */
const panel = (container: HTMLElement, key: string) => within(card(container, key)).getByRole("group", { name: m.editTitle({ override: false }) });
/** What the Edit panel's head says of the edits. */
const panelMeta = (container: HTMLElement, key: string) => within(panel(container, key)).getByText(/drafts on the proposal$/u).textContent;
/** A case's Apply, by its words. */
const apply = (container: HTMLElement, key: string, edited: boolean) => action(container, key, m.action({ action: edited ? "applyEdits" : "apply" }));
/** A changed row's Keep as it is. */
const keep = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('[data-scope="checkbox"][data-part="root"]')]
    .find(el => el.textContent === m.keepAsIs())!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

/** Mounts the full queue, and waits until its cards show and the open one's preview has drawn its rows. */
async function open() {
    const ui = await h.mount(ex.decisionQueueOps);
    await waitFor(() => expect(heads(ui.container)).toEqual([
        "cover-saturday", "orders-ready", "price-coast", "print-j3007", "ready-a1", "rota-overtime", "rota-tansy", "rota-trim", "stock-c5", "trial-cure",
        "workshop-press1", "yard-ld2235",
    ]));
    await waitFor(() => expect(previewRows(preview(ui.container, "rota-tansy"))).not.toEqual([]));
    return ui;
}

/** Answers Yes to a case's question. */
async function answerYes(container: HTMLElement, key: string) {
    await press(within(card(container, key)).getByRole("radio", { name: m.answer({ answer: "yes" }) }));
}

/** Opens a case's Edit panel, once the rows its change touches are read. */
async function modify(container: HTMLElement, key: string) {
    const button = () => action(container, key, m.action({ action: "modify" }));
    await waitFor(() => expect(button().getAttribute("aria-disabled")).toBeNull());
    await press(button());
    expect(panel(container, key)).toBeDefined();
}

/**
 * Types a number into a number input a key at a time, each key where the caret rests — the shared number input writes
 * what it reads back into the box as a key lands — and commits it with ⏎.
 */
async function typeNumber(el: HTMLElement, text: string) {
    const user = userEvent.setup();
    await user.clear(el);
    for (const char of text) {
        await user.type(el, char);
        await settle();
    }
    await user.keyboard("{Enter}");
    await settle();
}

/** Types a text field's new text and commits it with ⏎. */
async function retype(el: HTMLElement, text: string) {
    const user = userEvent.setup();
    await user.clear(el);
    await user.type(el, `${text}{Enter}`);
    await settle();
}

/** Applies a case as edited, once its Apply is on, and saves. */
async function applyAndSave(container: HTMLElement, key: string) {
    await waitFor(() => expect(apply(container, key, true).getAttribute("aria-disabled")).toBeNull());
    await press(apply(container, key, true));
    expect(container.querySelector(`[data-decision-receipt="${key}"]`)).not.toBeNull();
    await press(history(container, editingMessages.apply()));
}

// ── The Roster's form ───────────────────────────────────────────────────────

test("the rota case's duty in the Roster's form: its unpaid break edited, B. Pumice's hours in the preview follow it, the field tinted with its Reset and the panel counting it; Save writes the duty as edited (D9, R19, R21)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    await press(head(container, "rota-tansy"));
    await answerYes(container, "rota-tansy");
    await modify(container, "rota-tansy");
    expect(panelMeta(container, "rota-tansy")).toBe(m.editMeta({ changed: undefined, override: false }));
    // The duty as the change leaves it — B. Pumice's — in the Roster's form: its times, and the duty kind's other fields.
    const row = () => editRow(container, "rota-tansy", "s234");
    expect(row().textContent).toContain("s234");
    const gap = within(field(row(), "unpaidBreak")).getByRole("spinbutton");
    expect(gap).toHaveProperty("value", "0");
    await typeNumber(gap, "30");
    // The preview follows the edit: the late B. Pumice takes is half an hour shorter.
    const frame = () => preview(container, "rota-tansy");
    await waitFor(() => expect(measure(previewRow(frame(), "B. Pumice"), "24 → 31.5h")).toBeUndefined());
    expect(measure(previewRow(frame(), "J. Tansy"), "42 → 34h")).toBe("better");
    expect(row().querySelector('[data-field="unpaidBreak"][data-dirty]')).not.toBeNull();
    expect(panelMeta(container, "rota-tansy")).toBe(m.editMeta({ changed: "1", override: false }));
    expect(chipLine(container, "rota-tansy").textContent).toBe(`${m.chip({ modified: true })}B. Pumice · Fri 14–22`);
    await applyAndSave(container, "rota-tansy");
    expect(mutated()).toEqual([ex.opsCases.name, ex.rosterDuties.name].sort());
    const friday = duties.get("s234")!;
    expect(dutiesEqual(await h.read(ex.rosterDuties),
        new SortedMap([...duties, ["s234", { ...friday, who: variant("staff", "bpumice"), unpaidBreak: 30 }]], byString))).toBe(true);
});

test("the rota case's only duty kept as it is: nothing changes — the preview draws the people the change lands on as they stand, unmarked, its form prints the duty as it stands — and Apply with edits writes the verdict alone (P4, R19, R23)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    await press(head(container, "rota-tansy"));
    await answerYes(container, "rota-tansy");
    await modify(container, "rota-tansy");
    const row = () => editRow(container, "rota-tansy", "s234");
    await press(keep(row()));
    const frame = () => preview(container, "rota-tansy");
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("Nothing changes for J. Tansy and B. Pumice"));
    expect(previewRows(frame())).toEqual(["J. Tansy", "B. Pumice"]);
    expect(frame().querySelectorAll("[data-preview-tile][data-op]")).toHaveLength(0);
    const printed = within(field(row(), "unpaidBreak")).getByRole("textbox", { name: "Unpaid break" });
    expect([printed.hasAttribute("readonly"), (printed as HTMLInputElement).value]).toEqual([true, "0"]);
    expect(panelMeta(container, "rota-tansy")).toBe(m.editMeta({ changed: "1", override: false }));
    await applyAndSave(container, "rota-tansy");
    expect(mutated()).toEqual([ex.opsCases.name]);
    expect(dutiesEqual(await h.read(ex.rosterDuties), duties)).toBe(true);
});

// ── The Calendar's form ─────────────────────────────────────────────────────

test("the workshop case's maintenance in the Calendar's form: its title — the preview's sentence following it — its machine, and its kind's own Details' notes, each rewriting the change; answered Yes, Save writes the maintenance as edited (D9, R19)", async () => {
    const { container } = await open();
    const services = await h.read(ex.calendarServices);
    await press(head(container, "workshop-press1"));
    await answerYes(container, "workshop-press1");
    await modify(container, "workshop-press1");
    const row = () => editRow(container, "workshop-press1", "service1");
    // Its title, a role of the kind's, in the Calendar's form.
    await retype(within(field(row(), "title")).getByRole("textbox"), "Tooling inspection");
    const frame = () => preview(container, "workshop-press1");
    await waitFor(() => expect(frame().getAttribute("aria-label"))
        .toBe("Tooling inspection leaves Thu 1, where it overlapped Mounting brackets · batch 42, and runs on Sat 3 from 06:00 to 08:00"));
    expect(row().querySelector('[data-field="title"][data-dirty]')).not.toBeNull();
    // Its machine, in the placement's fields: every machine offered, Press 2 chosen.
    const machine = field(row(), "resource");
    const trigger = machine.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await press(trigger);
    const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "")!;
    await press(within(listbox).getAllByRole("option").find(option => option.textContent === "Press 2 · Machines")!);
    await waitFor(() => expect(row().querySelector('[data-field="resource"][data-dirty]')).not.toBeNull());
    // Its notes, in the maintenance's own Details, which stand in place of the kind's other fields.
    expect(field(row(), "notes")).toBeNull();
    const notes = within(row()).getByRole("textbox", { name: "Notes" });
    expect(notes).toHaveProperty("value", "Inspect the tooling and check torque.");
    fireEvent.change(notes, { target: { value: "Bring the torque wrench." } });
    await settle();
    await waitFor(() => expect(panelMeta(container, "workshop-press1")).toBe(m.editMeta({ changed: "3", override: false })));
    await applyAndSave(container, "workshop-press1");
    expect(mutated()).toEqual([ex.calendarServices.name, ex.opsCases.name].sort());
    const service = services.get("service1")!;
    expect(servicesEqual(await h.read(ex.calendarServices), new SortedMap([...services, ["service1", {
        ...service, title: "Tooling inspection", start: SAT_06, end: SAT_08, machine: "press2", notes: "Bring the torque wrench.",
    }]], byString))).toBe(true);
});

// ── The Allocation's form ───────────────────────────────────────────────────

test("the yard case's bin in the Allocation's form: its quantity edited, the part wholly on K-305 following it and the kiln's load in the preview with it; answered Yes, Save writes the bin as edited (D9, R19)", async () => {
    const { container } = await open();
    const bins = await h.read(ex.kilnBins);
    await press(head(container, "yard-ld2235"));
    await answerYes(container, "yard-ld2235");
    await modify(container, "yard-ld2235");
    const row = () => editRow(container, "yard-ld2235", "3127");
    const quantity = within(field(row(), "quantity")).getByRole("spinbutton");
    expect(quantity).toHaveProperty("value", "8");
    await typeNumber(quantity, "6");
    const frame = () => preview(container, "yard-ld2235");
    await waitFor(() => expect(measure(previewRow(frame(), "K-305"), "0 → 6 m³")).toBeUndefined());
    expect(row().querySelector('[data-field="quantity"][data-dirty]')).not.toBeNull();
    await applyAndSave(container, "yard-ld2235");
    expect(mutated()).toEqual([ex.kilnBins.name, ex.opsCases.name].sort());
    expect(binsEqual(await h.read(ex.kilnBins), new SortedMap([...bins, ["3127", {
        bay: "B-1", at: new Date("2027-05-11T14:15:00Z"), load: some("LD-2235"), m3: 6, spec: some("MC10"), dryFor: variant("days", 9),
        kilns: new SortedMap([["K-305", 6]], byString), specBooked: "MC10", specMeasured: "MC10", gradeBooked: "P", gradeMeasured: "P1",
        instruction: some("Sticker every 600 mm before loading"),
    }]], byString))).toBe(true);
});

// ── The Sheet's form ────────────────────────────────────────────────────────

test("the orders case's work orders in the Sheet's row form: WO-1007's status edited, its cell in the preview following; WO-1008 kept as it is, its form printed as it stands and its row no change the preview draws; Save writes the two orders the change still sets (D9, R19, R21)", async () => {
    const { container } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    await press(head(container, "orders-ready"));
    await modify(container, "orders-ready");
    const row = (key: string) => editRow(container, "orders-ready", key);
    const status = within(field(row("WO-1007"), "status")).getByRole("textbox");
    expect(status).toHaveProperty("value", "Scheduled");
    await retype(status, "On hold");
    const frame = () => preview(container, "orders-ready");
    await waitFor(() => expect(sheetCells(previewRow(frame(), "WO-1007"))[0]).toMatchObject({ column: "status", value: "On hold", title: "Status: Ready → On hold" }));
    // Kept as it is, WO-1008's form prints the order as it stands, and the change no longer sets it: the preview draws
    // the two orders it still sets.
    await press(keep(row("WO-1008")));
    const printed = within(field(row("WO-1008"), "status")).getByRole("textbox");
    expect([printed.hasAttribute("readonly"), (printed as HTMLInputElement).value]).toEqual([true, "Ready"]);
    await waitFor(() => expect(previewRows(frame())).toEqual(["WO-1005", "WO-1007"]));
    expect(frame().getAttribute("aria-label")).toBe("Status and Due change on WO-1005 and WO-1007. WO-1007 is a low-confidence guess");
    expect(panelMeta(container, "orders-ready")).toBe(m.editMeta({ changed: "2", override: false }));
    await applyAndSave(container, "orders-ready");
    expect(mutated()).toEqual([ex.opsCases.name, ex.optimiseWorkOrders.name].sort());
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders), new SortedMap([...orders,
        ["WO-1005", { ...orders.get("WO-1005")!, status: "Scheduled", due: some(MON_16) }],
        ["WO-1007", { ...orders.get("WO-1007")!, status: "On hold", due: some(TUE_17) }],
    ], byString))).toBe(true);
});

// ── A record's form and its check ───────────────────────────────────────────

test("the price case's row in the price list's form: a price off the 5¢ steps fails the app's check, which holds Apply in its own words and says them under the row; Reset and Reset all put the proposal back, and Save writes the price as edited (D9, R19, R21)", async () => {
    const { container } = await open();
    const prices = await h.read(ex.listPrices);
    await press(head(container, "price-coast"));
    await modify(container, "price-coast");
    const row = () => editRow(container, "price-coast", "coast");
    const price = () => within(field(row(), "price")).getByRole("spinbutton");
    expect(price()).toHaveProperty("value", "11");
    const held = m.applyOff({ why: "unready", issues: [{ row: "coast", message: "price: A list price moves in 5¢ steps" }] });
    const issues = () => [...row().querySelectorAll("[data-decision-issue]")].map(el => el.textContent);
    await typeNumber(price(), "11.03");
    await waitFor(() => expect(apply(container, "price-coast", true).getAttribute("aria-disabled")).toBe("true"));
    expect(apply(container, "price-coast", true).getAttribute("title")).toBe(held);
    expect(issues()).toEqual(["price: A list price moves in 5¢ steps"]);
    // The field's Reset puts the proposal's price back: no edit, nothing held.
    await press(within(row()).getByRole("button", { name: m.resetField({ field: "List price" }) }));
    await waitFor(() => expect(apply(container, "price-coast", false).getAttribute("aria-disabled")).toBeNull());
    expect(price()).toHaveProperty("value", "11");
    expect(issues()).toEqual([]);
    expect(chipLine(container, "price-coast").textContent).toBe(`${m.chip({ modified: false })}Coast $10.50 → $11.00`);
    // Off the steps again, and Reset all.
    await typeNumber(price(), "11.03");
    await waitFor(() => expect(issues()).toEqual(["price: A list price moves in 5¢ steps"]));
    await press(within(panel(container, "price-coast")).getByRole("button", { name: m.resetAll() }));
    await waitFor(() => expect(price()).toHaveProperty("value", "11"));
    expect(issues()).toEqual([]);
    // On the steps, the edit stands and Apply is Apply with edits.
    await typeNumber(price(), "11.05");
    expect(issues()).toEqual([]);
    expect(chipLine(container, "price-coast").textContent).toBe(`${m.chip({ modified: true })}Coast $10.50 → $11.00`);
    await applyAndSave(container, "price-coast");
    expect(mutated()).toEqual([ex.listPrices.name, ex.opsCases.name].sort());
    expect(pricesEqual(await h.read(ex.listPrices), new SortedMap([...prices, ["coast", { ...prices.get("coast")!, price: 11.05, demand: 13_916 }]], byString))).toBe(true);
});
