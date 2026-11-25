/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A press on a part's own room (`own-room.ts`): a row's words and its empty
 * room are the row's; a button, a tab, a field, a link and a menu's item in it
 * — or anything inside one, and every other element or role that takes a
 * press — press themselves; what a portal draws is never on the row; and the
 * end of a drag that selected the row's words, or of a selection extended into
 * them, presses nothing. A part inside a button presses itself as a part does: only what
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

    test("every element and role that takes a press presses itself: a role's button, link, checkbox, switch, radio, option and menu choices, a label, a summary and what is typed into", () => {
        document.body.innerHTML = `
            <div id="part">
                <div role="button" id="role-button"><span id="in-role-button">Chip</span></div>
                <span role="link" id="role-link">more</span>
                <span role="checkbox" id="role-checkbox"></span>
                <span role="switch" id="role-switch"></span>
                <span role="radio" id="role-radio"></span>
                <div role="option" id="role-option">One</div>
                <div role="menuitemcheckbox" id="role-menu-check">Show</div>
                <div role="menuitemradio" id="role-menu-radio">Day</div>
                <label id="label"><span id="in-label">Name</span></label>
                <details><summary id="summary">More</summary></details>
                <div contenteditable="true" id="typed-into"><span id="in-typed-into">text</span></div>
                <div contenteditable="false" id="fixed">fixed</div>
            </div>`;
        const part = at("part")!;
        const own = ["role-button", "in-role-button", "role-link", "role-checkbox", "role-switch", "role-radio", "role-option", "role-menu-check", "role-menu-radio",
            "label", "in-label", "summary", "typed-into", "in-typed-into"];
        for (const id of own) expect(pressedOwnRoom(part, at(id)), id).toBe(false);
        expect(pressedOwnRoom(part, at("fixed"))).toBe(true);
    });

    test("a selection extended into the part presses nothing: anchored outside it, ending in its words", () => {
        const part = row();
        document.getSelection()!.setBaseAndExtent(at("portalled")!.firstChild!, 0, at("words")!.firstChild!, 3);
        expect(pressedOwnRoom(part, at("words"))).toBe(false);
    });

    test("a part inside a button: only what takes a press within the part counts", () => {
        document.body.innerHTML = `<button id="outer"><div id="part"><span id="words">Library</span></div></button>`;
        expect(pressedOwnRoom(at("part")!, at("words"))).toBe(true);
    });
});
