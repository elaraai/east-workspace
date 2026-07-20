/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Renderer-side colour mode (#367) — a small, host-agnostic reader/toggler for
 * Chakra v3's class-based dark mode (the `_dark` condition keys on the `dark`
 * class on `<html>`). It lets the `<App>` shell's opt-in `themeToggle` flip the
 * mode on pure-East surfaces (the showcase / e3 `ui()` tasks) that have no host
 * theme control; embedding apps normally own the mode themselves and inject their
 * own toggle via `AppProvider barEnd`, so this stays optional.
 *
 * Promoted from the showcase's `theme-mode.ts` (the audit #362 wiring).
 */

import { useCallback, useEffect, useState } from "react";

/** The two colour modes. */
export type ColorMode = "light" | "dark";

const STORAGE_KEY = "east-ui.color-mode";

/** The mode currently stamped on `<html>` (the `dark` class). */
function currentMode(): ColorMode {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Stamps a colour mode onto `<html>`: toggles the `dark` class Chakra's `_dark`
 * condition keys on, sets `color-scheme` so native chrome follows, and persists
 * the choice.
 *
 * @param mode - The mode to apply.
 */
export function applyColorMode(mode: ColorMode): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
}

/**
 * Current colour mode + a toggle that applies and persists the flip. Re-reads the
 * mode if the `dark` class changes elsewhere (e.g. a host or a sibling toggle).
 *
 * @returns A `[mode, toggle]` tuple.
 */
export function useColorMode(): [ColorMode, () => void] {
    const [mode, setMode] = useState<ColorMode>(currentMode);

    const toggle = useCallback(() => {
        const next: ColorMode = currentMode() === "dark" ? "light" : "dark";
        applyColorMode(next);
        setMode(next);
    }, []);

    // Track external changes to the `dark` class so the icon stays in sync.
    useEffect(() => {
        if (typeof document === "undefined") return;
        const el = document.documentElement;
        const observer = new MutationObserver(() => setMode(currentMode()));
        observer.observe(el, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    return [mode, toggle];
}
