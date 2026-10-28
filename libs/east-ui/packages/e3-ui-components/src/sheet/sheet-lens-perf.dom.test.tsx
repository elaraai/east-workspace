/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The lens's benchmark (#1349) — `E3_UI_PERF=1`, never in CI: a timing on a
 * shared runner is no deterministic signal, and CI keeps the request-log proofs
 * of `sheet-lens.dom.test.tsx`. A million rows in one record, written through
 * its patch door, and two narrowings drawn over them: the ten rows flagged, and
 * the three groups that hold three rows in ten. For each it records the time
 * from the mount to the first screen drawn and the requests that screen made,
 * by kind, and holds what the lens never does at any size: read the record
 * whole, or a row by its key.
 *
 * Run: `E3_UI_PERF=1 pnpm exec vitest run src/sheet/sheet-lens-perf.dom.test.tsx`.
 */

import { describe, expect, test } from "vitest";
import { waitFor, type RenderResult } from "@testing-library/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Data, Sheet } from "@elaraai/e3-ui/internal";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { settle, sheetHarness } from "./frame/harness.test-utils.js";

/** Whether the benchmark runs: `E3_UI_PERF=1`, as the Plan's derivation timing is asked for (`plan/derive.test.ts`). */
const PERF = process.env["E3_UI_PERF"] === "1";

/** The record's rows. */
const ROWS = 1_000_000;

/** e3 with the work orders' module deployed — only for the benchmark: its record is empty until the benchmark fills it. */
const h = PERF ? sheetHarness({ modules: { "sheet/sheet-records": ex } }) : undefined;

/** The benchmark's record, as its dataset's requests name it. */
const RECORD = `records.${ex.lensBenchRows.name}`;

/** The ten rows flagged — one in a hundred thousand — drawn over the million. */
const flagged = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("bench.flagged", {
        rows: {
            source: Data.bindPaged(ex.lensBenchRows, { indexes: [ex.lensBenchByGroup, ex.lensBenchByFlag] }),
            fields: { group: { label: "Group" }, flag: { label: "Flag" } }, initial: { flag: [true] },
        },
    }));
    return Sheet({ slice: { slice }, columns: { group: Sheet.column.integer(ex.LensBenchRow, { header: "Group" }) } });
}))) };

/** The three groups of ten — three rows in ten — drawn over the million. */
const groups = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("bench.groups", {
        rows: {
            source: Data.bindPaged(ex.lensBenchRows, { indexes: [ex.lensBenchByGroup, ex.lensBenchByFlag] }),
            fields: { group: { label: "Group" }, flag: { label: "Flag" } }, initial: { group: [0n, 1n, 2n] },
        },
    }));
    return Sheet({ slice: { slice }, columns: { group: Sheet.column.integer(ex.LensBenchRow, { header: "Group" }) } });
}))) };

/** The rows a render draws, by their ids. */
const ids = (ui: RenderResult) => [...ui.container.querySelectorAll<HTMLElement>('[data-frame-slot="main"] [data-slot="row"][data-row-id]')].map((row) => row.dataset["rowId"]);

/** What each request kind is called in the results. */
const KINDS = ["place", "within", "page", "find", "runs", "rows", "read"] as const;

describe.skipIf(!PERF)("the lens over a million rows (E3_UI_PERF=1; not a CI gate)", () => {
    test("a narrowing of ten rows and one of three rows in ten: the first screen's time and its requests — never the record read whole, nor a row by its key", async () => {
        const harness = h!;
        // A million rows keyed in their order, each in one of ten groups, one in a hundred thousand flagged.
        const rows = new Map<string, ValueTypeOf<typeof ex.LensBenchRow>>();
        for (let i = 0; i < ROWS; i++) rows.set(`R${String(i).padStart(7, "0")}`, { group: BigInt(i % 10), flag: i % 100_000 === 0 });
        const filling = performance.now();
        await harness.patch(ex.lensBenchRows, rows);
        const fillMs = Math.round(performance.now() - filling);
        const results: { narrowing: string; firstScreenMs: number; count: string | null | undefined; requests: Record<string, number> }[] = [];
        for (const [narrowing, example, count] of [["ten rows flagged", flagged, "10 matches"], ["three groups of ten", groups, "300,000 matches"]] as const) {
            harness.e3.requests.splice(0);
            const start = performance.now();
            const ui = await harness.mount(example, { storageKey: `bench.${narrowing}` });
            // The first screen: the first row at its number, and the count line e3's count.
            await waitFor(() => expect(ids(ui)[0]).toBe("R0000000"), { timeout: 600_000 });
            const firstScreenMs = Math.round(performance.now() - start);
            await settle();
            const drawn = ui.container.querySelector('[data-slot="toolbarCount"]')?.textContent;
            expect(drawn).toBe(count);
            const requests = Object.fromEntries(KINDS.map((kind) => [kind, harness.requests(kind, RECORD).length]));
            // Never the record whole, nor a row by its key, nor the narrowing's runs read: e3 places them, and the
            // lens reads the segments near the view.
            expect([requests["read"], requests["rows"], requests["runs"]]).toEqual([0, 0, 0]);
            results.push({ narrowing, firstScreenMs, count: drawn, requests });
            ui.unmount();
        }
        console.log(`[lens benchmark] ${JSON.stringify({ rows: ROWS, fillMs, results })}`);
    }, 1_800_000);
});
