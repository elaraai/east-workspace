/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for what the sheet draws (#1516), on e3: with every entry of `vocabulary` given, the sheet's own
 * words show nowhere in its frame or what it tells a screen reader; a word left out stays the table's, and so a host's
 * translation.
 */
import { describe, expect, test } from "vitest";
import { none, some } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { sheetMessages, sheetMessagesIn, type SheetVocabulary } from "./messages.js";
import "./index.js";

const h = e3Harness({ "sheet/sheet": ex }, { measure: false });
const DEFAULTS = /\b[Mm]embers?\b|\bunassigned\b|\bsource\b|\bdestination\b|\bwanted\b|\bactual\b/u;
/** The default words in all a region says: its text, its tooltips and what it tells a screen reader, each with what is around it. */
function found(root: Element): string[] {
    const named = [...root.querySelectorAll("[title], [aria-label], [placeholder]")].flatMap(el => [el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""]);
    return [root.textContent ?? "", ...named].filter(line => DEFAULTS.test(line)).map(line => { const at = line.search(DEFAULTS); return line.slice(Math.max(0, at - 30), at + 30); });
}
const noWords: SheetVocabulary = { members: none, unassigned: none, source: none, destination: none, wanted: none, actual: none };

describe("a Sheet's words", () => {
    test("its frame says the app's words", async () => {
        const { container: c } = await h.mount(ex.sheetWording);
        expect(found(c)).toEqual([]);
    });
    test("the table holds to them, and a word left out stands as the table has it", () => {
        const m = sheetMessagesIn(sheetMessages, {
            members: some({ one: "machine", other: "machines" }), unassigned: some("anyone free"), source: some("start bay"), destination: some("end bay"),
            wanted: some("promised"), actual: some("as promised"),
        });
        expect(m.unassigned()).toBe("anyone free");
        expect(m.rangeSpan({ n: 6, count: "6", kind: undefined })).toBe("6 machines");
        expect(m.noticeMembersAdded({ n: 1, count: "1" })).toBe("Added 1 machine");
        expect(m.noticeMembersRemoved({ n: 2, count: "2" })).toBe("2 machines removed");
        expect(m.halfTitle({ half: "from" })).toBe("Start bay");
        expect(m.halfLabel({ half: "to" })).toBe("end bay");
        expect(m.editorLocked({ half: "to" })).toBe("This end bay is locked — anything here is kept but flagged");
        expect(m.halfNone({ driver: "Routing", half: "from", lock: "in place" })).toBe("Routing has no start bay · in place");
        expect(m.noticeLockedHalf({ driver: "Routing" })).toBe("Routing has no end bay — kept, but flagged");
        expect(m.stripKeysLinkAdd({ single: false })).toContain("the End bay half");
        expect(m.actualTag({ tone: "on", n: 0, count: "0", unit: "d" })).toBe("as promised");
        expect(m.actualTag({ tone: "late", n: 2, count: "2", unit: "d" })).toBe("+2d");
        expect(m.detailNoWanted()).toBe("no promised date");
        expect(m.detailWanted({ text: "Fri", tag: "+2d" })).toBe("promised Fri · +2d");
        // None given: the table above says everything, a host's translation included.
        const held = sheetMessagesIn({ ...sheetMessages, unassigned: () => "offen" }, noWords);
        expect(held.unassigned()).toBe("offen");
        expect(held.halfTitle({ half: "to" })).toBe("To");
        expect(held.detailNoWanted()).toBe("no wanted date");
        expect(held.stripKeysLinkAdd({ single: false })).toContain("the To half");
    });
});
