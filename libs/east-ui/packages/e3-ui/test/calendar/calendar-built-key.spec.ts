/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar over reservations keyed by the key their row builds
 * (`calendarBuiltKeys`): the example evaluates with `rowKey` given on its event
 * kind, reads from e3, and binds the reservations' record, which its Saves
 * commit to, beside the machines' it reads.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./calendar.examples.js";

describeEast("Calendar — reservations keyed by the key their row builds", test => {
    Assert.examples(test, {
        calendarBuiltKeys: ex.calendarBuiltKeys,
    });
}, { platformFns: TestImpl });

describe("the Calendar over reservations keyed by the key their row builds", () => {
    test("ruling 1 — given `rowKey` on its event kind, it reads from e3 and binds the reservations' record, which its Saves commit to, beside the machines' it reads", () => {
        const manifest = deriveManifest(ex.calendarBuiltKeys.fn);
        assert.notEqual(manifest.paths.length + manifest.pages.length, 0, "the reservations and the machines are read from e3");
        assert.deepEqual([...new Set(manifest.records)].sort(), [ex.calendarMachines.name, ex.calendarReservations.name]);
    });
});
