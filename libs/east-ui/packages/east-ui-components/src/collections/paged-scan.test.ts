/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test } from "vitest";
import { none, some, type option } from "@elaraai/east";
import { PagedScan } from "./paged-scan.js";

test("partial scans resume after failures but discard all progress when the revision changes", () => {
    const scan = new PagedScan<string, string[]>(() => [], (rows, page) => { rows.push(...page); });
    let revision: option<string> = some("A");
    let ready = 0n;
    let fail = false;
    const reads: bigint[] = [];
    const read = () => scan.read(() => revision, () => some(513n), (offset, limit) => {
        reads.push(offset);
        if (fail) throw new Error("offline");
        if (offset > ready) return none;
        return some(Array.from({ length: Number(limit) }, (_, i) => `${revision.type === "some" ? revision.value : ""}:${offset + BigInt(i)}`));
    });
    expect(read()).toEqual(none);
    expect(reads).toEqual([0n, 256n]);
    fail = true;
    expect(read).toThrow("offline");
    fail = false; ready = 256n;
    expect(read()).toEqual(none);
    expect(reads).toEqual([0n, 256n, 256n, 256n, 512n]);
    revision = none;
    expect(read()).toEqual(none);
    revision = some("B"); ready = 512n;
    const result = read();
    expect(result.type).toBe("some");
    if (result.type !== "some") throw new Error("The scan should be complete");
    expect(result.value).toEqual(Array.from({ length: 513 }, (_, i) => `B:${i}`));
    const before = reads.length;
    expect(read()).toEqual(result);
    expect(reads).toHaveLength(before);
});
