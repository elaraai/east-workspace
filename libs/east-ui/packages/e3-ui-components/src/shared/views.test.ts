/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, expect, test } from "vitest";
import { variant } from "@elaraai/east";
import { shownView, shownViews } from "./views.js";

const ORDER = ["calendar", "resources", "timeline"] as const;

describe("the views an instance offers", () => {
    test("in the component's order, whatever order the list comes in", () => {
        expect(shownViews(ORDER, [variant("timeline", null), variant("calendar", null)])).toEqual(["calendar", "timeline"]);
    });
    test("an empty list, or one holding none of them, leaves every view", () => {
        expect(shownViews(ORDER, [])).toEqual(ORDER);
        expect(shownViews(ORDER, [variant("gone", null)])).toEqual(ORDER);
    });
    test("the view held while it is offered, else the first offered", () => {
        expect(shownView("timeline", ["calendar", "timeline"])).toBe("timeline");
        expect(shownView("resources", ["calendar", "timeline"])).toBe("calendar");
    });
});
