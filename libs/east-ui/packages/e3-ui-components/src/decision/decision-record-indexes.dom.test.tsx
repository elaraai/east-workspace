/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A queue over 20,000 cases on e3 itself (#1455, `Decision Queue Spec.md` D4,
 * §15), over the windowed example: a replenishment model's reorders across
 * forty stores, an item at a store each and each its own one proposal (D15),
 * read a page at a time through the rail's one source over the record's
 * indexes on the store and the range. Unnarrowed, they are past the queue's
 * 1,000: its banner says how many and to narrow, and no card is drawn. A
 * store chosen, its 500 show, sectioned by when each is due, each section its
 * count and total. The verdicts are read by key, never whole, and the stock
 * rows a reorder changes by key through their entries, never the 20,000
 * whole. A verdict drafted on a case the rail then hides is kept by its key,
 * and Save writes it and its stock row, a request each.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { act, waitFor } from "@testing-library/react";
import {
    DateTimeType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { layOutList } from "./list.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import { action, fields, head, heads, history, openCard, press, preview, sections } from "./preview.test-utils.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

// The list laid out, its frame tall enough for the first of a store's cards.
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = layOutList(4_000); });
afterEach(() => restoreFrame());

const verdictEqual = equalFor(ex.OpsVerdict);
const stockEqual = equalFor(ex.chainStock.type);
const compareTime = compareFor(DateTimeType);
const byString = compareFor(StringType);
const printText = printFor(StringType);

/** The rail's state of the queue's one source, as the store keeps it. */
const SOURCE = "ex.decisionQueueRecordIndexes.decisions";
/** A source's narrowing: each field's choice, as the rail writes it. */
type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** The stores chosen. */
const stores = (...names: string[]): Where => new SortedMap([["store", variant("values", names.map(name => printText(name)))]], byString);

/** Writes the source's narrowing, as the rail does. */
async function narrow(where: Where) {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(SOURCE)!);
    await act(async () => { store.write(SOURCE, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

/** The toolbar's count of the cases waiting. */
const waiting = (container: HTMLElement) => slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent;
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

/** Mounts the queue, unnarrowed, and waits until its banner says how many cases there are. */
async function open() {
    const ui = await h.mount(ex.decisionQueueRecordIndexes);
    await waitFor(() => expect(slot(ui.container, "banners").textContent).toContain(m.tooMany({ n: "20,000" })), { timeout: 15_000 });
    return ui;
}

test("unnarrowed, the 20,000 reorders are past the queue's 1,000: its banner says how many and to narrow, no card is drawn and the toolbar counts none; a store chosen, its 500 show, sectioned by when each is due, each section its count and total, the first open; the reorders are read through the rail's source, the verdicts and the stock rows by key, none whole (D4, R1–R3, R5)", async () => {
    const { container } = await open();
    expect(heads(container)).toEqual([]);
    expect(container.querySelectorAll("[data-decision-section]")).toHaveLength(0);
    expect(waiting(container)).not.toMatch(/[0-9]/u);
    await narrow(stores("Store 101"));
    await waitFor(() => expect(waiting(container)).toBe("500"), { timeout: 15_000 });
    expect(slot(container, "banners").textContent).not.toContain(m.tooMany({ n: "20,000" }));
    expect(slot(container, "toolbar").querySelector("[data-decision-late]")?.textContent).toBe(m.pastDue({ n: "56", narrow: false }));
    // Due from 09:00 today every twelve hours to Saturday's: the overdue first, then today's, then the week's — each 200
    // units, worth $600 — each section's head read as the list's scroll reaches it.
    const reached: ReturnType<typeof sections> = [];
    for (const top of [0, 14_000, 28_000]) {
        await scrollList(container, top);
        for (const section of sections(container)) if (!reached.some(([at]) => at === section[0])) reached.push(section);
    }
    expect(reached).toEqual([["overdue", "Overdue | 56 | +$34K"], ["today", "Due today | 55 | +$33K"], ["week", "This week | 389 | +$233K"]]);
    await scrollList(container, 0);
    expect(heads(container)[0]).toBe("101/CD-1002");
    expect(openCard(container)).toBe("101/CD-1002");
    expect(head(container, "101/CD-1002").textContent).toContain("Reorder 200 units of CD-1002 at Store 101");
    // Its preview: the stock row's changed fields, read by key through the stock levels' entries.
    await waitFor(() => expect(fields(preview(container, "101/CD-1002")).map(field => [field.caption, field.was, field.now])).toEqual([
        ["CD-1002 · Store 101 · On order", "0", "200"],
        ["CD-1002 · Store 101 · Stock-out risk", "12", "2"],
    ]));
    // None read whole: the reorders paged through the rail's source, the verdicts and the stock rows by key.
    for (const record of [ex.reorders.name, ex.reorderVerdicts.name, ex.chainStock.name]) expect(kinds(record)).not.toContain("read");
    expect(kinds(ex.reorderVerdicts.name)).not.toEqual([]);
    expect(kinds(ex.chainStock.name)).not.toEqual([]);
});

test("a verdict drafted on a case the rail then hides is kept by its key: another store chosen, its cases show and the draft waits; Save writes the verdict and its stock row, a request each (D4, R29)", async () => {
    const { container } = await open();
    const stock = await h.read(ex.chainStock);
    await narrow(stores("Store 101"));
    await waitFor(() => expect(openCard(container)).toBe("101/CD-1002"), { timeout: 15_000 });
    const apply = () => action(container, "101/CD-1002", m.action({ action: "apply" }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="101/CD-1002"]')).not.toBeNull();
    // Store 102 chosen: Store 101's cases go, the draft with them, kept by its key.
    await narrow(stores("Store 102"));
    await waitFor(() => expect(heads(container)[0]?.startsWith("102/")).toBe(true), { timeout: 15_000 });
    expect(waiting(container)).toBe("500");
    expect(container.querySelector('[data-decision-receipt="101/CD-1002"]')).toBeNull();
    expect(history(container, editingMessages.discard()).disabled).toBe(false);
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.chainStock.name, ex.reorderVerdicts.name].sort());
    const saved = (await h.read(ex.reorderVerdicts)).get("101/CD-1002");
    expect(saved).toBeDefined();
    const at = saved!.verdict.value.at;
    expect(compareTime(at, from)).toBeGreaterThanOrEqual(0);
    expect(verdictEqual(saved!, { verdict: variant("applied", { at }), option: none, answer: none, reason: none, note: none })).toBe(true);
    const row = stock.get("101/CD-1002")!;
    expect(stockEqual(await h.read(ex.chainStock), new SortedMap([...stock, ["101/CD-1002", { ...row, onOrder: 200, risk: 2 }]], byString))).toBe(true);
});
