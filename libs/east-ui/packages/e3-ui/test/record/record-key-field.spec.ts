/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record over rows that hold their own key in a field (`recordStaffIds`):
 * the example evaluates, reads its staff from e3, and declares the one record
 * its Saves commit to, through the patch door.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./record.examples.js";

describeEast("Record — rows that hold their own key in a field", test => {
    Assert.examples(test, {
        recordStaffIds: ex.recordStaffIds,
    });
}, { platformFns: TestImpl });

describe("the Record over rows that hold their own key in a field", () => {
    test("reads its staff from e3, and declares the one record its Saves commit to", () => {
        const manifest = deriveManifest(ex.recordStaffIds.fn);
        assert.notEqual(manifest.paths.length + manifest.pages.length, 0, "the staff are read from e3");
        assert.deepEqual([...new Set(manifest.records)], [ex.recordStaff.name]);
    });
});
