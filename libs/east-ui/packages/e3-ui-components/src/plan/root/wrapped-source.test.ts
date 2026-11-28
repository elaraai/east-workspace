/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The wrapper every layer of the canvas's composition reads its paged rows
 * through (`wrapped-source.ts`): one wrapper a source while a source deriving
 * the same rows stands under it, and another for one that does not; what it
 * reads is what stands at the canvas's last render — the source under it, and
 * what else its layer drew with; the source's count, key search and narrowing
 * are passed through as it has them, a member it has not left out; and the two
 * roots a layer hands on are the ones given where it wraps none. What each
 * layer says of its own windows is its own test's (`kept.test.ts`,
 * `events.test.ts`).
 */

import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { none, some, variant } from "@elaraai/east";
import { windowedSourceOf } from "@elaraai/east-ui-components/internal";
import type { PlanRootValue, PlanWireBlock } from "../model.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import { ownRefresh, usePagedRoots, usePagedWrapper } from "./wrapped-source.js";

/** A window's rows: none are read here. */
const BLOCKS = [] as unknown as PlanWireBlock[];

/** A root whose own rows are `rows`. */
const rootOf = (rows: unknown) => ({ rows, links: [], pick: none }) as unknown as PlanRootValue;

/** A source under a wrapper: its windows and its count, its refreshes listed; with a narrowing, a live one. */
function sourceOf(total: bigint, refreshed: (string | undefined)[], narrowing?: () => string): PlanPagedSourceValue {
    const page: PlanPagedSourceValue["page"] = () => some({ rows: BLOCKS, entries: [] });
    return {
        id: "rows", page, total: () => some(total), seek: none,
        revision: () => some("R1"),
        refresh: (revision) => { refreshed.push(revision.type === "some" ? revision.value : undefined); return null; },
        ...(narrowing === undefined ? {} : { query: narrowing }),
    };
}

/** A layer that says its windows by a label its wrapper reads as it is asked, and passes the source's refresh through. */
function useLabelled(paged: PlanPagedSourceValue | undefined, label: string, made: string[]): PlanPagedSourceValue | undefined {
    return usePagedWrapper(paged, { label }, (_source, latest) => {
        made.push(label);
        return {
            page: (offset, limit) => latest().src?.page(offset, limit) ?? none,
            revision: () => some(`${label}#${latest().label}`),
            refresh: ownRefresh(latest),
        };
    });
}

describe("the wrapper a layer reads its paged rows through", () => {
    test("one wrapper a source: the same while the same source stands under it, though the layer draws with something new; another for another source", () => {
        const refreshed: (string | undefined)[] = [];
        const first = sourceOf(2_000n, refreshed);
        const made: string[] = [];
        const { result, rerender } = renderHook(({ paged, label }: { paged: PlanPagedSourceValue | undefined; label: string }) => useLabelled(paged, label, made),
            { initialProps: { paged: first as PlanPagedSourceValue | undefined, label: "a" } });
        const wrapper = result.current!;
        expect(made).toEqual(["a"]);
        // The layer draws with something new over the same source: the wrapper stands, and reads what stands now.
        rerender({ paged: first, label: "b" });
        expect(result.current).toBe(wrapper);
        expect(made).toEqual(["a"]);
        const revision = wrapper.revision?.();
        expect(revision?.type === "some" ? revision.value : undefined).toBe("a#b");
        // Another source, of other functions: no source deriving the same rows, so a wrapper of its own.
        const second = sourceOf(40n, refreshed);
        rerender({ paged: second, label: "c" });
        expect(result.current).not.toBe(wrapper);
        expect(made).toEqual(["a", "c"]);
        // And none where the layer wraps none.
        rerender({ paged: undefined, label: "d" });
        expect(result.current).toBeUndefined();
    });

    test("the source's count, key search, narrowing and refresh are its own, read as it stands when asked; a member it has not, the wrapper has not", () => {
        const refreshed: (string | undefined)[] = [];
        let narrowing = "hall: Hall 2";
        const live = sourceOf(2_000n, refreshed, () => narrowing);
        const made: string[] = [];
        const { result } = renderHook(() => useLabelled(live, "a", made));
        const wrapper = result.current!;
        const total = wrapper.total();
        expect(total.type === "some" ? total.value : undefined).toBe(2_000n);
        expect(wrapper.seek.type).toBe("none");
        expect(wrapper.query?.()).toBe("hall: Hall 2");
        narrowing = "hall: Hall 3";
        expect(wrapper.query?.()).toBe("hall: Hall 3");
        wrapper.refresh?.(some("R2"));
        expect(refreshed).toEqual(["R2"]);
        // A pinned source names no narrowing: nor does its wrapper, which the paging driver reads as pinned.
        const pinned = renderHook(() => useLabelled(sourceOf(10n, refreshed), "a", made));
        expect(pinned.result.current!.query).toBeUndefined();
    });

    test("the two roots a layer hands on read their rows through its wrapper, on the arm they were on; the roots given where it wraps none", () => {
        const refreshed: (string | undefined)[] = [];
        const source = sourceOf(2_000n, refreshed);
        const value = rootOf(variant("pinned", source));
        const data = rootOf(variant("pinned", source));
        const made: string[] = [];
        const wrapped = renderHook(() => {
            const wrapper = useLabelled(windowedSourceOf(value.rows), "a", made);
            return { wrapper, roots: usePagedRoots(value, data, wrapper) };
        });
        const { wrapper, roots } = wrapped.result.current;
        expect(roots.value.rows.type).toBe("pinned");
        expect(windowedSourceOf(roots.value.rows)).toBe(wrapper);
        expect(windowedSourceOf(roots.data.rows)).toBe(wrapper);
        // The same two objects while the roots and the wrapper hold.
        wrapped.rerender();
        expect(wrapped.result.current.roots).toBe(roots);
        const bare = renderHook(() => usePagedRoots(value, data, undefined));
        expect(bare.result.current.value).toBe(value);
        expect(bare.result.current.data).toBe(data);
    });
});
