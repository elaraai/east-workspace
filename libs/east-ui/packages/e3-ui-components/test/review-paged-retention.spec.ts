/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Review proof (R1, PR #1397): what the paging runtime keeps of a revision's
 * batched key searches.
 *
 * A record Slice over an indexed binding asks a plan's searches — and a
 * reader's cells' searches — through `PagedRuntime.seekAll` (#1351): one
 * request, one channel. As the batch lands, every query's bounds go into a
 * channel of their own (`launchSeekBatch`), and each channel lives as long as
 * the revision: only a move (`moveTo`) or a reset lets one go. The batch's own
 * channel key is the text of every query it asked. So a reader that walks a
 * record — the Plan's cells reader scrolled down a paged resource kind, 50
 * resources × 15 weekly tiles a block — leaves every block's searches behind,
 * however far it has moved on, and the record Slice's own bound on landed
 * searches (`MAX_LANDED_SEARCHES`, 1,024 a revision) never applies to them.
 *
 * The runtime is driven through its API seam here, which answers each search
 * at once: what is measured is what the runtime keeps, not what e3 answers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DictType, StringType, toEastTypeValue, variant } from "@elaraai/east";
import { MAX_LANDED_SEARCHES } from "@elaraai/east-ui/internal";
import type { DatasetFindKeysQuery, DatasetFindQuery } from "@elaraai/e3-api-client";
import { PagedRuntime, type PagedApi, type PagedSource } from "../src/platform/paged-runtime.js";

/** A runtime whose channels the test can count. */
class Counted extends PagedRuntime {
    /** How many channels the runtime holds, and the longest channel key's length. */
    held(): { channels: number; longestKey: number } {
        let longestKey = 0;
        for (const key of this.entries.keys()) longestKey = Math.max(longestKey, key.length);
        return { channels: this.entries.size, longestKey };
    }
}

const REVISION = "a".repeat(64);
const refused = async (): Promise<never> => { throw new Error("this review proof reads only key searches"); };

/** The paging seam, answering every batch of searches at once, at one revision. */
const api: PagedApi = {
    getPage: refused,
    findKey: refused,
    async findKeys(_workspace, _path, query: DatasetFindKeysQuery) {
        return { results: query.queries.map((_, i) => ({ found: true, row: i, count: 1 })), hash: REVISION };
    },
    getRows: refused,
    getRuns: refused,
    place: refused,
    within: refused,
    async getRevision() { return REVISION; },
    watchRevision(_workspace, _path, onChange) { onChange(REVISION); return () => {}; },
};

/** A series index of a jobs record, as the Plan's cells reader searches it. */
const source: PagedSource = {
    path: [variant("field", "records"), variant("field", "jobs")],
    selector: { index: "jobs_by_press_week", join: false },
    type: toEastTypeValue(DictType(StringType, StringType)),
};

/** One block's cell searches: 50 presses × 15 weekly tiles, `[tile, press]` each, as `tileCellQueries` plans them. */
function blockQueries(block: number): DatasetFindQuery[] {
    const queries: DatasetFindQuery[] = [];
    for (let week = 0; week < 15; week++) {
        const tile = `2026-${String(1 + Math.floor(week / 4)).padStart(2, "0")}-${String(1 + 7 * (week % 4)).padStart(2, "0")}T00:00:00.000`;
        for (let press = 0; press < 50; press++) {
            queries.push({ fields: [tile, `"P-${String(block * 50 + press).padStart(6, "0")}"`], index: source.selector.index! });
        }
    }
    return queries;
}

/** Lets the batch's request settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a revision's batched searches are let go as the reader moves on, as the record Slice's own are (MAX_LANDED_SEARCHES)", async () => {
    const runtime = new Counted();
    runtime.initialize(api, "ws");

    // The reader walks forty blocks down the record, one at a time, reading
    // each block's searches until they land and never asking a block again.
    const BLOCKS = 40;
    for (let block = 0; block < BLOCKS; block++) {
        const queries = blockQueries(block);
        assert.equal(runtime.seekAll(source, queries).type, "none", `block ${block} is asked`);
        await settle();
        assert.equal(runtime.seekAll(source, queries).type, "some", `block ${block} has landed`);
    }

    const { channels, longestKey } = runtime.held();
    // 40 blocks × 750 searches landed; the reader holds the last block alone.
    assert.ok(channels <= MAX_LANDED_SEARCHES + 750 + 2,
        `the runtime holds ${channels} channels of one revision after the reader moved on from ${BLOCKS - 1} blocks ` +
        `(${BLOCKS * 750} searches landed) — none let go — and its longest channel key is ${longestKey} characters, ` +
        "a batch's key being the text of every query it asked");
});
