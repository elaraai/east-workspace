/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What a Save asks e3 (#1596), over every way a sheet or a Record pages a large
 * record with no record Slice, on e3 itself (`harness.test-utils.tsx`): a
 * window over the record, a window through one of its indexes, and an indexed
 * binding's unfiltered view. Every row the Save wrote is read back by its key
 * from the record's own rows, all of them in one read, whichever way the rows
 * are paged: never a search and a one-row page a row, which asks e3 twice for
 * each row it wrote and, over an index, searches for a key the index does not
 * hold.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { rowKeysOf } from "../../e3-web.test-utils.js";
import { act, settle, sheetHarness } from "./harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "../../record/index.js";

const h = sheetHarness({ modules: { "sheet/sheet-records": ex }, frame: 2000 });
const ORDERS = ex.indexedWorkOrders;
/** The work orders' record, as its dataset's requests name it. */
const ORDERS_DATASET = `records.${ORDERS.name}`;
const COLUMNS = { status: Sheet.column.text(ex.IndexedWork, { header: "Status" }) };

/** A window over the record, in key order. */
const overTheRecord = East.function([], SheetPayloadType, ($) => {
    const orders = $.let(Record.bind(ORDERS, ["patch"]));
    const page = $.let(Data.bindPaged(ORDERS));
    return Sheet.Payload({ record: orders, window: page, name: "overTheRecord", columns: COLUMNS, edits: { insertRows: false } });
});

/** A window through one of the record's indexes, each entry joined to its row. */
const throughAnIndex = East.function([], SheetPayloadType, ($) => {
    const orders = $.let(Record.bind(ORDERS, ["patch"]));
    const page = $.let(Data.bindPaged(ORDERS, { index: "by_due", join: true }));
    return Sheet.Payload({ record: orders, window: page, name: "throughAnIndex", columns: COLUMNS, edits: { insertRows: false } });
});

/** The record's indexed binding, read as its unfiltered view. */
const throughABinding = East.function([], SheetPayloadType, ($) => {
    const orders = $.let(Record.bind(ORDERS, ["patch"]));
    const page = $.let(Data.bindPaged(ORDERS, { indexes: ["by_due"], join: true }));
    return Sheet.Payload({ record: orders, window: page, name: "throughABinding", columns: COLUMNS, edits: { insertRows: false } });
});

/** A window over the record whose rows are checked: what a check reads of the rows it stands among. */
const overTheRecordChecked = East.function([], SheetPayloadType, ($) => {
    const orders = $.let(Record.bind(ORDERS, ["patch"]));
    const page = $.let(Data.bindPaged(ORDERS));
    const check = $.const(East.function([Sheet.Types.Draft(ex.IndexedWork), Sheet.Types.DraftContext(ex.IndexedWork)], Sheet.Types.Readiness,
        () => East.value(variant("ready", null), Sheet.Types.Readiness)));
    return Sheet.Payload({ record: orders, window: page, name: "overTheRecordChecked", columns: COLUMNS, edits: { insertRows: false }, ready: { row: check } });
});

/** A Record over a window of the record, with no slice. */
const recordWindow = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const orders = $.let(Record.bind(ORDERS));
    const page = $.let(Data.bindPaged(ORDERS));
    return Record({
        record: orders, window: page, name: "recordWindow", edits: { insertRows: false },
        columns: { status: Record.column.title(ex.IndexedWork, { header: "Status" }) },
    });
})));

/** The rows drawn, in order. */
const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
/** A row's status cell. */
const statusCell = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-key="status"]')!;

/** Types a new status in a row's cell, committed with ⏎. */
async function typeStatus(cell: HTMLElement, status: string) {
    fireEvent.doubleClick(cell);
    const editor = await waitFor(() => {
        const input = cell.querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(input).not.toBeNull();
        return input!;
    });
    fireEvent.input(editor, { target: { value: status } });
    await settle();
    fireEvent.keyDown(editor, { key: "Enter" });
    await settle();
}

/** The Save goes, and the session has read its rows back. */
async function save(button: () => HTMLButtonElement) {
    await act(async () => {
        fireEvent.mouseDown(button(), { button: 0 });
        fireEvent.click(button());
    });
    await waitFor(() => expect(button().disabled).toBe(true));
    await settle();
}

/** Asserts that no row was read alone since a point in the requests: a binding's total is one bounded entry at the start of its rows. */
function expectNoRowAlone(asked: number, when: string) {
    expect(h.requests(undefined, ORDERS_DATASET).slice(asked).filter((request) => request.kind === "page" && request.query.get("limit") === "1" && request.query.get("offset") !== "0").map((request) => request.query.get("offset")),
        `no row is read as a page of one ${when}`).toEqual([]);
}

/** Asserts what the Save asked e3 of the record: at most one read of rows by key, for the rows it wrote, and no read of one. */
function expectOneRead(asked: number, wrote: readonly string[]) {
    const requests = h.requests(undefined, ORDERS_DATASET).slice(asked);
    const reads = requests.filter((request) => request.kind === "rows");
    expect(reads.length, "the rows it wrote are read in one request, or from the windows read again").toBeLessThanOrEqual(1);
    for (const read of reads) expect([...rowKeysOf(read)].sort()).toEqual(wrote.map((id) => `"${id}"`).sort());
    expect(requests.filter((request) => request.kind === "find"), "no row is searched for by its key").toEqual([]);
    expectNoRowAlone(asked, "after the Save");
    expect(requests.filter((request) => request.kind === "read"), "the record is never read whole").toEqual([]);
}

describe.each([
    ["a window over the record", overTheRecord],
    ["a window through one of its indexes", throughAnIndex],
    ["its indexed binding's unfiltered view", throughABinding],
    ["a window over the record whose rows are checked", overTheRecordChecked],
])("a sheet over %s", (name, payload) => {
    test("reads every row a Save wrote back in one read, never a row at a time (#1596)", async () => {
        const { container, getByRole } = await h.mountPayload(payload, { storageKey: `save-requests-${name}` });
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(3));
        await settle();
        const edited = rows(container).slice(0, 3);
        const wrote = edited.map((row) => row.dataset["rowId"]!);
        const opened = h.requests(undefined, ORDERS_DATASET).length;
        for (const id of wrote) await typeStatus(statusCell(container.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`)!), "Held");
        expectNoRowAlone(opened, "as the rows are edited");
        expect(rows(container).slice(0, 3).map((row) => statusCell(row).textContent)).toEqual(["Held", "Held", "Held"]);
        const asked = h.requests(undefined, ORDERS_DATASET).length;
        await save(() => getByRole("button", { name: "Save" }) as HTMLButtonElement);
        const saved = await h.read(ORDERS);
        expect(wrote.map((id) => saved.get(id)?.status)).toEqual(["Held", "Held", "Held"]);
        expectOneRead(asked, wrote);
        expect(container.querySelector("[data-session-banner]")).toBeNull();
    });
});

describe("a Record over a window of the record", () => {
    test("reads every row a Save wrote back in one read, never a row at a time (#1596)", async () => {
        const { container, getByRole } = await h.mount({ fn: recordWindow }, { storageKey: "save-requests-record" });
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(3));
        await settle();
        const edited = rows(container).slice(0, 3);
        const wrote = edited.map((row) => row.dataset["rowId"]!);
        for (const id of wrote) await typeStatus(statusCell(container.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`)!), "Held");
        const asked = h.requests(undefined, ORDERS_DATASET).length;
        await save(() => getByRole("button", { name: "Save" }) as HTMLButtonElement);
        const saved = await h.read(ORDERS);
        expect(wrote.map((id) => saved.get(id)?.status)).toEqual(["Held", "Held", "Held"]);
        expectOneRead(asked, wrote);
        expect(container.querySelector("[data-session-banner]")).toBeNull();
    });
});
