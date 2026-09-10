/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The paged sheet's driver (Sheet Spec §3.13, §5 row 21): the resident run
 * is contiguous from the top, the tail band describes the rest, exhaustion
 * arrives with the last window, and an unreadable source reports why.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { some, none } from "@elaraai/east";
import { useSheetPaging, SHEET_PAGE_SIZE, type SheetViewport } from "./paging.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

afterEach(cleanup);

/** A synchronous positional source of `total` rows. Records which windows were asked for. */
function source(total: number, opts: { holdWindow?: number } = {}) {
    const asked: number[] = [];
    const value = {
        id: `sheet-driver-${total}`,
        page: (offset: bigint, limit: bigint) => {
            const w = Number(offset) / SHEET_PAGE_SIZE;
            asked.push(w);
            if (opts.holdWindow === w) return none;
            const rows: SheetRowValue[] = [];
            for (let i = Number(offset); i < Math.min(total, Number(offset) + Number(limit)); i++) {
                rows.push({ id: `r${String(i).padStart(5, "0")}`, owned: false, cells: new Map() });
            }
            return some(rows);
        },
        total: () => some(BigInt(total)),
        seek: none,
    } as unknown as SheetPagedSourceValue;
    return { value, asked };
}

let latest: ReturnType<typeof useSheetPaging> | undefined;

function Harness({ src }: { src: SheetPagedSourceValue }) {
    const paging = useSheetPaging(src, 36);
    latest = paging;
    return (
        <div>
            <span data-testid="rows">{`${paging.rowsOffset}+${paging.rows.length}`}</span>
            <span data-testid="head">{paging.head ? `${paging.head.from}-${paging.head.to}` : "-"}</span>
            <span data-testid="tail">{paging.tail ? `${paging.tail.from}-${paging.tail.to}` : "-"}</span>
            <span data-testid="exhausted">{String(paging.exhausted)}</span>
        </div>
    );
}

const text = (id: string): string => screen.getByTestId(id).textContent ?? "";
const report = (at: SheetViewport, scrolling = false): void => {
    act(() => { latest?.reportViewport(at, scrolling); });
};

describe("sheet paging — first paint", () => {
    test("the run starts at the top, the rest is one tail band, nothing is exhausted", async () => {
        const { value, asked } = source(2_000);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        expect(text("head")).toBe("-");
        expect(text("tail")).toBe("600-1999");
        expect(text("exhausted")).toBe("false");
        expect([...new Set(asked)].sort((a, b) => a - b)).toEqual([0, 1, 2]);
        // The tail band's geometry: 1,400 unvisited elements at the seeded slot rate (36 px).
        expect(latest?.tail?.px).toBe(1_400 * 36);
    });

    test("a small source is exhausted once its windows land", async () => {
        const { value } = source(450);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("exhausted")).toBe("true"));
        expect(text("rows")).toBe("0+450");
        expect(text("tail")).toBe("-");
        expect(latest?.total).toBe(450);
    });

    test("a window still in flight stops the run — the row space never carries a hole", async () => {
        const { value } = source(1_000, { holdWindow: 1 });
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+200"));
        expect(text("tail")).toBe("200-999");
        expect(latest?.loading).toBe(true);
        expect(text("exhausted")).toBe("false");
    });
});

describe("sheet paging — moving", () => {
    test("reporting the tail band walks the run forward one window per commit", async () => {
        const { value } = source(2_000);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        report({ kind: "band", at: "tail" });
        await waitFor(() => expect(text("rows")).not.toBe("0+600"));
        expect(text("rows").startsWith("0+") || text("rows").startsWith("200+")).toBe(true);
    });

    test("a jump rebases — the windows in between are never asked for", async () => {
        const { value, asked } = source(50_000);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        const before = new Set(asked);
        act(() => { latest?.jumpToElement(40_000); });
        await waitFor(() => expect(latest?.rowsOffset).toBeGreaterThanOrEqual(39_800));
        expect(text("head")).toMatch(/^0-/);
        for (const w of asked.filter((x) => !before.has(x))) expect(w).toBeGreaterThanOrEqual(199);
    });
});

describe("sheet paging — an unreadable source", () => {
    test("reports the reason instead of an empty sheet", async () => {
        const boom = (): never => { throw new Error("no paging service"); };
        const bad = { id: "bad", page: boom, total: boom, seek: none } as unknown as SheetPagedSourceValue;
        render(<Harness src={bad} />);
        await waitFor(() => expect(latest?.error).toMatch(/no paging service/));
        expect(text("rows")).toBe("0+0");
    });
});
