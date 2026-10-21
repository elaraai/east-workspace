/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The paged arm's key search over `seek` (Sheet Spec §3.13): a keyed source
 * mounts it in the toolbar, a match jumps the source and lands the ring on
 * its row, and next steps to the following match — the value built by
 * `<Sheet>`'s factory and COMPILED, and the Sheet rendered in its frame
 * (#1216). (The lens and the view tabs over a local Slice that this suite held
 * went with the local Slice, #1345; #1349 restores the lens over records.)
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, FloatType, IntegerType, OptionType, StringType, StructType, none, some, type ValueTypeOf } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraSheet, type SheetValue } from "./frame/index.js";
import { boundFrame, frameScrolls } from "./frame.test-utils.js";

// The frame the rows scroll in: of the keyed thousand, the first windows land.
let restoreFrame: () => void = () => {};
let restoreScroll: () => void = () => {};
afterEach(() => { cleanup(); localStorage.clear(); restoreScroll(); restoreScroll = () => {}; restoreFrame(); });
beforeEach(() => { initializeStore(new UIStore()); restoreFrame = boundFrame(2000); });

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const JobType = StructType({ id: StringType, activity: StringType, notes: StringType, stations: Sheet.Types.Link, qty: OptionType(FloatType) });

// A keyed paged source, built by hand to the row-source contract — paged data
// is bound (`Data.bindPaged`), so no package produces one. 1,000 rows whose ids
// sort as they stream, `J10000` … `J10999`, so `seek` addresses real positions.
const Jobs = ArrayType(JobType);
const KEYED_ROWS: ValueTypeOf<typeof JobType>[] = Array.from({ length: 1_000 }, (_x, i) => ({
    id: `J${i + 10_000}`, activity: `Task ${i}`, notes: "", stations: { from: [], to: [] }, qty: none,
}));
const KEYED_IDS = KEYED_ROWS.map((r) => r.id);
const KEYED_PAGE = East.function([IntegerType, IntegerType], OptionType(Jobs), ($, offset, limit) => {
    const all = $.const(KEYED_ROWS, Jobs);
    const n = $.let(all.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.slice(start, end));
});
const KEYED_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(KEYED_ROWS, Jobs);
    return some(all.size());
});
/**
 * Where a key query lands among the ids. Their order makes every query's
 * matches ONE contiguous run — `[lo, hi)` — so a hit is its first row and a
 * count, and a miss carries the row it would sit at. The ids are Strings:
 * leading struct fields name none of theirs, so `fields` matches only as its
 * prefix, and a range bounds on its first literal.
 */
const KEYED_SEEK = East.function([Paged.Types.SeekQuery], OptionType(Paged.Types.SeekRange), ($, query) => {
    const ids = $.const(KEYED_IDS, ArrayType(StringType));
    const lo = $.let(0n);
    const hi = $.let(0n);
    $.match(query, {
        key: ($2, literal) => {
            const k = $2.let(literal.parse(StringType));
            $2.assign(lo, ids.filter((_$, x) => x.less(k)).size());
            $2.assign(hi, ids.filter((_$, x) => x.lessEqual(k)).size());
        },
        prefix: ($2, p) => {
            $2.assign(lo, ids.filter((_$, x) => x.less(p)).size());
            $2.assign(hi, lo.add(ids.filter((_$, x) => x.startsWith(p)).size()));
        },
        fields: ($2, f) => {
            $2.if(f.values.size().equal(0n), ($3) => {
                const p = $3.let(f.prefix.unwrap("some", () => ""));
                $3.assign(lo, ids.filter((_$, x) => x.less(p)).size());
                $3.assign(hi, lo.add(ids.filter((_$, x) => x.startsWith(p)).size()));
            });
        },
        range: ($2, r) => {
            $2.if(r.from.size().greater(0n), ($3) => {
                const from = $3.let(r.from.get(0n).parse(StringType));
                $3.assign(lo, ids.filter((_$, x) => x.less(from)).size());
            });
            $2.assign(hi, ids.size());
            $2.if(r.to.size().greater(0n), ($3) => {
                const to = $3.let(r.to.get(0n).parse(StringType));
                $3.assign(hi, ids.filter((_$, x) => x.less(to)).size());
            });
            $2.if(hi.less(lo), ($3) => { $3.assign(hi, lo); });
        },
    });
    return some({ found: hi.greater(lo), row: lo, count: hi.subtract(lo) });
});
const KEYED_SOURCE = { id: "sheet_key_search_keyed_1000", page: KEYED_PAGE, total: KEYED_TOTAL, seek: some(KEYED_SEEK) };

/** A paged sheet over the keyed source. */
function buildKeyed(): SheetValue {
    const program = East.function([], SheetPayloadType, ($) => {
        const source = $.const(KEYED_SOURCE, Paged.Types.Source(Jobs));
        return Sheet.Payload({ data: source, columns: { activity: Sheet.column.text(JobType, { header: "Activity" }) }, id: "id", blanks: 2 });
    });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

function mount(value: SheetValue) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="sheet-key-search-test" />
        </ChakraProvider>,
    );
}

/** A row's cell by key — null while its row is not mounted. */
const cellOf = (container: HTMLElement, id: string, key: string) => container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);

describe("the paged arm's key search (§3.13)", () => {
    test("a keyed source mounts the key search in the toolbar; a match jumps the source and lands the ring on the row; next steps to the following match", async () => {
        // The frame shows what it can of the rows that land, and scrolls to the ring (#856).
        restoreScroll = frameScrolls();
        const { container } = mount(buildKeyed());
        await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("600 loaded of 1,000"), { timeout: 15_000 });
        const search = container.querySelector('[data-part="dataset-key-search"]')!;
        expect(search).toBeTruthy();
        const input = search.querySelector("input") as HTMLInputElement;
        // Typed a key at a time (the control debounces into one prefix query): J10230 … J10239.
        // Each keystroke is confirmed before the next: the combobox input is
        // controlled, so a re-render that lands late leaves userEvent appending
        // to a stale value, which swallows a character (a loaded CI runner typed
        // "J123", which matches nothing).
        for (const key of "J1023") {
            const typed = input.value + key;
            await userEvent.type(input, key);
            await waitFor(() => expect(input.value).toBe(typed));
        }
        await waitFor(() => expect(search.textContent).toMatch(/10 matches/), { timeout: 5_000 });
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(cellOf(container, "J10230", "activity")?.hasAttribute("data-selected")).toBe(true), { timeout: 5_000 });
        expect(search.textContent).toMatch(/1 of 10/);
        fireEvent.click(search.querySelector('[aria-label="Next match"]')!);
        await waitFor(() => expect(cellOf(container, "J10231", "activity")?.hasAttribute("data-selected")).toBe(true), { timeout: 5_000 });
        expect(search.textContent).toMatch(/2 of 10/);
    });
});
