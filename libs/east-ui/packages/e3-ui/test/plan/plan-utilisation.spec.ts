/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paper stores, as their seed makes them: three stores of bays, each
 * bay's stock every day of thirteen weeks within what it holds. And the Plan
 * over them: it builds, and reads the stores whole — a store's summary maps
 * its bays, which a page of rows carries each row without. What it draws, on
 * e3 — each store's folded row its bays' pallets over the
 * pallets they hold, not the mean of their fills — is e3-ui-components'
 * (`plan/frame/plan-utilisation-examples`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, East, IntegerType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-utilisation.examples.js";

const compareCount = compareFor(IntegerType);
const sameTime = equalFor(DateTimeType);

describe("the paper stores", () => {
    test("three stores of nine bays, each bay's stock every day of thirteen weeks from Monday 5 October 2026 within the pallets it holds — the record starts with them", () => {
        const stores = East.compile(ex.generatePaperStores, [])(91n);
        assert.deepEqual([...stores.keys()], ["S-1", "S-2", "S-3"]);
        assert.deepEqual([...stores.values()].map((store) => [...store.bays.keys()]), [["R1", "R2", "R3"], ["S1", "S2", "S3", "S4"], ["B1", "B2"]]);
        for (const store of stores.values()) {
            for (const [key, bay] of store.bays) {
                const days = [...bay.stock.keys()];
                assert.equal(days.length, 91, key);
                days.forEach((day, i) => assert.ok(sameTime(day, new Date(Date.UTC(2026, 9, 5 + i))), `${key}: day ${i}`));
                for (const pallets of bay.stock.values()) {
                    assert.ok(compareCount(pallets, 0n) >= 0 && compareCount(pallets, bay.capacity) <= 0, `${key}: no more than it holds, and never below none`);
                }
            }
        }
        assert.ok(equalFor(ex.PaperStores)(ex.planPaperStores.default!, stores));
    });
});

describe("the Plan over them", () => {
    test(ex.planGroupUtilisation.description, () => {
        const manifest = deriveManifest(ex.planGroupUtilisation.fn);
        // Its stores are read whole, never a page at a time.
        assert.deepEqual(manifest.paths, [ex.planPaperStores.path]);
        assert.equal(manifest.pages.length, 0, "the Plan reads no page of the stores");
        const component = (ex.planGroupUtilisation.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
});
