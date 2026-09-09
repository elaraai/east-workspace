/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Sides and locks (B§4.2 — Sheet Spec §5 row 5).
 */

import { describe, test, expect } from "vitest";
import { halvesFor, startSide, halfWarns, type SidesDecl } from "./sides.js";
import type { SheetMemberValue } from "../values.js";

const decl: SidesDecl = {
    byDriver: new Map([["Transfer", "both"], ["Despatch", "from"], ["Receival", "to"], ["Drum Job", "in"]]),
    locks: [
        { half: "from", when: "to", label: "external" },
        { half: "from", when: "in", label: "in place" },
        { half: "to", when: "from", label: "external" },
    ],
};
const t = (s: string): SheetMemberValue => ({ type: "text", value: s }) as SheetMemberValue;

describe("halves", () => {
    test("the driver's sides value selects the live halves and the lock tags", () => {
        expect(halvesFor(decl, "Transfer")).toEqual({ from: { live: true, lock: "" }, to: { live: true, lock: "" }, isIn: false, sides: "both" });
        expect(halvesFor(decl, "Despatch")).toEqual({ from: { live: true, lock: "" }, to: { live: false, lock: "external" }, isIn: false, sides: "from" });
        expect(halvesFor(decl, "Receival")).toEqual({ from: { live: false, lock: "external" }, to: { live: true, lock: "" }, isIn: false, sides: "to" });
        expect(halvesFor(decl, "Drum Job")).toEqual({ from: { live: false, lock: "in place" }, to: { live: true, lock: "" }, isIn: true, sides: "in" });
        // No driver, no declaration, an unknown driver: both live.
        expect(halvesFor(decl, undefined).sides).toBe("both");
        expect(halvesFor(undefined, "Transfer").sides).toBe("both");
        expect(halvesFor(decl, "Mystery").sides).toBe("both");
    });

    test("the caret opens in the first live empty half, else the destination; a locked half with content warns", () => {
        const both = halvesFor(decl, "Transfer");
        expect(startSide(both, [[], []])).toBe(0);
        expect(startSide(both, [[t("a")], []])).toBe(1);
        expect(startSide(both, [[t("a")], [t("b")]])).toBe(1);
        expect(startSide(halvesFor(decl, "Receival"), [[], []])).toBe(1);
        expect(startSide(halvesFor(decl, "Despatch"), [[t("a")], []])).toBe(0);
        expect(halfWarns(halvesFor(decl, "Receival").from, [t("a")])).toBe(true);
        expect(halfWarns(halvesFor(decl, "Receival").from, [])).toBe(false);
        expect(halfWarns(both.from, [t("a")])).toBe(false);
    });
});
