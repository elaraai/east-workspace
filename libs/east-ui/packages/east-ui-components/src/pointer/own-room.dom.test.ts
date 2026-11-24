/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A press on a part's own room (`own-room.ts`): a row's words and its empty
 * room are the row's; a button, a tab, a field, a link and a menu's item in it
 * — or anything inside one — press themselves; what a portal draws is never on
 * the row; and the end of a drag that selected the row's words presses
 * nothing. A part inside a button presses itself as a part does: only what
 * takes a press within it counts.
 */

import { afterEach, describe, expect, test } from "vitest";
import { pressedOwnRoom } from "./own-room.js";

afterEach(() => {
    document.body.innerHTML = "";
    document.getSelection()?.removeAllRanges();
});

/** A row: its words, a control, a tab, a field, a link and a menu item, each with something inside it. */
function row(): HTMLElement {
    document.body.innerHTML = `
        <div id="row">
            <span id="words">Library</span>
            <button id="control"><svg id="glyph"></svg></button>
            <span role="tab" id="tab"><span id="tab-label">Rows</span></span>
            <input id="field" />
            <a href="#x" id="link">more</a>
            <div role="menuitem" id="item">Columns</div>
        </div>
        <div id="portal"><span id="portalled">Columns</span></div>`;
    return document.getElementById("row")!;
}
const at = (id: string) => document.getElementById(id);

describe("a press on a part's own room", () => {
    test("its words and its own room are the part's", () => {
        const part = row();
        expect(pressedOwnRoom(part, part)).toBe(true);
        expect(pressedOwnRoom(part, at("words"))).toBe(true);
    });

    test("what takes a press of its own presses itself, whatever inside it is pressed", () => {
        const part = row();
        for (const id of ["control", "glyph", "tab", "tab-label", "field", "link", "item"]) expect(pressedOwnRoom(part, at(id)), id).toBe(false);
    });

    test("what a portal draws, and what is no element, is never the part's", () => {
        const part = row();
        expect(pressedOwnRoom(part, at("portalled"))).toBe(false);
        expect(pressedOwnRoom(part, null)).toBe(false);
        expect(pressedOwnRoom(part, window)).toBe(false);
    });

    test("the end of a drag that selected the part's words presses nothing; a selection elsewhere leaves it be", () => {
        const part = row();
        const range = document.createRange();
        range.selectNodeContents(at("words")!);
        document.getSelection()!.addRange(range);
        expect(pressedOwnRoom(part, at("words"))).toBe(false);
        document.getSelection()!.removeAllRanges();
        range.selectNodeContents(at("portalled")!);
        document.getSelection()!.addRange(range);
        expect(pressedOwnRoom(part, at("words"))).toBe(true);
    });

    test("a part inside a button: only what takes a press within the part counts", () => {
        document.body.innerHTML = `<button id="outer"><div id="part"><span id="words">Library</span></div></button>`;
        expect(pressedOwnRoom(at("part")!, at("words"))).toBe(true);
    });
});
