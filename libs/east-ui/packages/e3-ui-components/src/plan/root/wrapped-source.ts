/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A canvas's paged rows read through a wrapper: what the layers of its
 * composition share (`../use-plan-editing.ts`, `kept.ts`, `events.ts`,
 * `nested.ts`). Each layer draws the windows of the source under it its own
 * way — the drafts in their entries' place, kept while what they are made
 * from holds, the event kinds' events joined in, the lean rows filled with the
 * cells read — and every one is a wrapper of the same making:
 *
 * - ONE wrapper a source. A host function is equivalent only to itself, so a
 *   new wrapper would be a new source to the paging driver, which would drop
 *   its windows: the wrapper made for a source is the one handed on while a
 *   source that derives the same rows stands under it — by the driver's own
 *   test (`pagedSourceEquivalent`, #809).
 * - It reads the source under it, and whatever else its layer drew with, as
 *   they stand when it is asked ({@link PagedLatest}): the canvas's last
 *   render's, never the render's that made the wrapper.
 * - The source's own members that no layer changes are passed through as it
 *   has them: its id, its count, its key search and, where it is a live one,
 *   its narrowing. A member added to a paged source that every layer passes
 *   through is passed through here, once.
 * - A layer says the rest ({@link PagedOwn}): its windows, and whichever of the
 *   revision, the refresh, the snapshot, the redraw of a window standing in
 *   and the windows held it names its own way, or passes through where the
 *   source has it.
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import { none, some, variant } from "@elaraai/east";
import { snapshotOf } from "@elaraai/east-ui-components/internal";
import { pagedSourceEquivalent } from "../controller/paging.js";
import type { PlanRootValue } from "../model.js";
import { windowedArm, type PlanPagedSourceValue } from "../use-plan-paging.js";

/** What a wrapper reads as it is asked: the source under it now, and what else its layer drew with at the canvas's last render. */
export type PagedLatest<X> = X & { readonly src: PlanPagedSourceValue | undefined };

/** What a layer says of its wrapper: its windows, and each of the source's other members it does not pass through as the source has it. */
export type PagedOwn = Pick<PlanPagedSourceValue, "page"> & Partial<Omit<PlanPagedSourceValue, "id" | "page" | "total" | "seek" | "query">>;

/**
 * The wrapper a layer reads a paged source through (see the module docs): the
 * one made for the source while a source deriving the same rows stands under
 * it, its shared members passed through, the rest the layer's.
 *
 * @typeParam X - What else the layer's wrapper reads as it is asked
 * @param paged - The source under the layer; `undefined` where the layer wraps none
 * @param extras - What else the wrapper reads, as it stands at this render
 * @param own - The layer's members, made once a wrapper: given the source the wrapper is made for, which says which
 *   members it has, and a read of what stands now
 * @returns The wrapper; `undefined` with no source
 */
export function usePagedWrapper<X extends object>(
    paged: PlanPagedSourceValue | undefined, extras: X,
    own: (source: PlanPagedSourceValue, latest: () => PagedLatest<X>) => PagedOwn,
): PlanPagedSourceValue | undefined {
    const latest = useRef<PagedLatest<X>>({ ...extras, src: paged });
    latest.current = { ...extras, src: paged };
    // The layer's members are made when a wrapper is: by the layer as it stands at that render.
    const making = useRef(own);
    making.current = own;
    const wrapperOf = useRef<{ src: PlanPagedSourceValue; wrapped: PlanPagedSourceValue } | undefined>(undefined);
    return useMemo((): PlanPagedSourceValue | undefined => {
        if (paged === undefined) return undefined;
        const prior = wrapperOf.current;
        if (prior !== undefined && pagedSourceEquivalent(prior.src, paged)) return prior.wrapped;
        const read = (): PagedLatest<X> => latest.current;
        const next: PlanPagedSourceValue = {
            id: paged.id,
            total: () => latest.current.src?.total() ?? none,
            seek: paged.seek.type === "some"
                ? some((query) => {
                    const s = latest.current.src?.seek;
                    return s !== undefined && s.type === "some" ? s.value(query) : none;
                })
                : none,
            // A live source's narrowing, as it stands: the driver reads its windows again when it moves (#1354).
            ...(paged.query !== undefined ? { query: () => latest.current.src?.query?.() ?? "" } : {}),
            ...making.current(paged, read),
        };
        wrapperOf.current = { src: paged, wrapped: next };
        return next;
    }, [paged]);
}

/**
 * The source's own refresh, passed through.
 *
 * @param latest - A read of the source under the wrapper now
 * @returns The wrapper's refresh
 */
export function ownRefresh(latest: () => { readonly src: PlanPagedSourceValue | undefined }): NonNullable<PlanPagedSourceValue["refresh"]> {
    return (revision) => latest().src?.refresh?.(revision) ?? null;
}

/**
 * The snapshot of the rows themselves (#1199): the source's own — its
 * revision, and a live source's narrowing with it (#1354) — which what a layer
 * draws over the rows leaves.
 *
 * @param latest - A read of the source under the wrapper now
 * @returns The wrapper's snapshot
 */
export function ownSnapshot(latest: () => { readonly src: PlanPagedSourceValue | undefined }): NonNullable<PlanPagedSourceValue["snapshot"]> {
    return () => {
        const src = latest().src;
        return src === undefined ? none : snapshotOf(src) ?? none;
    };
}

/**
 * A root's rows read through a wrapper: on the arm they were on.
 *
 * @param root - The root
 * @param wrapped - The wrapper over its paged rows
 * @returns Its rows
 */
export function wrappedRows(root: PlanRootValue, wrapped: PlanPagedSourceValue): PlanRootValue["rows"] {
    return variant(windowedArm(root.rows), wrapped) as PlanRootValue["rows"];
}

/**
 * The two roots a layer hands on, their paged rows read through its wrapper:
 * the roots given where it wraps none, and the same two objects while the
 * roots and the wrapper hold.
 *
 * @param value - The latest root
 * @param data - Its data-stable twin
 * @param wrapped - The layer's wrapper; `undefined` where it wraps none
 * @returns The two roots the canvas draws
 */
export function usePagedRoots(value: PlanRootValue, data: PlanRootValue, wrapped: PlanPagedSourceValue | undefined): { value: PlanRootValue; data: PlanRootValue } {
    const shownData = useMemo(() => (wrapped === undefined ? data : { ...data, rows: wrappedRows(data, wrapped) }), [wrapped, data]);
    const shownValue = useMemo(() => (wrapped === undefined ? value : { ...value, rows: wrappedRows(value, wrapped) }), [wrapped, value]);
    return useMemo(() => ({ value: shownValue, data: shownData }), [shownValue, shownData]);
}
