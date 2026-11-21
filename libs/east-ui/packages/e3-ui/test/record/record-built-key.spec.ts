/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record over rows keyed by the key their row builds (`recordBuiltKeys`):
 * the example evaluates with `key` given on the tag, reads its locations from
 * e3, and declares the one record its Saves commit to, through the patch door.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./record.examples.js";

describeEast("Record — rows keyed by the key their row builds", test => {
    Assert.examples(test, {
        recordBuiltKeys: ex.recordBuiltKeys,
    });
}, { platformFns: TestImpl });

describe("the Record over rows keyed by the key their row builds", () => {
    test("ruling 7 — given `key` on its tag, it reads its locations from e3, and declares the one record its Saves commit to", () => {
        const manifest = deriveManifest(ex.recordBuiltKeys.fn);
        assert.notEqual(manifest.paths.length + manifest.pages.length, 0, "the locations are read from e3");
        assert.deepEqual([...new Set(manifest.records)], [ex.recordLocations.name]);
    });
});
