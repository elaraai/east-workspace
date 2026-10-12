/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBeast2For, encodeBeast2For, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import { indexedWorkOrders } from "../sheet/sheet-records.examples.js";
import * as ex from "./plan-records.examples.js";

for (const example of [ex.planRecordIndexes, ex.planRecordIndexesMobile]) {
    test(example.description, () => {
        const manifest = deriveManifest(example.fn);
        assert.deepEqual(manifest.pages, [indexedWorkOrders.path]);
        assert.equal(manifest.paths.length, 0, "the Plan never reads the whole record");
        assert.ok(manifest.records.length > 0);
        const component = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
}
