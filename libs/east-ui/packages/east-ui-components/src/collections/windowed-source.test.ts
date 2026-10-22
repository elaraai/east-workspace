/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test } from "vitest";
import { OptionType, StringType, equalFor, none, some, type option } from "@elaraai/east";
import { PagedScan } from "./paged-scan.js";
import { snapshotOf } from "./windowed-source.js";

const snapshotEqual = equalFor(OptionType(StringType));

test("a source's snapshot is its revision, and a live source's its narrowing with it; a paged source names none (#1354)", () => {
    const state: { revision: option<string>; narrowing: string } = { revision: some("R1"), narrowing: "A" };
    const pinned = { revision: () => state.revision };
    const live = { revision: () => state.revision, query: () => state.narrowing };
    expect(snapshotOf({})).toBeUndefined();
    expect(snapshotEqual(snapshotOf(pinned)!, some("R1"))).toBe(true);
    const underA = snapshotOf(live)!;
    expect(underA.type).toBe("some");
    // A choice moves it, under the same revision; the same narrowing again is the same snapshot.
    state.narrowing = "B";
    const underB = snapshotOf(live)!;
    expect(snapshotEqual(underA, underB)).toBe(false);
    state.narrowing = "A";
    expect(snapshotEqual(snapshotOf(live)!, underA)).toBe(true);
    // A write moves it under the same narrowing, and a pinned source's with it.
    state.revision = some("R2");
    expect(snapshotEqual(snapshotOf(live)!, underA)).toBe(false);
    expect(snapshotEqual(snapshotOf(pinned)!, some("R2"))).toBe(true);
    // While the revision is found, there is no snapshot to read at.
    state.revision = none;
    expect(snapshotEqual(snapshotOf(live)!, none)).toBe(true);
});

test("a scan keyed by a live source's snapshot reads a new narrowing again from its first row, never a row of the old one in its result (#1354)", () => {
    const scan = new PagedScan<string, string[]>(() => [], (rows, page) => { rows.push(...page); });
    const state = { narrowing: "A", landed: true };
    const live = { revision: () => some("R1"), query: () => state.narrowing };
    const reads: string[] = [];
    const read = () => scan.read(() => snapshotOf(live) ?? none, () => some(300n), (offset, limit) => {
        reads.push(`${state.narrowing}:${offset}`);
        if (!state.landed && offset > 0n) return none;
        return some(Array.from({ length: Number(limit) }, (_, i) => `${state.narrowing}:${offset + BigInt(i)}`));
    });
    const first = read();
    expect(first.type === "some" && first.value.length === 300 && first.value.every((row) => row.startsWith("A:"))).toBe(true);
    // A choice: the same revision, another narrowing — its first page lands, its second is on the wire, and the scan
    // holds no partial result meanwhile.
    state.narrowing = "B";
    state.landed = false;
    expect(read()).toEqual(none);
    expect(reads.filter((r) => r.startsWith("B:"))).toEqual(["B:0", "B:256"]);
    state.landed = true;
    const second = read();
    expect(second.type === "some" && second.value.length === 300 && second.value.every((row) => row.startsWith("B:"))).toBe(true);
    // The same narrowing again reads nothing more.
    const before = reads.length;
    expect(read()).toEqual(second);
    expect(reads).toHaveLength(before);
});
