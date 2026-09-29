/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The history shortcuts (#988) are one reading of a key press, the same on
 * every editable collection.
 */

import { expect, test } from "vitest";
import { historyShortcut, type HistoryKeyPress } from "./shortcuts.js";

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
