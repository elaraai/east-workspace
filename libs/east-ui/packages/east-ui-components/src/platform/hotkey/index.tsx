/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useEffect } from "react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Hotkey } from "@elaraai/east-ui/internal";

const hotkeyEqual = equalFor(Hotkey.Types.Hotkey);

export type HotkeyValue = ValueTypeOf<typeof Hotkey.Types.Hotkey>;

export interface EastChakraHotkeyProps {
    value: HotkeyValue;
}

/** Parse a chord string like "mod+k" / "ctrl+shift+f" against a KeyboardEvent. */
function matchesChord(e: KeyboardEvent, chord: string): boolean {
    const parts = chord.toLowerCase().split("+").map(p => p.trim());
    const wantMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("cmd");
    const wantShift = parts.includes("shift");
    const wantAlt = parts.includes("alt") || parts.includes("option");
    const key = parts[parts.length - 1];
    if (wantMod && !(e.metaKey || e.ctrlKey)) return false;
    if (!wantMod && (e.metaKey || e.ctrlKey)) return false;
    if (wantShift !== e.shiftKey) return false;
    if (wantAlt !== e.altKey) return false;
    return e.key.toLowerCase() === key;
}

/**
 * Renders an East UI Hotkey value — registers a keydown listener for
 * the chord string and fires the East callback on match. Returns
 * null (no visible UI). The listener is bound for the React mount
 * lifetime: registered on mount, removed on unmount.
 */
export const EastChakraHotkey = memo(function EastChakraHotkey({ value }: EastChakraHotkeyProps) {
    const { chord, onTrigger } = value;

    useEffect(() => {
        if (typeof document === "undefined") return;
        const handler = (e: KeyboardEvent) => {
            // Don't fire while user is typing in an input — mod+k inside
            // a text field should still open, but unmodified single-key
            // chords would otherwise capture every keystroke.
            const target = e.target as HTMLElement | null;
            const isMod = chord.toLowerCase().includes("mod") ||
                chord.toLowerCase().includes("ctrl") ||
                chord.toLowerCase().includes("cmd");
            if (!isMod && target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
                return;
            }
            if (matchesChord(e, chord)) {
                e.preventDefault();
                queueMicrotask(() => onTrigger());
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [chord, onTrigger]);

    return null;
}, (prev, next) => hotkeyEqual(prev.value, next.value));
