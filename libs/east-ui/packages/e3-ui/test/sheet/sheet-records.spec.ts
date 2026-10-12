/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBeast2For, encodeBeast2For, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./sheet-records.examples.js";

for (const example of [ex.sheetRecordIndexes, ex.sheetRecordIndexesMobile]) {
    test(example.description, () => {
        const manifest = deriveManifest(example.fn);
        assert.deepEqual(manifest.pages, [ex.indexedWorkOrders.path]);
        assert.equal(manifest.paths.length, 0, "the examples never read the whole record");
        assert.ok(manifest.records.length > 0, "the record patch door is declared");
        const component = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        // The exported reactive function and its captured index definitions must survive the UI wire.
        const roundtrip = decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component));
        assert.equal(roundtrip.type, component.type);
    });
}
