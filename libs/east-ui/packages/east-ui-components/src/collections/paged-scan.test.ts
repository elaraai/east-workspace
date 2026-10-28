/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { none, some, type option } from "@elaraai/east";
import { PagedScan, SCAN_CONCURRENCY } from "./paged-scan.js";

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
    // The first page lands; the rest of the count's pages are asked together.
    expect(read()).toEqual(none);
    expect(reads).toEqual([0n, 256n, 512n]);
    fail = true;
    expect(read).toThrow("offline");
    fail = false; ready = 256n;
    expect(read()).toEqual(none);
    // It resumed at the first unread page — the one that failed — and asked the next with it.
    expect(reads).toEqual([0n, 256n, 512n, 256n, 256n, 512n]);
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

/** A source of `total` rows whose pages land as the test says. */
function source(total: bigint) {
    const landed = new Set<bigint>();
    const short = new Map<bigint, number>();
    const asked: bigint[] = [];
    const page = (offset: bigint, limit: bigint): option<readonly bigint[]> => {
        asked.push(offset);
        if (!landed.has(offset)) return none;
        const size = short.get(offset) ?? Number(limit);
        return some(Array.from({ length: size }, (_, i) => offset + BigInt(i)));
    };
    return { landed, short, asked, page, read: (scan: PagedScan<bigint, bigint[]>) => scan.read(() => some("A"), () => some(total), page) };
}

const scanOf = () => new PagedScan<bigint, bigint[]>(() => [], (rows, page) => { rows.push(...page); });

describe("a scan's pages, asked together (#1398, CL7)", () => {
    test("once the count is known it asks four pages at once, never more in flight", () => {
        expect(SCAN_CONCURRENCY).toBe(4);
        const src = source(2000n);
        const scan = scanOf();
        expect(src.read(scan)).toEqual(none);
        expect(src.asked).toEqual([0n, 256n, 512n, 768n]);
        // The first lands: the next four from the first unread are asked, three still in flight beside the one that landed.
        src.landed.add(0n);
        src.asked.length = 0;
        expect(src.read(scan)).toEqual(none);
        expect(src.asked).toEqual([0n, 256n, 512n, 768n, 1024n]);
    });

    test("pages landing out of order are taken in in order, and the result handed back only once whole", () => {
        const src = source(1000n);
        const scan = scanOf();
        src.read(scan);
        // The last pages land first: nothing is whole, nothing is taken in out of order.
        src.landed.add(768n);
        src.landed.add(512n);
        expect(src.read(scan)).toEqual(none);
        src.landed.add(256n);
        expect(src.read(scan)).toEqual(none);
        src.landed.add(0n);
        const result = src.read(scan);
        if (result.type !== "some") throw new Error("the scan should be whole");
        expect(result.value).toEqual(Array.from({ length: 1000 }, (_, i) => BigInt(i)));
    });

    test("a page the server trimmed short moves the next read to where it ended: no row is skipped", () => {
        const src = source(600n);
        const scan = scanOf();
        src.landed.add(0n);
        src.short.set(0n, 200);
        src.read(scan);
        // After the trimmed first page, the next read starts at 200, not at 256.
        expect(src.asked.slice(0, 2)).toEqual([0n, 200n]);
        src.landed.add(200n);
        src.landed.add(456n);
        const result = src.read(scan);
        if (result.type !== "some") throw new Error("the scan should be whole");
        expect(result.value).toEqual(Array.from({ length: 600 }, (_, i) => BigInt(i)));
    });

    test("an aborted scan asks nothing more and drops its progress; resumed, it starts again", () => {
        const src = source(600n);
        const scan = scanOf();
        src.landed.add(0n);
        src.read(scan);
        scan.abort();
        src.asked.length = 0;
        expect(src.read(scan)).toEqual(none);
        expect(src.asked).toEqual([]);
        scan.resume();
        src.read(scan);
        expect(src.asked[0]).toBe(0n);
    });
});
