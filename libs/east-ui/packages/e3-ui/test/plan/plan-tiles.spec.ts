/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's task tiles (#1735): the crews' tasks, a day of each count the
 * tiles' slots take — one, two, three, four, and past four — in every state;
 * and the Plan over them, which reads the crews whole and builds. What it
 * draws, measured in the page, is the showcase's (`plan-bucket-tiles`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, decodeBeast2For, encodeBeast2For, printFor, variant, type EastIR } from "@elaraai/east";
import { EventStateType, UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-tiles.examples.js";

const printDay = printFor(DateTimeType);
const printState = printFor(EventStateType);

describe("a Plan's task tiles (#1735)", () => {
    test("the crews: Crew A's days hold one task, two, three, four and six; every state is drawn; rows of one lane, two and three", () => {
        const crews = ex.TILE_CREWS;
        const perDay = new Map<string, number>();
        for (const task of crews.get("crew-a")!.tasks.values()) perDay.set(printDay(task.day), (perDay.get(printDay(task.day)) ?? 0) + 1);
        assert.deepEqual([...perDay.values()], [1, 2, 3, 4, 6]);
        const drawn = new Set([...crews.values()].flatMap((crew) => [...crew.tasks.values()].map((task) => printState(task.state))));
        const every = [
            variant("actual", null), variant("in-progress", null), variant("confirmed", null),
            variant("proposed", variant("added", null)), variant("proposed", variant("recommended", null)), variant("proposed", variant("removed", null)),
            variant("estimated", null), variant("rejected", null),
        ].map((state) => printState(state));
        assert.deepEqual([...drawn].sort(), [...every].sort());
        assert.deepEqual([...crews.values()].map((crew) => crew.lanes.length), [0, 2, 3]);
    });

    test(ex.planTaskTiles.description, () => {
        const manifest = deriveManifest(ex.planTaskTiles.fn);
        // The crews, read whole: a week of a few tasks.
        assert.deepEqual(manifest.paths, [ex.planTileCrews.path]);
        assert.equal(manifest.pages.length, 0);
        const component = (ex.planTaskTiles.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
});
