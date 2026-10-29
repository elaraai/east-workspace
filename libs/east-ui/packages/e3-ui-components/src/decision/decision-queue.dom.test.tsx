/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue on e3 itself (#1452, `Decision Queue Spec.md` §9.1–§9.4),
 * over the smallest queue's example (§3.2) — the model's proposals, read
 * whole, each one decision changing the shop's work orders or the price list —
 * and the same queue read only. The cases are laid out by when each is due,
 * each section its count and total, the toolbar's count the cases waiting
 * (R1–R3); one card opens at a time, by a click, Enter or the keys, Escape
 * closing it (R7, R12); a verdict is one step of one history over the
 * verdicts and the record its change lands in, its card becoming a receipt
 * whose Undo is the history's (R23, R24, R27); Save writes each record
 * through its patch door, a request each, and a decided case is gone after a
 * remount, an Undo past the Save bringing it back (R29, D1); Override, under
 * verdicts that hold no reason and no note, asks for neither (R20); Modify
 * edits the price through the record's form, kept across a remount until
 * the verdict (R19, R21); a Save another session overtakes, or whose answer
 * is lost, is the session's banner (R29); and read only, a card shows all of
 * it and takes nothing (R22).
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, compareFor, equalFor, none, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

const verdictEqual = equalFor(ex.OpsVerdict);
const ordersEqual = equalFor(ex.optimiseWorkOrders.type);
const pricesEqual = equalFor(ex.listPrices.type);
const verdictsEqual = equalFor(ex.proposalVerdicts.type);
const compareTime = compareFor(DateTimeType);

/** The day the proposal schedules WO-1005 for. */
const MON_13 = new Date("2028-03-13T00:00:00Z");

/** The cases whose cards the list draws, in its order. */
const heads = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-head]")].map(el => el.getAttribute("data-decision-head"));
/** A case's card's head. */
const head = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-head="${key}"]`)!;
/** A case's card; `null` where it shows none. */
const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-card="${key}"]`);
/** The receipt a verdict left where its case's card stood; `null` where none stands. */
const receipt = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-receipt="${key}"]`);
/** The open card's case's key; `undefined` while none is open. */
const openCard = (container: HTMLElement) => container.querySelector("[data-decision-card][data-open]")?.getAttribute("data-decision-card") ?? undefined;
/** The toolbar's count of the cases waiting. */
const waiting = (container: HTMLElement) => slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent;
/** Each section's head as it reads: its label, its count and its total. */
const sections = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-section]")].map(el =>
    [el.getAttribute("data-decision-section"), [...el.children].map(part => part.textContent).filter(text => text !== "").join(" | ")]);
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

/** Mounts the smallest queue, and waits until both its cases show. */
async function open(example = ex.decisionQueueMinimal) {
    const ui = await h.mount(example);
    await waitFor(() => expect(heads(ui.container)).toEqual(["prop-wo1005", "prop-north"]));
    return ui;
}

/** A verdict as the smallest queue's roles write it: the verdict alone, with its time. */
function verdictOf(verdict: "applied" | "overridden" | "deferred" | "handedOff", at: Date) {
    return { verdict: variant(verdict, { at }), option: none, answer: none, reason: none, note: none };
}

/** A case's saved verdict, given within a span: its time read off it, and every other field as the roles write them. */
async function savedVerdict(key: string, verdict: "applied" | "overridden" | "deferred" | "handedOff", from: Date, to: Date) {
    const saved = (await h.read(ex.proposalVerdicts)).get(key);
    expect(saved).toBeDefined();
    const at = saved!.verdict.value.at;
    expect(compareTime(at, from)).toBeGreaterThanOrEqual(0);
    expect(compareTime(at, to)).toBeLessThanOrEqual(0);
    expect(verdictEqual(saved!, verdictOf(verdict, at))).toBe(true);
}

// ── Reading and laying out (R1–R3) ──────────────────────────────────────────

test("the proposals, read whole, laid out by when each is due: Due today and This week, each its count and total; the toolbar counts the cases waiting, and the first opens (R1–R3, R7)", async () => {
    const { container } = await open();
    expect(sections(container)).toEqual([["today", "Due today | 1 | +1"], ["week", "This week | 1 | +4,300"]]);
    expect(waiting(container)).toBe("2");
    // Nothing is past due at the example's pinned time.
    expect(slot(container, "toolbar").querySelector("[data-decision-late]")).toBeNull();
    expect(openCard(container)).toBe("prop-wo1005");
    // Each head in the app's words: where its change lands and its scope, the due words — in the section's tone today —
    // the proposal's title, Proposed and its summary, its value and its unit.
    const today = within(head(container, "prop-wo1005"));
    expect(today.getByText("Sheet · Workshop orders")).toBeDefined();
    expect(today.getByText("by 17:00").getAttribute("data-tone")).toBe("today");
    expect(head(container, "prop-wo1005").textContent).toContain("Schedule WO-1005 for Mon 13 Mar");
    for (const words of [m.chip({ modified: false }), "WO-1005 · due Mon 13 Mar", "+1", "orders"]) expect(today.getByText(words)).toBeDefined();
    const week = within(head(container, "prop-north"));
    expect(week.getByText("Pricing · Regional list prices")).toBeDefined();
    expect(week.getByText("by Fri 10").hasAttribute("data-tone")).toBe(false);
    expect(head(container, "prop-north").textContent).toContain("Raise the North list price to $11.50");
    for (const words of ["North $11.20 → $11.50", "+4,300", "uplift / mo"]) expect(week.getByText(words)).toBeDefined();
    // The open card: the change's sentence, the figures — its one option, no If wrong, no confidence — and Why's line.
    const body = card(container, "prop-wo1005")!;
    expect(body.textContent).toContain("WO-1005 is given a due date and set Scheduled.");
    expect(body.textContent).toContain(m.valueSub({ kind: "only" }));
    expect(within(body).getAllByText(m.noData())).toHaveLength(2);
    expect(within(body).getByRole("button", { name: /^Why/u }).textContent).toContain("sheet copilot · 5m ago");
});

// ── One open, and the keys (R7, R12) ────────────────────────────────────────

test("a click on a head opens its card and closes the open one; Escape closes it, the keyboard on its head; j and k step through the cards, and Enter on a head toggles it (R7, R12)", async () => {
    const { container } = await open();
    await press(head(container, "prop-north"));
    expect(openCard(container)).toBe("prop-north");
    expect(card(container, "prop-wo1005")!.hasAttribute("data-open")).toBe(false);
    await key(container, { key: "Escape" });
    expect(openCard(container)).toBeUndefined();
    expect(container.ownerDocument.activeElement).toBe(head(container, "prop-north"));
    // From no card open, j opens the first, the keyboard on its head; j the next, k back.
    await key(container, { key: "j" });
    expect(openCard(container)).toBe("prop-wo1005");
    expect(container.ownerDocument.activeElement).toBe(head(container, "prop-wo1005"));
    await key(container, { key: "j" });
    expect(openCard(container)).toBe("prop-north");
    await key(container, { key: "k" });
    expect(openCard(container)).toBe("prop-wo1005");
    await key(container, { key: "Enter" });
    expect(openCard(container)).toBeUndefined();
    await key(container, { key: " " });
    expect(openCard(container)).toBe("prop-wo1005");
});

// ── A verdict is one step (R23, R24, R27) ───────────────────────────────────

test("Apply is one step over the verdict and the order it schedules: the card becomes its receipt, the count drops and the keyboard goes to the next card; the receipt's Undo brings the case back open, and Redo is the history's (R23, R24, R27)", async () => {
    const { container } = await open();
    await press(await applyOf(container, "prop-wo1005"));
    const left = receipt(container, "prop-wo1005")!;
    expect(left).not.toBeNull();
    expect(within(left).getByText(m.verdict({ verdict: "applied" }))).toBeDefined();
    expect(within(left).getByText("Schedule WO-1005 for Mon 13 Mar")).toBeDefined();
    expect(card(container, "prop-wo1005")).toBeNull();
    expect(waiting(container)).toBe("1");
    expect(container.ownerDocument.activeElement).toBe(head(container, "prop-north"));
    expect(unsaved(container)).toBe(true);
    // Its Undo, the history's while its step is the last: the case is back, open, and nothing waits on Save.
    await press(within(left).getByRole("button", { name: m.undo() }));
    expect(receipt(container, "prop-wo1005")).toBeNull();
    expect(openCard(container)).toBe("prop-wo1005");
    expect(waiting(container)).toBe("2");
    expect(unsaved(container)).toBe(false);
    // Redo, the history's: decided again — no receipt, since no card was decided.
    await press(history(container, editingMessages.redo()));
    expect(card(container, "prop-wo1005")).toBeNull();
    expect(receipt(container, "prop-wo1005")).toBeNull();
    expect(waiting(container)).toBe("1");
    // ⌘Z, the history's key, takes it back again.
    await key(container, { key: "z", metaKey: true });
    expect(heads(container)).toEqual(["prop-wo1005", "prop-north"]);
});

// ── Save (R29) ──────────────────────────────────────────────────────────────

test("Save writes the verdict and the scheduled order through their doors, a request each; a remount reads the verdict back and shows the case no more (R23, R29)", async () => {
    const { container, unmount } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    const from = new Date();
    await press(await applyOf(container, "prop-wo1005"));
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual(["optimise_work_orders", "proposal_verdicts"]);
    await savedVerdict("prop-wo1005", "applied", from, new Date());
    // The order as the proposal leaves it — Scheduled, due Mon 13 Mar — and every other as it was.
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders),
        new Map([...orders, ["WO-1005", { ...orders.get("WO-1005")!, status: "Scheduled", due: some(MON_13) }]]))).toBe(true);
    expect(unsaved(container)).toBe(false);
    unmount();
    const again = await h.mount(ex.decisionQueueMinimal);
    await waitFor(() => expect(heads(again.container)).toEqual(["prop-north"]));
    expect(waiting(again.container)).toBe("1");
    expect(again.container.querySelector("[data-decision-receipt]")).toBeNull();
});

test("an Undo past the Save brings the case back to wait, and Save writes the verdict and the order back as they were (R27, R29, D1)", async () => {
    const { container } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    await press(await applyOf(container, "prop-wo1005"));
    await press(history(container, editingMessages.apply()));
    expect((await h.read(ex.proposalVerdicts)).has("prop-wo1005")).toBe(true);
    await press(history(container, editingMessages.undo()));
    await waitFor(() => expect(heads(container)).toEqual(["prop-wo1005", "prop-north"]));
    expect(waiting(container)).toBe("2");
    expect(unsaved(container)).toBe(true);
    await press(history(container, editingMessages.apply()));
    expect(verdictsEqual(await h.read(ex.proposalVerdicts), new Map())).toBe(true);
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders), orders)).toBe(true);
    expect(heads(container)).toEqual(["prop-wo1005", "prop-north"]);
});

test("Defer drafts the verdict alone; Discard returns the case; saved, it writes the verdicts and no order (R23, R29)", async () => {
    const { container } = await open();
    const orders = await h.read(ex.optimiseWorkOrders);
    await press(action(container, "prop-wo1005", m.action({ action: "defer" })));
    expect(within(receipt(container, "prop-wo1005")!).getByText(m.verdict({ verdict: "deferred" }))).toBeDefined();
    await press(history(container, editingMessages.discard()));
    await waitFor(() => expect(heads(container)).toEqual(["prop-wo1005", "prop-north"]));
    expect(waiting(container)).toBe("2");
    expect(unsaved(container)).toBe(false);
    // Deferred again, and saved: the verdicts alone are written.
    await press(head(container, "prop-wo1005"));
    const from = new Date();
    await press(action(container, "prop-wo1005", m.action({ action: "defer" })));
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual(["proposal_verdicts"]);
    await savedVerdict("prop-wo1005", "deferred", from, new Date());
    expect(ordersEqual(await h.read(ex.optimiseWorkOrders), orders)).toBe(true);
});

// ── Override and Modify (R19–R21) ───────────────────────────────────────────

test("Override… under verdicts that hold no reason and no note asks for neither: Override case drafts the verdict alone, no price changed; Cancel takes the form back (R20, R23)", async () => {
    const { container } = await open();
    const prices = await h.read(ex.listPrices);
    await press(head(container, "prop-north"));
    // The note is the verdicts' to hold: these hold none, so the card offers none.
    expect(within(card(container, "prop-north")!).queryByRole("button", { name: m.addNote() })).toBeNull();
    await press(action(container, "prop-north", m.action({ action: "override" })));
    const panel = () => within(card(container, "prop-north")!).queryByRole("group", { name: m.whyOverride() });
    expect(panel()).not.toBeNull();
    expect(panel()!.querySelectorAll("[role=radio]")).toHaveLength(0);
    await press(within(panel()!).getByRole("button", { name: m.cancel() }));
    expect(panel()).toBeNull();
    await press(action(container, "prop-north", m.action({ action: "override" })));
    const from = new Date();
    await press(within(panel()!).getByRole("button", { name: m.overrideCase() }));
    expect(within(receipt(container, "prop-north")!).getByText(m.verdict({ verdict: "overridden" }))).toBeDefined();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual(["proposal_verdicts"]);
    await savedVerdict("prop-north", "overridden", from, new Date());
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
    await press(head(container, "prop-north"));
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
    const from = new Date();
    await press(await applyOf(again.container, "prop-north", m.action({ action: "applyEdits" })));
    await press(history(again.container, editingMessages.apply()));
    expect(mutated()).toEqual(["list_prices", "proposal_verdicts"]);
    await savedVerdict("prop-north", "applied", from, new Date());
    // North at the price as edited, the demand as the proposal has it; every other region as it was.
    expect(pricesEqual(await h.read(ex.listPrices), new Map([...prices, ["north", { ...prices.get("north")!, price: 11.4, demand: 6_027 }]]))).toBe(true);
});

// ── Another session, and a lost answer (R29) ────────────────────────────────

test("a Save another session overtakes with a verdict on the same case is the verdicts' conflict, in their banner naming the case; the order's commit stands (R29)", async () => {
    const { container } = await open();
    await press(await applyOf(container, "prop-wo1005"));
    const theirs = verdictOf("deferred", new Date("2028-03-08T14:00:00Z"));
    await h.race(ex.proposalVerdicts, () => { fireEvent.click(history(container, editingMessages.apply())); },
        now => new Map([...now, ["prop-wo1005", theirs]]));
    const conflict = slot(container, "banners").querySelector('[data-session-banner="conflict"]');
    expect(conflict, slot(container, "banners").textContent ?? "").not.toBeNull();
    expect(conflict!.textContent).toContain(m.verdictsSession());
    expect(conflict!.textContent).toContain("Schedule WO-1005 for Mon 13 Mar");
    expect(unsaved(container)).toBe(true);
    // The other session's verdict stands, and the order's commit.
    expect(verdictEqual((await h.read(ex.proposalVerdicts)).get("prop-wo1005")!, theirs)).toBe(true);
    expect((await h.read(ex.optimiseWorkOrders)).get("WO-1005")!.status).toBe("Scheduled");
});

test("a Save whose answer is lost on the way back is the verdicts' unknown outcome; Retry resends the same request, and the verdict reads back once (R29)", async () => {
    const { container } = await open();
    await press(action(container, "prop-wo1005", m.action({ action: "defer" })));
    const losing = h.e3.fail(request => request.kind === "mutate" && request.record === ex.proposalVerdicts.name, "lost");
    await act(async () => { fireEvent.click(history(container, editingMessages.apply())); });
    await waitFor(() => expect(container.querySelector('[data-session-banner="unknown"]')).not.toBeNull(), { timeout: 15_000 });
    losing();
    await press(history(container, editingMessages.retryRequest()));
    const keys = h.requests("mutate", ex.proposalVerdicts.name).map(request => request.idempotencyKey);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys[0]).toBeDefined();
    expect(new Set(keys).size).toBe(1);
    expect(container.querySelector('[data-session-banner="unknown"]')).toBeNull();
    expect([...(await h.read(ex.proposalVerdicts)).keys()]).toEqual(["prop-wo1005"]);
});

// ── Read only (R22) ─────────────────────────────────────────────────────────

test("read only, a card opens and shows all of it but takes nothing: no actions, no note, no history item, and the history's keys write nothing (R22)", async () => {
    const { container } = await open(ex.decisionQueueReadOnly);
    expect(container.querySelector("[data-decision-queue][data-decision-readonly]")).not.toBeNull();
    expect(slot(container, "toolbar").querySelector("[data-toolbar-item='history']")).toBeNull();
    expect(openCard(container)).toBe("prop-wo1005");
    const shown = card(container, "prop-wo1005")!;
    expect(within(shown).queryByRole("group", { name: m.actions() })).toBeNull();
    expect(within(shown).queryByRole("button", { name: m.addNote() })).toBeNull();
    // All of it: the change's sentence, the figures and Why's paragraph.
    expect(shown.textContent).toContain("WO-1005 is given a due date and set Scheduled.");
    await press(within(shown).getByRole("button", { name: /^Why/u }));
    expect(shown.textContent).toContain("WO-1005 is ready with no due date; its work centre is free from Monday.");
    // The keys still step through the cards; the history's write nothing.
    await key(container, { key: "j" });
    expect(openCard(container)).toBe("prop-north");
    await key(container, { key: "z", metaKey: true });
    expect(h.requests("mutate")).toEqual([]);
});
