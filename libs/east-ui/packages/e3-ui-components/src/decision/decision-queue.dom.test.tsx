/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue on e3 itself (#1452, #1458, `Decision Queue Spec.md`
 * §9.1–§9.4), over the smallest queue's example (§3.2) — the model's
 * proposals, read whole, each one decision changing the shop's work orders or
 * the price list, and the verdict on it a field of its own row — and the same
 * queue read only. The cases stand in the record's order, neither sorted nor
 * grouped, the toolbar's count the record's size (R1–R3); one card opens at a
 * time, by a click, Enter or the keys, Escape closing it (R7, R12); a verdict
 * is one step of one history over the cases' record and the record its change
 * lands in, its card becoming a receipt in its place whose Undo is the
 * history's while its step is the last (R23–R25, R27); Save writes each
 * record through its patch door, a request each, and a decided case read
 * whole stays its receipt, with no Undo, across a remount — an Undo past the
 * Save bringing it back (R24, R26, R29, D1); another session's verdict reads
 * back as its receipt, and a case it takes out of the record goes, its open
 * card with it (R6); Override, where the rows hold no reason and no note,
 * asks for neither (R20); Modify edits the price through the record's form,
 * kept across a remount until the verdict (R19, R21); a Save another session
 * overtakes, or whose answer is lost, is the session's banner (R29); and read
 * only, a card shows all of it and takes nothing (R22).
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortedMap, StringType, compareFor, equalFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { decisionQueueMessages as m, type DecisionVerdictWord } from "./messages.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

const proposalEqual = equalFor(ex.Proposal);
const proposalsEqual = equalFor(ex.proposals.type);
const ordersEqual = equalFor(ex.optimiseWorkOrders.type);
const pricesEqual = equalFor(ex.listPrices.type);
const stringEqual = equalFor(StringType);
const byString = compareFor(StringType);

/** A proposal, decoded. */
type ProposalRow = ValueTypeOf<typeof ex.Proposal>;

/** The day the proposal schedules WO-1005 for. */
const MON_16 = new Date("2026-03-16T00:00:00Z");

/** The cases whose cards the list draws, in its order. */
const heads = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-head]")].map(el => el.getAttribute("data-decision-head"));
/** Every case the list draws, in its order: a card or a receipt, by its key. */
const rows = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-card], [data-decision-receipt]")]
    .map(el => el.getAttribute("data-decision-card") ?? el.getAttribute("data-decision-receipt"));
/** A case's card's head. */
const head = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-head="${key}"]`)!;
/** A case's card; `null` where it shows none. */
const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-card="${key}"]`);
/** The receipt standing in its case's place; `null` where none stands. */
const receipt = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-receipt="${key}"]`);
/** A receipt's Undo; `null` where it takes none. */
const undoOf = (container: HTMLElement, key: string) => within(receipt(container, key)!).queryByRole("button", { name: m.undo() });
/** The open card's case's key; `undefined` while none is open. */
const openCard = (container: HTMLElement) => container.querySelector("[data-decision-card][data-open]")?.getAttribute("data-decision-card") ?? undefined;
/** The toolbar's count: e3's of the cases, the record's size read whole. */
const counted = (container: HTMLElement) => slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent;
/** One of a card's actions. */
const action = (container: HTMLElement, key: string, name: string) => within(card(container, key)!).getByRole("button", { name });
/** One of the history item's buttons. */
const history = (container: HTMLElement, name: string) => within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name });
/** Whether anything waits on Save: the history's Discard is on. */
const unsaved = (container: HTMLElement) => !history(container, editingMessages.discard()).disabled;
/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();

/** Presses a control, and lets what it records and sends settle. */
async function press(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** A key pressed where the keyboard is in the queue — else on its main — and what it does settled. */
async function key(container: HTMLElement, init: { key: string; metaKey?: boolean; shiftKey?: boolean }) {
    const active = container.ownerDocument.activeElement;
    const at = active instanceof HTMLElement && container.contains(active) ? active : container.querySelector<HTMLElement>("[data-decision-main]")!;
    await act(async () => { fireEvent.keyDown(at, init); });
    await settle();
}

/** A card's Apply, once the rows its change touches are read and it is on. */
async function applyOf(container: HTMLElement, key: string, name = m.action({ action: "apply" })) {
    await waitFor(() => expect(action(container, key, name).getAttribute("aria-disabled")).toBeNull());
    return action(container, key, name);
}

/** Mounts the smallest queue, and waits until both its cases show, in the record's order. */
async function open(example = ex.decisionQueueMinimal) {
    const ui = await h.mount(example);
    await waitFor(() => expect(heads(ui.container)).toEqual(["prop-north", "prop-wo1005"]));
    return ui;
}

/** A proposal as the model wrote it, with a verdict: the smallest queue's verdict holds nothing but which it is. */
const decided = (key: string, verdict: DecisionVerdictWord): ProposalRow => ({ ...ex.proposalRows.get(key)!, verdict: variant(verdict, null) });

/** The proposals with some rows as given, every other as the model wrote it. */
const proposalsWith = (...changed: [string, ProposalRow][]) => new SortedMap<string, ProposalRow>([...ex.proposalRows, ...changed], byString);

/** Whether a case's row, as saved, holds the verdict, and every other field as the model wrote it. */
async function savedAs(key: string, verdict: DecisionVerdictWord) {
    const saved = (await h.read(ex.proposals)).get(key);
    expect(saved).toBeDefined();
    expect(proposalEqual(saved!, decided(key, verdict))).toBe(true);
}

// ── Reading (R1–R3) ─────────────────────────────────────────────────────────

test("the proposals, read whole, stand in the record's order, each waiting one its card, neither sorted nor grouped; the toolbar counts the record's cases, and the first waiting case opens (R1–R3, R7)", async () => {
    const { container } = await open();
    expect(rows(container)).toEqual(["prop-north", "prop-wo1005"]);
    expect(container.querySelector("[data-decision-section]")).toBeNull();
    expect(counted(container)).toBe("2");
    expect(openCard(container)).toBe("prop-north");
    // Each head in the app's words: where its change lands and its scope, the due words — in their tone today — the
    // proposal's title, Proposed and its summary, its value and its unit.
    const week = within(head(container, "prop-north"));
    expect(week.getByText("Pricing · Regional list prices")).toBeDefined();
    expect(week.getByText("by Fri 13").hasAttribute("data-tone")).toBe(false);
    expect(head(container, "prop-north").textContent).toContain("Raise the North list price to $11.50");
    for (const words of [m.chip({ modified: false }), "North $11.20 → $11.50", "+4,300", "uplift / mo"]) expect(week.getByText(words)).toBeDefined();
    const today = within(head(container, "prop-wo1005"));
    expect(today.getByText("Sheet · Workshop orders")).toBeDefined();
    expect(today.getByText("by 17:00").getAttribute("data-tone")).toBe("today");
    expect(head(container, "prop-wo1005").textContent).toContain("Schedule WO-1005 for Mon 16 Mar");
    for (const words of ["WO-1005 · due Mon 16 Mar", "+1", "orders"]) expect(today.getByText(words)).toBeDefined();
    // The open card: the change's sentence, the figures — its one option, no If wrong, no confidence — and Why's line.
    const body = card(container, "prop-north")!;
    expect(body.textContent).toContain("Demand −1.2% · revenue +1.4%.");
    expect(body.textContent).toContain(m.valueSub({ kind: "only" }));
    expect(within(body).getAllByText(m.noData())).toHaveLength(2);
    expect(within(body).getByRole("button", { name: /^Why/u }).textContent).toContain("demand-north · query 1h ago");
});

// ── One open, and the keys (R7, R12) ────────────────────────────────────────

test("a click on a head opens its card and closes the open one; Escape closes it, the keyboard on its head; j and k step through the waiting cases, and Enter or Space on a head toggles it (R7, R12)", async () => {
    const { container } = await open();
    await press(head(container, "prop-wo1005"));
    expect(openCard(container)).toBe("prop-wo1005");
    expect(card(container, "prop-north")!.hasAttribute("data-open")).toBe(false);
    await key(container, { key: "Escape" });
    expect(openCard(container)).toBeUndefined();
    expect(container.ownerDocument.activeElement).toBe(head(container, "prop-wo1005"));
    // From no card open, j opens the first case the view shows, the keyboard on its head; j the next, k back.
    await key(container, { key: "j" });
    expect(openCard(container)).toBe("prop-north");
    expect(container.ownerDocument.activeElement).toBe(head(container, "prop-north"));
    await key(container, { key: "j" });
    expect(openCard(container)).toBe("prop-wo1005");
    await key(container, { key: "k" });
    expect(openCard(container)).toBe("prop-north");
    await key(container, { key: "Enter" });
    expect(openCard(container)).toBeUndefined();
    await key(container, { key: " " });
    expect(openCard(container)).toBe("prop-north");
});

// ── A verdict is one step (R23–R25, R27) ────────────────────────────────────

test("Apply is one step over the verdict and the price it sets: the card becomes its receipt in its place, the count holds and the keyboard goes to the next waiting case's head, which neither opens nor scrolls; the receipt's Undo brings the case back open, and Redo is the history's (R23–R25, R27)", async () => {
    const { container } = await open();
    await press(await applyOf(container, "prop-north"));
    const left = receipt(container, "prop-north")!;
    expect(left).not.toBeNull();
    expect(within(left).getByText(m.verdict({ verdict: "applied" }))).toBeDefined();
    expect(within(left).getByText("Raise the North list price to $11.50")).toBeDefined();
    expect(card(container, "prop-north")).toBeNull();
    // In its place, and the count the record's still: nothing has left the list.
    expect(rows(container)).toEqual(["prop-north", "prop-wo1005"]);
    expect(counted(container)).toBe("2");
    expect(container.ownerDocument.activeElement).toBe(head(container, "prop-wo1005"));
    expect(openCard(container)).toBeUndefined();
    expect(unsaved(container)).toBe(true);
    // Its Undo, the history's while its step is the last: the case is back, open, and nothing waits on Save.
    await press(undoOf(container, "prop-north")!);
    expect(receipt(container, "prop-north")).toBeNull();
    expect(openCard(container)).toBe("prop-north");
    expect(unsaved(container)).toBe(false);
    // Redo, the history's: decided again, its step the last again, so its receipt takes Undo.
    await press(history(container, editingMessages.redo()));
    expect(card(container, "prop-north")).toBeNull();
    expect(undoOf(container, "prop-north")).not.toBeNull();
    // ⌘Z, the history's key, takes it back again.
    await key(container, { key: "z", metaKey: true });
    expect(heads(container)).toEqual(["prop-north", "prop-wo1005"]);
});

// ── Save (R24, R26, R29) ────────────────────────────────────────────────────

test("Save writes the verdict into the case's own row and the scheduled order through their doors, a request each; read whole, the decided case stays its receipt, with no Undo, and a remount reads it back so (R24, R26, R29)", async () => {
    const { container, unmount } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    await press(head(container, "prop-wo1005"));
    await press(await applyOf(container, "prop-wo1005"));
    expect(undoOf(container, "prop-wo1005")).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.optimiseWorkOrders.name, ex.proposals.name].sort());
    await savedAs("prop-wo1005", "applied");
    // The order as the proposal leaves it — Scheduled, due Mon 16 Mar — and every other as it was.
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders),
        new Map([...orders, ["WO-1005", { ...orders.get("WO-1005")!, status: "Scheduled", due: some(MON_16) }]]))).toBe(true);
    expect(unsaved(container)).toBe(false);
    await waitFor(() => expect(undoOf(container, "prop-wo1005")).toBeNull());
    expect(rows(container)).toEqual(["prop-north", "prop-wo1005"]);
    expect(counted(container)).toBe("2");
    unmount();
    const again = await h.mount(ex.decisionQueueMinimal);
    await waitFor(() => expect(heads(again.container)).toEqual(["prop-north"]));
    expect(within(receipt(again.container, "prop-wo1005")!).getByText(m.verdict({ verdict: "applied" }))).toBeDefined();
    expect(undoOf(again.container, "prop-wo1005")).toBeNull();
    expect(counted(again.container)).toBe("2");
});

test("an Undo past the Save brings the case back to wait, and Save writes its row and the order back as they were (R27, R29, D1)", async () => {
    const { container } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    await press(head(container, "prop-wo1005"));
    await press(await applyOf(container, "prop-wo1005"));
    await press(history(container, editingMessages.apply()));
    await savedAs("prop-wo1005", "applied");
    await press(history(container, editingMessages.undo()));
    await waitFor(() => expect(heads(container)).toEqual(["prop-north", "prop-wo1005"]));
    expect(unsaved(container)).toBe(true);
    await press(history(container, editingMessages.apply()));
    expect(proposalsEqual(await h.read(ex.proposals), ex.proposalRows)).toBe(true);
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders), orders)).toBe(true);
    expect(heads(container)).toEqual(["prop-north", "prop-wo1005"]);
});

test("Defer drafts the verdict alone; Discard returns the case; saved, it writes the case's row and no order (R23, R29)", async () => {
    const { container } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    await press(head(container, "prop-wo1005"));
    await press(action(container, "prop-wo1005", m.action({ action: "defer" })));
    expect(within(receipt(container, "prop-wo1005")!).getByText(m.verdict({ verdict: "deferred" }))).toBeDefined();
    await press(history(container, editingMessages.discard()));
    await waitFor(() => expect(heads(container)).toEqual(["prop-north", "prop-wo1005"]));
    expect(unsaved(container)).toBe(false);
    // Deferred again, and saved: the case's row alone is written.
    await press(head(container, "prop-wo1005"));
    await press(action(container, "prop-wo1005", m.action({ action: "defer" })));
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.proposals.name]);
    await savedAs("prop-wo1005", "deferred");
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders), orders)).toBe(true);
});

// ── Another session (R6) ────────────────────────────────────────────────────

test("a verdict another session saves reads back as the case's receipt, with no Undo, where it stood; a case it takes out of the record goes, the card the viewer opened on it closing with it and none opening in its place (R6)", async () => {
    const { container } = await open();
    await h.patch(ex.proposals, proposalsWith(["prop-wo1005", decided("prop-wo1005", "deferred")]));
    await waitFor(() => expect(receipt(container, "prop-wo1005")).not.toBeNull());
    expect(within(receipt(container, "prop-wo1005")!).getByText(m.verdict({ verdict: "deferred" }))).toBeDefined();
    expect(undoOf(container, "prop-wo1005")).toBeNull();
    expect(rows(container)).toEqual(["prop-north", "prop-wo1005"]);
    expect(openCard(container)).toBe("prop-north");
    // The viewer opens North; another session takes it out of the record: it goes, and no card is open.
    await press(head(container, "prop-north"));
    await press(head(container, "prop-north"));
    expect(openCard(container)).toBe("prop-north");
    await h.patch(ex.proposals, new SortedMap<string, ProposalRow>([["prop-wo1005", decided("prop-wo1005", "deferred")]], byString));
    await waitFor(() => expect(rows(container)).toEqual(["prop-wo1005"]));
    expect(openCard(container)).toBeUndefined();
    expect(counted(container)).toBe("1");
});

// ── Override and Modify (R19–R21) ───────────────────────────────────────────

test("Override… where the rows hold no reason and no note asks for neither: Override case drafts the verdict alone, no price changed; Cancel takes the form back (R20, R23)", async () => {
    const { container } = await open();
    const prices = await h.read(ex.listPrices);
    // The note is the rows' to hold: these hold none, so the card offers none.
    expect(within(card(container, "prop-north")!).queryByRole("button", { name: m.addNote() })).toBeNull();
    await press(action(container, "prop-north", m.action({ action: "override" })));
    const panel = () => within(card(container, "prop-north")!).queryByRole("group", { name: m.whyOverride() });
    expect(panel()).not.toBeNull();
    expect(panel()!.querySelectorAll("[role=radio]")).toHaveLength(0);
    await press(within(panel()!).getByRole("button", { name: m.cancel() }));
    expect(panel()).toBeNull();
    await press(action(container, "prop-north", m.action({ action: "override" })));
    await press(within(panel()!).getByRole("button", { name: m.overrideCase() }));
    expect(within(receipt(container, "prop-north")!).getByText(m.verdict({ verdict: "overridden" }))).toBeDefined();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.proposals.name]);
    await savedAs("prop-north", "overridden");
    expect(pricesEqual(await h.read(ex.listPrices), prices)).toBe(true);
});

/**
 * Types into a number input a key at a time, each key where the caret rests: the shared number input writes what it reads
 * back into the box as a key lands, which user-event's caret does not follow under jsdom when it types several at once.
 */
async function typeKeys(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) {
    for (const char of text) {
        await user.type(el, char);
        await settle();
    }
}

test("Modify edits the price the change leaves through the record's form: the chip reads Modified and Apply Apply with edits; the edit is kept across a remount, and Save writes the price as edited (R19, R21, R23)", async () => {
    const { container, unmount } = await open();
    const prices = await h.read(ex.listPrices);
    await waitFor(() => expect(action(container, "prop-north", m.action({ action: "modify" })).getAttribute("aria-disabled")).toBeNull());
    await press(action(container, "prop-north", m.action({ action: "modify" })));
    // North's row, its form over the price list's fields as the proposal leaves them.
    const row = card(container, "prop-north")!.querySelector<HTMLElement>('[data-decision-row="north"]')!;
    expect(row).not.toBeNull();
    const price = within(row.querySelector<HTMLElement>('[data-field="price"]')!).getByRole("spinbutton");
    expect(price).toHaveProperty("value", "11.5");
    const user = userEvent.setup();
    await user.clear(price);
    await typeKeys(user, price, "11.4");
    await user.keyboard("{Enter}");
    await settle();
    expect(within(head(container, "prop-north")).getByText(m.chip({ modified: true }))).toBeDefined();
    expect(row.querySelector('[data-field="price"][data-dirty]')).not.toBeNull();
    expect(action(container, "prop-north", m.action({ action: "applyEdits" }))).toBeDefined();
    // Remounted, the card is open as it was left, its edit in its form.
    unmount();
    const again = await h.mount(ex.decisionQueueMinimal);
    await waitFor(() => expect(openCard(again.container)).toBe("prop-north"));
    await press(await applyOf(again.container, "prop-north", m.action({ action: "applyEdits" })));
    await press(history(again.container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.listPrices.name, ex.proposals.name].sort());
    await savedAs("prop-north", "applied");
    // North at the price as edited, the demand as the proposal has it; every other region as it was.
    expect(pricesEqual(await h.read(ex.listPrices), new Map([...prices, ["north", { ...prices.get("north")!, price: 11.4, demand: 6_027 }]]))).toBe(true);
});

// ── Another session's Save, and a lost answer (R29) ─────────────────────────

test("a Save another session overtakes with a verdict on the same case is the cases' conflict, in their banner naming the case by its title; the order's commit stands (R29)", async () => {
    const { container } = await open();
    await press(head(container, "prop-wo1005"));
    await press(await applyOf(container, "prop-wo1005"));
    await h.race(ex.proposals, () => { fireEvent.click(history(container, editingMessages.apply())); },
        now => new SortedMap<string, ProposalRow>([...now, ["prop-wo1005", { ...now.get("prop-wo1005")!, verdict: variant("deferred", null) }]], byString));
    const conflict = slot(container, "banners").querySelector('[data-session-banner="conflict"]');
    expect(conflict, slot(container, "banners").textContent ?? "").not.toBeNull();
    expect(conflict!.textContent).toContain(m.casesSession());
    expect(conflict!.textContent).toContain("Schedule WO-1005 for Mon 16 Mar");
    expect(unsaved(container)).toBe(true);
    // The other session's verdict stands, and the order's commit.
    await savedAs("prop-wo1005", "deferred");
    expect((await h.read(ex.optimiseWorkOrders)).get("WO-1005")!.status).toBe("Scheduled");
});

test("a Save whose answer is lost on the way back is the cases' unknown outcome; Retry resends the same request, and the verdict reads back once (R29)", async () => {
    const { container } = await open();
    await press(action(container, "prop-north", m.action({ action: "defer" })));
    const losing = h.e3.fail(request => request.kind === "mutate" && stringEqual(request.record ?? "", ex.proposals.name), "lost");
    await act(async () => { fireEvent.click(history(container, editingMessages.apply())); });
    await waitFor(() => expect(container.querySelector('[data-session-banner="unknown"]')).not.toBeNull(), { timeout: 15_000 });
    losing();
    await press(history(container, editingMessages.retryRequest()));
    const keys = h.requests("mutate", ex.proposals.name).map(request => request.idempotencyKey);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys[0]).toBeDefined();
    expect(new Set(keys).size).toBe(1);
    expect(container.querySelector('[data-session-banner="unknown"]')).toBeNull();
    expect(proposalsEqual(await h.read(ex.proposals), proposalsWith(["prop-north", decided("prop-north", "deferred")]))).toBe(true);
});

// ── Read only (R22) ─────────────────────────────────────────────────────────

test("read only, a card opens and shows all of it but takes nothing: no actions, no note, no history item, and the history's keys write nothing (R22)", async () => {
    const { container } = await open(ex.decisionQueueReadOnly);
    expect(container.querySelector("[data-decision-queue][data-decision-readonly]")).not.toBeNull();
    expect(slot(container, "toolbar").querySelector("[data-toolbar-item='history']")).toBeNull();
    expect(openCard(container)).toBe("prop-north");
    const shown = card(container, "prop-north")!;
    expect(within(shown).queryByRole("group", { name: m.actions() })).toBeNull();
    expect(within(shown).queryByRole("button", { name: m.addNote() })).toBeNull();
    // All of it: the change's sentence, the figures and Why's paragraph.
    expect(shown.textContent).toContain("Demand −1.2% · revenue +1.4%.");
    await press(within(shown).getByRole("button", { name: /^Why/u }));
    expect(shown.textContent).toContain("North demand held at $11.20 through the last two rises; competitors sit at $11.60.");
    // The keys still step through the cases; the history's write nothing.
    await key(container, { key: "j" });
    expect(openCard(container)).toBe("prop-wo1005");
    await key(container, { key: "z", metaKey: true });
    expect(h.requests("mutate")).toEqual([]);
});
