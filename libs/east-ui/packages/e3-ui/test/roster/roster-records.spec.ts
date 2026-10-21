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
import { rosterStaffFit, rosterWarehouse, rosterWindowed, rosterDuties, rosterWeeks } from "./roster.examples.js";

/** Whether a manifest's paths — what a UI task reads whole — or its pages — what it pages — name a record. */
const names = (paths: readonly (readonly { value: string }[])[], record: { readonly name: string }) => paths.some(path => path.at(-1)?.value === record.name);

for (const example of [ex.rosterRecordIndexes, ex.rosterRecordIndexesMobile]) {
    test(example.description, () => {
        const manifest = deriveManifest(example.fn);
        assert.ok(names(manifest.pages, ex.indexedRosterStaff), "the staff are paged for the rail");
        assert.ok(names(manifest.pages, ex.indexedRosterDuties), "the duties are paged, a week at a time through the slice");
        assert.ok(names(manifest.pages, ex.indexedRosterWeeks), "the rota's weeks are read by key");
        assert.ok(!names(manifest.paths, ex.indexedRosterDuties), "a year of duties is never read whole");
        assert.ok(!names(manifest.paths, ex.indexedRosterWeeks), "nor the rota's weeks");
        assert.ok(names(manifest.paths, ex.indexedRosterStaff), "complete staff remains the coverage and validation context");
        const ui = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(ui)).type, ui.type);
    });
}

test("the windowed roster pages its duties and its weeks, and reads neither whole", () => {
    const manifest = deriveManifest(rosterWindowed.fn);
    assert.ok(names(manifest.pages, rosterDuties) && names(manifest.pages, rosterWeeks));
    assert.ok(!names(manifest.paths, rosterDuties) && !names(manifest.paths, rosterWeeks));
});

test("R5 — rosterWarehouse and rosterRecordIndexes bind the warehouse's greedy fit, `roster_staff_fit`, as their tasks' one bound function; the mobile example binds none, and offers no Find", () => {
    assert.deepEqual(deriveManifest(rosterWarehouse.fn).functions, [rosterStaffFit.name]);
    assert.deepEqual(deriveManifest(ex.rosterRecordIndexes.fn).functions, [rosterStaffFit.name]);
    assert.deepEqual(deriveManifest(ex.rosterRecordIndexesMobile.fn).functions, []);
});
