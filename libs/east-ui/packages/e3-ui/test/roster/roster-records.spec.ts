/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBeast2For, encodeBeast2For, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./roster-records.examples.js";
import { rosterWeeks, rosterStaff } from "./roster.examples.js";

for (const example of [ex.rosterRecordIndexes, ex.rosterRecordIndexesMobile]) {
    test(example.description, () => {
        const manifest = deriveManifest(example.fn);
        assert.ok(manifest.pages.some(path => path.at(-1)?.value === rosterStaff.name));
        assert.ok(manifest.pages.some(path => path.at(-1)?.value === rosterWeeks.name));
        assert.ok(!manifest.paths.some(path => path.at(-1)?.value === rosterWeeks.name), "week history is never read whole");
        assert.ok(manifest.paths.some(path => path.at(-1)?.value === rosterStaff.name), "complete staff remains the coverage and validation context");
        const ui = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(ui)).type, ui.type);
    });
}
