/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's reads of the app's records (`Decision Queue Spec.md`
 * R1, R5, R6, D4), in a component of their own, as every builder's are
 * (#1343): the cases through the payload's `decisions` — the record read
 * whole, or the slice's `decisions` source read complete, at most 1,000, or
 * past that how many there are — and the verdicts of the cases read, by key
 * through the verdicts' `entries`, every case's in one request
 * ({@link rowsByKey}), never whole. Nothing is narrowed in the
 * browser. What it read stands until a read is whole again — a new
 * narrowing's cases, another session's case or verdict — and is handed to the
 * frame, in the queue's order, only when it moves; while a new narrowing's
 * cases are read, what the last one read stands in, and the frame is told so
 * (`filtering`, #1398 CL8).
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrayType, IntegerType, equalFor, none, type ValueTypeOf } from "@elaraai/east";
import { DECISIONS_SOURCE, DecisionCaseType } from "@elaraai/e3-ui/internal";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { sourcePart } from "../shared/schedule/visibility.js";
import { orderCases, type DecisionCase } from "./layout.js";
import { rowsByKey, type DecisionQueueValue } from "./editing.js";

const casesEqual = equalFor(ArrayType(DecisionCaseType));
const integerEqual = equalFor(IntegerType);
const narrowingEqual = equalFor(RecordSliceStateType);

/** The narrowing a read was made under: the `decisions` source's state, `undefined` with no source. */
type Narrowing = ValueTypeOf<typeof RecordSliceStateType> | undefined;

/** What the queue has read. */
export interface DecisionData {
    /** The cases read, in the queue's order; `undefined` before a read has landed, or past the cap. */
    readonly cases: readonly DecisionCase[] | undefined;
    /** How many cases the narrowing holds, past the cap: none are read. */
    readonly tooMany: bigint | undefined;
    /** The keys of the cases read whose verdict reads back as saved: they never show (D1). */
    readonly saved: ReadonlySet<string>;
    /** Whether a read — the cases, or a verdict of one — is in flight. */
    readonly loading: boolean;
    /** Whether a new narrowing's cases are read while what the last one read stands in (#1398, CL8). */
    readonly filtering: boolean;
    /** Whether a complete read has landed: the frame's cold load is over (#1398, CL5). */
    readonly landed: boolean;
    /** Why the latest read failed. */
    readonly error: string | undefined;
    /** Reads the cases and their verdicts again. */
    readonly retry: () => void;
}

const NO_SAVED: ReadonlySet<string> = new Set();
const NO_RETRY = (): void => {};

/** Before any read: nothing read, nothing landed. */
export const INITIAL_DATA: DecisionData = {
    cases: undefined, tooMany: undefined, saved: NO_SAVED, loading: true, filtering: false, landed: false, error: undefined, retry: NO_RETRY,
};

/** A complete read: the cases as read and in the queue's order, the saved verdicts, or the count past the cap, and the narrowing it was made under. */
interface Complete {
    readonly read: readonly DecisionCase[] | undefined;
    readonly cases: readonly DecisionCase[] | undefined;
    readonly tooMany: bigint | undefined;
    readonly saved: ReadonlySet<string>;
    readonly narrowing: Narrowing;
}

/** Two sets of keys holding the same keys. */
function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false;
    for (const key of a) if (!b.has(key)) return false;
    return true;
}

/** Two narrowings the same: both none, or the same state. */
function sameNarrowing(a: Narrowing, b: Narrowing): boolean {
    if (a === undefined || b === undefined) return a === undefined && b === undefined;
    return narrowingEqual(a, b);
}

/**
 * Reads the cases and their verdicts (see the module docs).
 *
 * @param value - The payload
 * @returns What the queue has read
 */
export function useDecisionData(value: DecisionQueueValue): DecisionData {
    const { decisions, verdicts } = value;
    const part = useMemo(() => sourcePart(value.slice.type === "some" ? value.slice.value : undefined, DECISIONS_SOURCE), [value.slice]);
    // Retry runs the read again, after asking its records again.
    const [nonce, setNonce] = useState(0);
    const read = useCallback(() => {
        void nonce;
        // The narrowing the cases are read under, read in the same pass, so what lands says which narrowing it is.
        const narrowing: Narrowing = part?.read();
        const got = decisions.read();
        if (got.type !== "some") return { loading: true, narrowing } as const;
        if (got.value.type === "tooMany") return { loading: false, tooMany: got.value.value, narrowing } as const;
        const cases = got.value.value;
        // Every case's verdict in one request.
        const verdict = rowsByKey({ name: "Verdicts", editing: verdicts.editing }, verdicts.entries.paged, cases.map(c => c.key));
        if (verdict.type !== "some") return { loading: true, narrowing } as const;
        const saved = new Set<string>();
        verdict.value.forEach((row, i) => { if (row.row.type === "some") saved.add(cases[i]!.key); });
        return { loading: false, cases, saved, narrowing } as const;
    }, [decisions, verdicts, part, nonce]);
    const { result } = useTrackedEvaluation(read);
    const complete = useRef<Complete | undefined>(undefined);
    if (result.ok && !result.value.loading) {
        const got = result.value;
        const was = complete.current;
        const sameNarrowed = was !== undefined && sameNarrowing(was.narrowing, got.narrowing);
        if ("tooMany" in got && got.tooMany !== undefined) {
            const sameCount = was?.tooMany !== undefined && integerEqual(was.tooMany, got.tooMany);
            if (!sameCount || !sameNarrowed) complete.current = { read: undefined, cases: undefined, tooMany: got.tooMany, saved: NO_SAVED, narrowing: got.narrowing };
        } else if ("cases" in got && got.cases !== undefined) {
            // A read again as it was keeps what it made: the same cases, in the same order.
            const sameCases = was?.read !== undefined && casesEqual(was.read as DecisionCase[], got.cases as DecisionCase[]);
            const sameSaved = was !== undefined && sameKeys(was.saved, got.saved);
            if (!sameCases || !sameSaved || !sameNarrowed || was?.tooMany !== undefined) {
                complete.current = {
                    read: sameCases ? was!.read : got.cases, cases: sameCases ? was!.cases : orderCases(got.cases),
                    tooMany: undefined, saved: sameSaved ? was!.saved : got.saved, narrowing: got.narrowing,
                };
            }
        }
    }
    const held = complete.current;
    const loading = result.ok ? result.value.loading : false;
    // A read under another narrowing than the one what stands was read under: the last narrowing's cases stand in.
    const filtering = loading && held !== undefined && result.ok && !sameNarrowing(held.narrowing, result.value.narrowing);
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : String(result.error);
    const retry = useCallback(() => {
        verdicts.entries.refresh(none);
        part?.retry();
        setNonce(n => n + 1);
    }, [verdicts, part]);
    return useMemo(() => ({
        cases: held?.cases, tooMany: held?.tooMany, saved: held?.saved ?? NO_SAVED, loading, filtering, landed: held !== undefined, error, retry,
    }), [held, loading, filtering, error, retry]);
}

/**
 * The queue's reads, in a component of their own (#1343): each page and
 * verdict that lands re-runs it alone, and it hands the frame what it read
 * only when that moves.
 *
 * @param props - The payload, and where the data goes
 * @returns Nothing: it reads
 */
export function DecisionDataReader({ value, onData }: { value: DecisionQueueValue; onData: (data: DecisionData) => void }): null {
    const data = useDecisionData(value);
    const reported = useRef<DecisionData | undefined>(undefined);
    useLayoutEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
