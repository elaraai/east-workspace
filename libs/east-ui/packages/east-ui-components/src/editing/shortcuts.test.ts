/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The history shortcuts (#988) are one reading of a key press, the same on
 * every editable collection, and a builder's frame hears them anywhere but a
 * field typed into (#1185). A key that is an input method's — one pressed
 * while it composes, or the one that ends its composition — is no key of a
 * handler's (#1758).
 */

import { expect, test } from "vitest";
import { composingKey, historyShortcut, typedInto, type HistoryKeyPress } from "./shortcuts.js";

function press(key: string, held: Partial<Omit<HistoryKeyPress, "key">> = {}): HistoryKeyPress {
    return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...held };
}

test("Ctrl or ⌘ with Z undoes; with Shift, or with Y, it redoes", () => {
    expect(historyShortcut(press("z", { ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(press("z", { metaKey: true }))).toBe("undo");
    // Shift makes the key read "Z".
    expect(historyShortcut(press("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(press("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(press("y", { ctrlKey: true }))).toBe("redo");
    expect(historyShortcut(press("y", { metaKey: true }))).toBe("redo");
});

test("a press without Ctrl or ⌘, with Alt held, or on another key is not a history key", () => {
    expect(historyShortcut(press("z"))).toBeUndefined();
    expect(historyShortcut(press("z", { shiftKey: true }))).toBeUndefined();
    expect(historyShortcut(press("z", { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(historyShortcut(press("y", { metaKey: true, altKey: true }))).toBeUndefined();
    expect(historyShortcut(press("x", { ctrlKey: true }))).toBeUndefined();
});

test("a press typed into a field — text, a number, a text area, a select, editable content — is the field's; on a button, a checkbox or anything else, the collection's (#1185)", () => {
    const input = (type: string) => Object.assign(document.createElement("input"), { type });
    // jsdom has no content editing: the browser's flag stands in.
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    for (const typed of [input("text"), input("search"), input("number"), document.createElement("textarea"), document.createElement("select"), editable]) {
        expect(typedInto(typed)).toBe(true);
    }
    for (const pressed of [input("checkbox"), input("radio"), input("range"), document.createElement("button"), document.createElement("div"), null]) {
        expect(typedInto(pressed)).toBe(false);
    }
});

test("a key is an input method's while it composes, and as it ends its composition — Safari's Enter or Esc, sent after the composition's end as key 229 — on a DOM event or React's (#1758)", () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { key: "Enter", ...init });
    expect(composingKey(key({}))).toBe(false);
    expect(composingKey(key({ isComposing: true }))).toBe(true);
    // WebKit ends the composition first: the key that ended it arrives not composing, as key 229.
    expect(composingKey(key({ keyCode: 229 }))).toBe(true);
    expect(composingKey(key({ keyCode: 13 }))).toBe(false);
    // React's event holds the DOM's.
    expect(composingKey({ keyCode: 13, nativeEvent: key({ keyCode: 229 }) })).toBe(true);
    expect(composingKey({ keyCode: 13, nativeEvent: key({ keyCode: 13 }) })).toBe(false);
});
