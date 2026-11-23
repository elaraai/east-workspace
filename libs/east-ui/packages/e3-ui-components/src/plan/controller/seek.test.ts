/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's key search over rows keyed by another type than String
 * (east-workspace#1696): a query that names no one key — a range of numbers —
 * answers once its first match's own key is read, and the canvas goes to that
 * match's row; a query that names its key answers at once.
 */

import { describe, expect, test } from "vitest";
import { IntegerType, StringType, printFor, some, toEastTypeValue, variant } from "@elaraai/east";
import type { PlanRowValue } from "../model.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import { createSeekDriver, firstAtOrAfter, planRowKeys } from "./seek.js";

/** The jobs' keys, numbers, in their order. */
const KEYS = [2n, 9n, 10n, 120n, 300n];
const keyText = printFor(IntegerType);
/** A row of each job, as the canvas holds them: its id names its job's key by its text. */
const ROWS = KEYS.map((key) => ({ id: variant("entry", { path: [keyText(key)] }) })) as unknown as PlanRowValue[];
const NUMBERED = planRowKeys(some(toEastTypeValue(IntegerType)));

/** The jobs as a paged source: a page of the rows at a place, and a `seek` whose every run starts at the second job. */
function jobs(): PlanPagedSourceValue {
    return {
        id: "jobs",
        page: (offset: bigint, count: bigint) => some({ rows: [{ fixed: false, rows: ROWS.slice(Number(offset), Number(offset + count)) }] }),
        seek: some(() => some({ found: true, row: 1n, count: 3n })),
    } as unknown as PlanPagedSourceValue;
}

/** The search over the jobs, its rows keyed as given. */
function searchOf(keys = NUMBERED) {
    const seek = createSeekDriver({ clearJump: () => undefined, onChange: () => undefined, keys: () => keys });
    seek.setSource(jobs());
    return seek;
}

describe("the key search over rows keyed by another type than String (east-workspace#1696)", () => {
    test("review finding 2 — a range of numbers answers once its first match's own key is read, and the canvas goes to that match's row: never to none, by a key no row's text sorts beside", async () => {
        const seek = searchOf();
        expect(await seek.find({ from: ["9"], to: ["120"] })).toEqual({ found: true, row: 1, count: 3 });
        expect([seek.keyAt(1), seek.getSnapshot().sought]).toEqual(["9", { key: "9", row: 1 }]);
        expect(firstAtOrAfter(ROWS, seek.getSnapshot().sought!.key, NUMBERED)).toBe(1);
    });

    test("a whole key answers at once, sought by itself; and over String keys a range too, by its lower bound", async () => {
        const numbered = searchOf();
        await numbered.find({ key: "9" });
        expect([numbered.keyAt(1), numbered.getSnapshot().sought]).toEqual([undefined, { key: "9", row: 1 }]);
        const named = searchOf(planRowKeys(some(toEastTypeValue(StringType))));
        await named.find({ from: ['"b"'], to: ['"d"'] });
        expect([named.keyAt(1), named.getSnapshot().sought]).toEqual([undefined, { key: "b", row: 1 }]);
    });
});
