/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Dock's control stands at the middle of its rail, open or collapsed: its
 * inset is the rail's own, on the rail's bar and on the open row alike, so it
 * never moves as the pane toggles, whatever size its host gives the rail. And
 * a row that takes no press shows none. Where the page draws it is measured in
 * the browser (`dock.spec.ts`, `builder-panes.spec.ts`).
 */

import { describe, expect, test } from "vitest";
import { CONTROL_INSET, CONTROL_INSET_CARD, dockSlotRecipe } from "./slot-recipes/dock.js";

/** A rule of a slot's base, by the keys down to it. */
const rule = (slot: string, ...keys: string[]): unknown =>
    keys.reduce<unknown>((at, key) => (at as Readonly<Record<string, unknown>>)[key], (dockSlotRecipe.base as Readonly<Record<string, unknown>>)[slot]);

describe("the Dock's control at the middle of its rail", () => {
    test("its inset is half of what the rail leaves beside the 28px control — 8px at the 44px rail — and a pixel less inside a panel's border", () => {
        expect(rule("toggle", "width")).toBe("28px");
        expect(CONTROL_INSET).toBe("calc((var(--dock-rail, 44px) - 28px) / 2)");
        expect(CONTROL_INSET_CARD).toBe("calc((var(--dock-rail, 44px) - 28px) / 2 - 1px)");
    });

    test("the rail's bar and the open row inset it alike: at the start, at the end, and on a panel of its own", () => {
        expect(rule("railBar", "paddingLeft")).toBe(CONTROL_INSET);
        expect(rule("header", "[data-dock-control=start] > &", "paddingLeft")).toBe(CONTROL_INSET);
        expect(rule("railBar", "[data-orientation=horizontal][data-side=end] > &", "paddingRight")).toBe(CONTROL_INSET);
        expect(rule("header", "[data-orientation=horizontal][data-dock-control=end] > &", "paddingRight")).toBe(CONTROL_INSET);
        expect(rule("railBar", "[data-surface=card][data-orientation=horizontal] > &", "paddingLeft")).toBe(CONTROL_INSET_CARD);
        expect(rule("header", "[data-surface=card][data-dock-control=start] > &", "paddingLeft")).toBe(CONTROL_INSET_CARD);
        expect(rule("railBar", "[data-surface=card][data-orientation=horizontal][data-side=end] > &", "paddingRight")).toBe(CONTROL_INSET_CARD);
        expect(rule("header", "[data-surface=card][data-orientation=horizontal][data-dock-control=end] > &", "paddingRight")).toBe(CONTROL_INSET_CARD);
    });

    test("a row shows it takes a press only where it does: the pointer's cursor is the toggling row's, and a name on any other is no control", () => {
        expect([rule("header", "cursor"), rule("header", "&[data-toggles]", "cursor"), rule("tab", "span&", "cursor")]).toEqual(["default", "pointer", "inherit"]);
    });
});
