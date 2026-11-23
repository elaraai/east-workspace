/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record over rows keyed by the key their row builds, under the rail
 * (`recordBuiltKeysSliced`, `recordStructKeysSliced`): each example evaluates
 * with `rowKey` and `slice` given on its tag, pages its locations through their
 * record's indexes, and declares the one record its Saves commit to — keyed by
 * a text, and by a struct.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./record-keys.examples.js";

describeEast("Record — rows keyed by the key their row builds, under the rail", test => {
    Assert.examples(test, {
        recordBuiltKeysSliced: ex.recordBuiltKeysSliced,
        recordStructKeysSliced: ex.recordStructKeysSliced,
    });
}, { platformFns: TestImpl });

describe("the Record over rows keyed by the key their row builds, under the rail", () => {
    for (const [name, example, record] of [
        ["a text key", ex.recordBuiltKeysSliced, ex.recordSlotsByText],
        ["a struct key (#1696)", ex.recordStructKeysSliced, ex.recordSlotsByStruct],
    ] as const) {
        test(`${name} — given \`rowKey\` and \`slice\` on its tag, it pages its locations from e3, and declares the one record its Saves commit to`, () => {
            const manifest = deriveManifest(example.fn);
            assert.notEqual(manifest.pages.length, 0, "the locations are read a page at a time");
            assert.deepEqual([...new Set(manifest.records)], [record.name]);
        });
    }
});
