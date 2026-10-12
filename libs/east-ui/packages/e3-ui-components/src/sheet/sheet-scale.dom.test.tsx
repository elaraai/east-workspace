/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A gesture at scale is linear in the rows (#859). A paste of 2,000 rows into
 * an editable sheet of 20,000 mints ids against one set, records its entries
 * through one index of the rows, and places the new rows in one pass — every
 * source row's id is read a bounded number of times per render, never once
 * per pasted row. The rows count their id reads and throw past a linear
 * budget, so a search of the rows per pasted row fails here at once.
 */

import { test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, StringType, StructType, variant } from "@elaraai/east";
import { Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraSheet, type SheetValue } from "./frame/index.js";
import { sheetJournal } from "./journal.test-utils.js";
import { boundFrame } from "./frame.test-utils.js";
import type { SheetRowValue } from "./values.js";

// The sheet mounts a screenful of its frame (#856): its rows are measured as they draw.
let restore: () => void = () => {};
beforeEach(() => {
    localStorage.clear();
    initializeStore(new UIStore());
    restore = boundFrame(600);
});
afterEach(() => { cleanup(); restore(); });

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const JobType = StructType({ id: StringType, task: StringType, code: StringType });

/** An editable sheet of `n` jobs over two text columns. */
function buildJobs(n: number): SheetValue {
    const count = BigInt(n);
    const program = East.function([], SheetPayloadType, ($) => {
        const total = $.const(count);
        const jobs = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`j${i}`, task: East.str`Task ${i}`, code: East.str`C${i}`,
        }, JobType)), ArrayType(JobType));
        return Sheet.Payload({
            data: jobs,
            columns: {
                task: Sheet.column.text(JobType, { header: "Task" }),
                code: Sheet.column.text(JobType, { header: "Code" }),
            },
            id: "id",
        });
    });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

test("a paste of 2,000 rows into 20,000 reads each source row's id a bounded number of times — never once per pasted row", async () => {
    const n = 20_000;
    const pasted = 2_000;
    // Every id read of a source row is counted once armed, and one past the budget throws.
    let reads = 0;
    let budget = Number.POSITIVE_INFINITY;
    const counted = (row: SheetRowValue): SheetRowValue => {
        const copy: Record<string, unknown> = { ...row };
        delete copy.id;
        Object.defineProperty(copy, "id", {
            enumerable: true,
            get() {
                reads += 1;
                if (reads > budget) throw new Error(`more than ${budget} id reads — not linear`);
                return row.id;
            },
        });
        return copy as unknown as SheetRowValue;
    };
    const sheet = buildJobs(n);
    const root = sheet.sheet;
    if (root.rows.type !== "inline") throw new Error("an inline sheet");
    const value = sheetJournal({ ...sheet, sheet: { ...root, rows: variant("inline", (root.rows.value as SheetRowValue[]).map(counted)) } }).value;
    const ui = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="sheet-scale-test" />
        </ChakraProvider>,
    );
    const card = ui.container.querySelector("[data-sheet-card]") as HTMLElement;
    const rowCount = () => Number(card.getAttribute("aria-rowcount"));
    const before = rowCount();
    // The ring opens on the first blank row: the paste appends there.
    const text = Array.from({ length: pasted }, (_u, i) => `Pasted ${i}\tP${i}`).join("\n");
    reads = 0;
    // Each render reads each id a few times over: a budget of a hundred reads a
    // source row holds any render count a paste takes, and a search of the
    // rows per pasted row (2,000 × 20,000) spends it thirty times over.
    budget = 100 * n;
    fireEvent.paste(card, { clipboardData: { getData: () => text } });
    await act(async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    expect(reads).toBeLessThanOrEqual(budget);
    expect(rowCount()).toBe(before + pasted);
    expect(ui.container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Pasted 2,000×2 from clipboard");
}, 120_000);
