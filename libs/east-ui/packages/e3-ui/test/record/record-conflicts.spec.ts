/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record meeting someone else's save (`recordConflicts`): the example
 * evaluates, reads its crew from e3, and declares the one record its Saves —
 * through the patch door — and its buttons — another person's change, removal
 * and addition — commit to.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./record.examples.js";

describeEast("Record — your edits meeting someone else's save", test => {
    Assert.examples(test, {
        recordConflicts: ex.recordConflicts,
    });
}, { platformFns: TestImpl });

describe("the Record meeting someone else's save", () => {
    test("reads its crew from e3, and declares the one record its Saves and its buttons commit to", () => {
        const manifest = deriveManifest(ex.recordConflicts.fn);
        assert.notEqual(manifest.paths.length + manifest.pages.length, 0, "the crew are read from e3");
        assert.deepEqual([...new Set(manifest.records)], [ex.recordConflictCrew.name]);
    });
});
