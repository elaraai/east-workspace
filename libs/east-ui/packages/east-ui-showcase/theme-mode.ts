/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Dark-mode wiring (#362). Chakra v3 colour mode is class-based — the
 * `_dark` semantic-token condition matches `.dark &` — so switching
 * theme is toggling the `dark` class on `<html>`. Initial mode, in
 * priority order:
 *
 *   1. `?theme=dark|light` — lets headless capture (the goldens `dark`
 *      project, the snapshot pipeline's `?file=` views) select the mode
 *      without UI interaction;
 *   2. the persisted operator preference (localStorage);
 *   3. light — the historical default. Deliberately no OS-preference
 *      sniffing: captures must be deterministic across machines.
 */

import { useCallback, useState } from "react";

export type ThemeMode = "light" | "dark";

const THEME_KEY = "east-ui-showcase.theme";

/** The mode the page should start in — see the module doc for priority. */
export function resolveInitialTheme(): ThemeMode {
    const q = new URLSearchParams(window.location.search).get("theme");
    if (q === "dark" || q === "light") return q;
    try { if (localStorage.getItem(THEME_KEY) === "dark") return "dark"; } catch { /* ignore */ }
    return "light";
}

/** Stamps the mode onto `<html>`: the `dark` class Chakra's `_dark`
 *  condition keys on, plus `color-scheme` so native chrome (scrollbars,
 *  form controls, canvas defaults) follows. */
export function applyTheme(mode: ThemeMode): void {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
}

/** Current mode + a toggle that applies and persists the flip. */
export function useThemeMode(): [ThemeMode, () => void] {
    const [mode, setMode] = useState<ThemeMode>(() =>
        document.documentElement.classList.contains("dark") ? "dark" : "light");
    const toggle = useCallback(() => {
        setMode(prev => {
            const next: ThemeMode = prev === "dark" ? "light" : "dark";
            applyTheme(next);
            try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
            return next;
        });
    }, []);
    return [mode, toggle];
}
