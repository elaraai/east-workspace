/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar over events keyed by the key their row builds, under the rail
 * (`calendarBuiltKeysSliced`): the example evaluates with `rowKey` given on its
 * event kind as a struct and `slice` on its tag, reads its reservations a page
 * at a time through their record's indexes, and binds the reservations'
 * record, which its Saves commit to, beside the machines' it reads.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./calendar-keys.examples.js";

describeEast("Calendar — events keyed by the struct their row builds, under the rail", test => {
    Assert.examples(test, {
        calendarBuiltKeysSliced: ex.calendarBuiltKeysSliced,
    });
}, { platformFns: TestImpl });

describe("the Calendar over events keyed by the struct their row builds, under the rail", () => {
    test("#1696 — given `rowKey` on its event kind and `slice` on its tag, it pages its reservations from e3 and binds their record, which its Saves commit to, beside the machines' it reads", () => {
        const manifest = deriveManifest(ex.calendarBuiltKeysSliced.fn);
        assert.notEqual(manifest.pages.length, 0, "the reservations are read a page at a time");
        assert.deepEqual([...new Set(manifest.records)].sort(), [ex.keyedMachines.name, ex.keyedReservations.name]);
    });
});
