/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A queue over 20,000 cases on e3 itself (#1455, #1458, `Decision Queue
 * Spec.md` D4, D18, §9.1, §15), over the windowed example: a replenishment
 * model's reorders across forty stores, an item at a store each and each its
 * own one proposal (D15), each carrying its verdict, read a page at a time
 * through the rail's one source over the app's own indexes on their judgement
 * — the verdict's tag — then the store and the range. The rail opens on the
 * waiting ones: all 20,000, e3's count in the toolbar, in the index's order,
 * with no cap (R1–R3). A case not read yet is a pending card where it stands,
 * and `j` from where the view rests brings the first case there into view,
 * opening it as its page lands (R2, R12). The stock rows a reorder changes are
 * read by key through their entries, and nothing is read whole. A reorder
 * applied and saved leaves the waiting ones, the Save notice saying so, and
 * reads back under Judgement's applied as its receipt (R24, R26); one whose
 * card the view leaves as its preview settles gives way at once as the view
 * comes back, its receipt standing with no arrival (P22); a verdict
 * drafted on a case the rail then hides is kept by its key, and Save writes
 * it and its stock row, a request each (R29).
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
    SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { layOutList } from "./list.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import { action, card, fields, head, heads, history, openCard, press, preview, settleApplied } from "./preview.test-utils.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

// The list laid out, its frame tall enough for the first of the cards.
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = layOutList(4_000); });
afterEach(() => restoreFrame());

const reorderEqual = equalFor(ex.Reorder);
const stockEqual = equalFor(ex.chainStock.type);
const byString = compareFor(StringType);
const printText = printFor(StringType);

/** The rail's state of the queue's one source, as the store keeps it. */
const SOURCE = "ex.decisionQueueRecordIndexes.decisions";
/** A source's narrowing: each field's choice, as the rail writes it. */
type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** A narrowing: the judgement chosen, and the stores, where any are. */
function choosing(judgement: string, ...stores: string[]): Where {
    const where: Where = new SortedMap([["judgement", variant("values", [printText(judgement)])]], byString);
    if (stores.length > 0) where.set("store", variant("values", stores.map(store => printText(store))));
    return where;
}

/** Writes the source's narrowing, as the rail does. */
async function narrow(where: Where) {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(SOURCE)!);
    await act(async () => { store.write(SOURCE, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

/**
 * The key of the case at a place of the waiting ones, in the judgement index's order: a store's 500 after another's,
 * within a store its ranges by name — Cards, Envelopes, Folders, Labels, Notebooks — and within a range its 100 items.
 */
function keyAt(place: number): string {
    const code = ["CD", "EN", "FD", "LB", "NB"][Math.floor((place % 500) / 100)]!;
    return `${101 + Math.floor(place / 500)}/${code}-${1001 + (place % 100)}`;
}

/** The toolbar's count: e3's of the narrowing. */
const counted = (container: HTMLElement) => slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent;
/** The receipt standing in its case's place; `null` where none stands. */
const receipt = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-receipt="${key}"]`);
/** The places of the cases not read yet that the list draws, as their pending cards. */
const pending = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-pending]")].map(el => Number(el.getAttribute("data-decision-pending")));
/** The Save notice: how many of the cases saved left the narrowing. */
const notice = (container: HTMLElement) => container.querySelector("[data-decision-footer] [data-record-save-notice='']")?.textContent ?? undefined;
/** Every request of a record's dataset, by its kind. */
const kinds = (record: string) => h.requests(undefined, `records.${record}`).map(request => request.kind);
/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();

/** Scrolls the list to a place, as a viewer's wheel does, and lets what it mounts there settle. */
async function scrollList(container: HTMLElement, top: number) {
    const frame = container.querySelector<HTMLElement>('[data-decision-main] [data-virtual-rows="bounded"]')!;
    await act(async () => {
        frame.scrollTop = top;
        frame.dispatchEvent(new Event("scroll"));
    });
    await settle();
}

/** A key pressed where the keyboard is in the queue — else on its main — and what it does settled. */
async function key(container: HTMLElement, init: { key: string }) {
    const active = container.ownerDocument.activeElement;
    const at = active instanceof HTMLElement && container.contains(active) ? active : container.querySelector<HTMLElement>("[data-decision-main]")!;
    await act(async () => { fireEvent.keyDown(at, init); });
    await settle();
}

/** A card's Apply, once the stock row its change touches is read and it is on. */
async function applyOf(container: HTMLElement, key: string) {
    const apply = () => action(container, key, m.action({ action: "apply" }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    return apply();
}

/** Mounts the queue, opened on the waiting ones, and waits until e3 has counted them and the first is open. */
async function open() {
    const ui = await h.mount(ex.decisionQueueRecordIndexes);
    await waitFor(() => expect(counted(ui.container)).toBe("20,000"), { timeout: 15_000 });
    await waitFor(() => expect(openCard(ui.container)).toBe(keyAt(0)));
    return ui;
}

test("the 20,000 waiting reorders are read a page at a time through the rail's source, in the judgement index's order, with no cap: the toolbar says e3's count, the first opens with its preview of the stock row it changes, read by key, and nothing is read whole (R1–R3, D4, D18)", async () => {
    const { container } = await open();
    expect(heads(container).slice(0, 3)).toEqual([keyAt(0), keyAt(1), keyAt(2)]);
    expect(keyAt(0)).toBe("101/CD-1001");
    expect(head(container, "101/CD-1001").textContent).toContain("Reorder 200 units of CD-1001 at Store 101");
    // Its preview: the stock row's changed fields, read by key through the stock levels' entries.
    await waitFor(() => expect(fields(preview(container, "101/CD-1001")).map(field => [field.caption, field.was, field.now])).toEqual([
        ["CD-1001 · Store 101 · On order", "0", "200"],
        ["CD-1001 · Store 101 · Stock-out risk", "12", "2"],
    ]));
    // None read whole: the reorders paged through the rail's source, the stock rows by key.
    for (const record of [ex.reorders.name, ex.chainStock.name]) expect(kinds(record)).not.toContain("read");
    expect(kinds(ex.chainStock.name)).not.toEqual([]);
});

test("a case not read yet is a pending card where it stands; with no card open, j brings the first case where the view rests into view and opens it as its page lands, the keyboard on its head (R2, R12)", async () => {
    const { container } = await open();
    await key(container, { key: "Escape" });
    expect(openCard(container)).toBeUndefined();
    // The reorders' reads held, the view sent some 5,000 cases on: what it shows there is pending cards.
    const held = h.e3.hold(request => request.dataset === `records.${ex.reorders.name}`);
    await scrollList(container, 1_260_000);
    await waitFor(() => expect(held.held).toBeGreaterThan(0));
    const shown = pending(container);
    expect(shown.length).toBeGreaterThan(0);
    expect(heads(container)).toEqual([]);
    await key(container, { key: "j" });
    expect(openCard(container)).toBeUndefined();
    // Its page lands: the case opens where it stands.
    held.release();
    await settle();
    await waitFor(() => expect(openCard(container)).toBeDefined());
    const opened = openCard(container)!;
    const place = Number(card(container, opened).closest("[data-index]")!.getAttribute("data-index"));
    expect(place).toBeGreaterThanOrEqual(Math.min(...shown));
    expect(place).toBeLessThanOrEqual(Math.max(...shown));
    expect(opened).toBe(keyAt(place));
    expect(container.ownerDocument.activeElement).toBe(head(container, opened));
});

test("a reorder applied and saved leaves the waiting ones: Save writes its row and its stock row, a request each, the count is e3's again and the Save notice says one decision left this view; under Judgement's applied it reads back as its receipt, with no Undo (R24, R26, R29)", async () => {
    const { container } = await open();
    const was = (await h.read(ex.reorders)).get("101/CD-1001")!;
    const stock = await h.read(ex.chainStock);
    await press(await applyOf(container, "101/CD-1001"));
    await settleApplied(container, "101/CD-1001");
    expect(receipt(container, "101/CD-1001")).not.toBeNull();
    expect(counted(container)).toBe("20,000");
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.chainStock.name, ex.reorders.name].sort());
    // The verdict a field of the reorder's own row, every other as the model wrote it; its stock row as it leaves it.
    expect(reorderEqual((await h.read(ex.reorders)).get("101/CD-1001")!, { ...was, verdict: variant("applied", null) })).toBe(true);
    expect(stockEqual(await h.read(ex.chainStock),
        new SortedMap([...stock, ["101/CD-1001", { ...stock.get("101/CD-1001")!, onOrder: 200, risk: 2 }]], byString))).toBe(true);
    // It leaves the list, and the notice counts it.
    await waitFor(() => expect(receipt(container, "101/CD-1001")).toBeNull());
    await waitFor(() => expect(counted(container)).toBe("19,999"));
    expect(heads(container)[0]).toBe("101/CD-1002");
    await waitFor(() => expect(notice(container)).toBe(`1 ${m.nounOne()} left this view`));
    // Judgement's applied: the one decided, its receipt, with no Undo.
    await narrow(choosing("applied"));
    await waitFor(() => expect(receipt(container, "101/CD-1001")).not.toBeNull(), { timeout: 15_000 });
    expect(counted(container)).toBe("1");
    expect(within(receipt(container, "101/CD-1001")!).getByText(m.verdict({ verdict: "applied" }))).toBeDefined();
    expect(within(receipt(container, "101/CD-1001")!).queryByRole("button", { name: m.undo() })).toBeNull();
    expect(heads(container)).toEqual([]);
});

test("a reorder applied whose card the view leaves as its preview settles gives way at once as the view comes back: its receipt stands in its place, with no arrival, and takes Undo (P22, R24, R27)", async () => {
    const { container } = await open();
    await press(await applyOf(container, "101/CD-1001"));
    expect(card(container, "101/CD-1001").hasAttribute("data-applied")).toBe(true);
    // The view sent some 5,000 cases on: the card leaves the list's rows as it settles.
    await scrollList(container, 1_260_000);
    expect(container.querySelector('[data-decision-card="101/CD-1001"]')).toBeNull();
    // Back: drawn applied, it gives way at once, its receipt standing.
    await scrollList(container, 0);
    await waitFor(() => expect(receipt(container, "101/CD-1001")).not.toBeNull());
    expect(container.querySelector('[data-decision-card="101/CD-1001"]')).toBeNull();
    expect(receipt(container, "101/CD-1001")!.hasAttribute("data-arriving")).toBe(false);
    expect(within(receipt(container, "101/CD-1001")!).getByRole("button", { name: m.undo() })).toBeDefined();
    expect(counted(container)).toBe("20,000");
});

test("a verdict drafted on a case the rail then hides is kept by its key: Store 102 chosen beside Judgement's waiting, its cases show and the draft waits; Save writes the reorder's row and its stock row, a request each, and no case left the view (R26, R29, D4)", async () => {
    const { container } = await open();
    const was = (await h.read(ex.reorders)).get("101/CD-1001")!;
    const stock = await h.read(ex.chainStock);
    await press(await applyOf(container, "101/CD-1001"));
    await settleApplied(container, "101/CD-1001");
    expect(receipt(container, "101/CD-1001")).not.toBeNull();
    // Store 102 chosen, the judgement kept: Store 101's cases go, the draft with them, kept by its key.
    await narrow(choosing("waiting", "Store 102"));
    await waitFor(() => expect(heads(container)[0]).toBe("102/CD-1001"), { timeout: 15_000 });
    expect(counted(container)).toBe("500");
    expect(receipt(container, "101/CD-1001")).toBeNull();
    expect(history(container, editingMessages.discard()).disabled).toBe(false);
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.chainStock.name, ex.reorders.name].sort());
    expect(reorderEqual((await h.read(ex.reorders)).get("101/CD-1001")!, { ...was, verdict: variant("applied", null) })).toBe(true);
    expect(stockEqual(await h.read(ex.chainStock),
        new SortedMap([...stock, ["101/CD-1001", { ...stock.get("101/CD-1001")!, onOrder: 200, risk: 2 }]], byString))).toBe(true);
    // Hidden before the Save, it left no view: the notice says nothing, and Store 102's cases stand as they were.
    expect(notice(container)).toBeUndefined();
    expect(counted(container)).toBe("500");
    expect(heads(container)[0]).toBe("102/CD-1001");
});
