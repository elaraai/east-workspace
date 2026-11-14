/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Plan over rows read lean beside their nested series index (#1438) through
 * a Save whose reads come back late — the checks every builder runs
 * (`shared/save-held.test-utils.ts`, #1599), on e3 itself: the twenty ledgers
 * paged lean, each leaf measure's readings taking a typed number.
 *
 * The canvas reads such rows in two parts — its windows of lean rows, and the
 * cells of the rows in view through the index — and both are read again after
 * a Save, apart from the Save's own confirmation, which reads its ledger whole
 * by its key. From the press of Save until both have landed, a number a Save
 * wrote reads as typed, and every subtotal above it with it. A number typed
 * meanwhile is taken at once — the session holds it, and Save is on — and is
 * drawn once the reads land: a row's numbers are its cells', and the cells'
 * reader puts a new change into what it holds only once it has read them at
 * the record's revision now.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, some, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/fixtures/plan/plan-nested";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { savedThroughReload } from "../../shared/save-held.test-utils.js";
import { instantKey, timeInstant } from "../instant.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-nested.fixtures": ex });

/** The ledgers' record, as e3's requests name it. */
const LEDGERS = (ex.ledgers.path as TreePath).map((step) => step.value).join(".");

/** The twenty ledgers paged lean beside their nested series index, by the week, each leaf measure's readings taking a typed number. */
const ledgersTyped = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(ex.ledgers, ["patch"]));
    const ledgers = $.let(Data.bindPaged(ex.ledgers, { indexes: ["ledgers_by_site", "ledgers_in_time"] }));
    return Plan({
        axis: Plan.axis({ window: { min: new Date("2026-01-05T00:00:00Z"), max: new Date("2026-03-02T00:00:00Z") }, resolution: "week" }),
        data: ledgers,
        series: [Plan.series.group(ex.Ledger, {
            key: "ledgers", title: "Ledgers", label: (l) => l.name,
            children: Plan.children("measures", [Plan.series.table(ex.Measure, {
                key: "readings", title: "Readings", label: (m) => m.label, children: "children", aggregate: "sum",
                cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))), edit: true,
            })]),
        })],
        record,
    });
}))) };

/** Ledger 101's first top measure, that one's first middle one, and two of its leaves. */
const TOP = rowAt(entry("readings", "L-101", "101.1"));
const MIDDLE = rowAt(entry("readings", "L-101", "101.1", "101.1.1"));
const LEAF = rowAt(entry("readings", "L-101", "101.1", "101.1.1", "101.1.1.1"));
const LEAF_2 = rowAt(entry("readings", "L-101", "101.1", "101.1.1", "101.1.1.2"));

const JAN_12 = new Date("2026-01-12T00:00:00Z");
const JAN_19 = new Date("2026-01-19T00:00:00Z");
/** A cell, by its row and its bucket's start. */
const cellAt = (c: HTMLElement, row: string, at: Date) =>
    [...c.querySelectorAll<HTMLElement>(`${row} [data-cell]`)].find((cell) => cell.getAttribute("data-cell") === instantKey(timeInstant(at)));
/** What a cell prints: `no cell` where its row is not drawn. */
const printed = (c: HTMLElement, row: string, at: Date) => cellAt(c, row, at)?.textContent ?? "no cell";
/** The open input, if any. */
const inputOf = (c: HTMLElement) => c.querySelector<HTMLInputElement>("[data-plan-typing] input");

/** A number typed into a cell, as a person types it: the cell opened, the number typed, Enter. Each an act of its own. */
const typing = (c: HTMLElement, row: string, at: Date, text: string): (() => void)[] => [
    () => { fireEvent.doubleClick(cellAt(c, row, at)!); },
    () => { fireEvent.input(inputOf(c)!, { target: { value: text } }); },
    () => { fireEvent.keyDown(inputOf(c)!, { key: "Enter" }); },
];
/** Types a number into a cell, and lets the page settle. */
async function type(c: HTMLElement, row: string, at: Date, text: string): Promise<void> {
    for (const step of typing(c, row, at, text)) {
        await act(async () => { step(); });
        await settle();
    }
}

/**
 * The reads the canvas draws the ledgers by — its windows of lean rows, and its cells' searches and their entries:
 * every read of the record but a ledger read whole by its key, which a gesture's first change and a Save's own
 * confirmation ask.
 */
const canvasReads = (request: E3Request) => request.dataset === LEDGERS && request.kind !== "rows";

type LedgerValue = ValueTypeOf<typeof ex.Ledger>;
const readLedgers = async () => (await h.read(ex.ledgers)) as ReadonlyMap<string, LedgerValue>;
/** A leaf's reading of a week, as e3 holds it. */
const reading = (ledgers: ReadonlyMap<string, LedgerValue>, ledger: string, path: readonly string[], at: Date) => {
    let measure = ledgers.get(ledger)!.measures.get(path[0]!)!;
    for (const key of path.slice(1)) measure = measure.children.get(key)!;
    return measure.readings.get(at);
};

/** What the canvas says of the weeks typed into: ledger 101's leaf and the two measures over it; its sibling leaf and the measure over that. */
const look = (c: HTMLElement) => [
    printed(c, LEAF, JAN_12), printed(c, MIDDLE, JAN_12), printed(c, TOP, JAN_12), printed(c, LEAF_2, JAN_19), printed(c, MIDDLE, JAN_19),
];

/** The ledgers' Plan, a number typed into ledger 101's leaf: drawn, and every subtotal above it moved by the difference. */
async function typedInto(): Promise<HTMLElement> {
    const { container: c } = await h.mount(ledgersTyped);
    await settle();
    expect(look(c).slice(0, 3)).toEqual(["2", "9", "54"]);
    await type(c, LEAF, JAN_12, "15");
    await waitFor(() => expect(look(c).slice(0, 3)).toEqual(["15", "22", "67"]));
    return c;
}

test("a number a Save wrote reads as typed, and every subtotal above it with it, at every change of the page — from the press of Save until the lean rows and their cells are read again", async () => {
    const c = await typedInto();
    await savedThroughReload({ e3: h.e3, container: c, reads: canvasReads, look: () => look(c) });
    expect(reading(await readLedgers(), "L-101", ["101.1", "101.1.1", "101.1.1.1"], JAN_12)).toBe(15);
});

test("a number typed into the same ledger while its lean rows and their cells are read again after a Save is taken at once — the session holds it, Save is on — is drawn as typed, the subtotal above it moved, once the reads land, and the next Save writes it", async () => {
    const c = await typedInto();
    const toolbar = () => within(slot(c, "toolbar")!);
    const saveButton = () => toolbar().getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() });
    const held = h.e3.hold(canvasReads);
    try {
        await act(async () => { fireEvent.click(saveButton()); });
        await waitFor(() => expect(held.held, "the canvas reads what it saved again").toBeGreaterThan(0), { timeout: 5_000 });
        await settle();
        // Confirmed by its ledger read whole: nothing is left to save, and the number saved still reads as typed.
        await waitFor(() => expect(saveButton().disabled).toBe(true), { timeout: 5_000 });
        expect(look(c).slice(0, 3)).toEqual(["15", "22", "67"]);
        // A second number, typed into the same ledger while the reads are held: taken at once.
        await type(c, LEAF_2, JAN_19, "10");
        expect(saveButton().disabled, "the number typed is a draft to save").toBe(false);
        expect(look(c).slice(0, 3), "the number saved still reads as typed").toEqual(["15", "22", "67"]);
    } finally {
        await act(async () => { held.release(); });
    }
    await settle();
    // The reads land: both numbers as typed, each subtotal moved.
    await waitFor(() => expect(look(c).slice(0, 5)).toEqual(["15", "22", "67", "10", "18"]));
    await act(async () => { fireEvent.click(saveButton()); });
    await settle();
    await waitFor(() => expect(saveButton().disabled).toBe(true), { timeout: 5_000 });
    const ledgers = await readLedgers();
    expect([
        reading(ledgers, "L-101", ["101.1", "101.1.1", "101.1.1.1"], JAN_12),
        reading(ledgers, "L-101", ["101.1", "101.1.1", "101.1.1.2"], JAN_19),
    ]).toEqual([15, 10]);
    expect(look(c).slice(0, 5)).toEqual(["15", "22", "67", "10", "18"]);
});
