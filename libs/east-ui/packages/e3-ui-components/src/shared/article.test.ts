/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The article a noun takes, by its first sound, and every builder's words
 * taking it so: the Plan's, the Flowchart's, the Schematic's, the Sheet's and
 * the query builder's, as the Record's do.
 */

import { describe, expect, test } from "vitest";
import { DEFAULT_FLOWCHART_NOUNS, flowchartMessagesOf } from "../flowchart/messages.js";
import { planMessages } from "../plan/messages.js";
import { queryMessages } from "../query/model/messages.js";
import { schematicMessages } from "../schematic/messages.js";
import { sheetMessages } from "../sheet/messages.js";
import { withArticle } from "./article.js";

describe("a noun's article", () => {
    test("goes by its first sound, not its first letter", () => {
        expect(["person", "operator", "user", "unit", "uniform", "umbrella stand", "usher", "euro account", "one-off", "hour entry", "honest broker", "hire"]
            .map(withArticle)).toEqual([
            "a person", "an operator", "a user", "a unit", "a uniform", "an umbrella stand", "an usher", "a euro account", "a one-off", "an hour entry",
            "an honest broker", "a hire",
        ]);
    });

    test("every builder's words take it by the sound: never `an user`, nor `a hour`", () => {
        expect([planMessages.dropNeedsRow({ kind: "user" }), planMessages.dropCardNeedsEvent({ fields: ["hour"] })])
            .toEqual(["Drop on a user row", "Drop an hour onto an event"]);
        const flowchart = flowchartMessagesOf({ ...DEFAULT_FLOWCHART_NOUNS, state: "Unit", lane: "Hour" });
        expect([flowchart.stateKeyTaken({ key: "U1" }), flowchart.inspectorHintTouch()])
            .toEqual(['A unit is keyed "U1" already', "Tap a unit, a transition, a decision or an hour's header to see its details here."]);
        expect([schematicMessages.dropRefused({ why: "onto", kind: "uplink" }), schematicMessages.inspectorKeyRefused({ name: "hour", key: "H1" })])
            .toEqual(["Drop onto an uplink", "An hour is keyed H1 already"]);
        expect(schematicMessages.dropRefused({ why: "onto", kind: "unit" })).toBe("Drop onto a unit");
        expect(sheetMessages.noticeCantAdd({ what: "group", noun: "user", label: "Serial" })).toBe("Can't add a user — the app gives no Serial");
        expect([queryMessages.choose({ what: "unit" }), queryMessages.wrongKind({ label: "region", kind: "text", what: "hour" }),
            queryMessages.keyKind({ dataset: "orders", kind: "text", label: "the key", keyKind: "unique id" })])
            .toEqual(["Choose a unit.", "Region is text — pick an hour.", "Orders are found by text ids, but the key is a unique id."]);
    });
});
