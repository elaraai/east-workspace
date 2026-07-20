/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Webview colour-mode wiring. Chakra v3 colour mode is class-based — the `_dark`
 * semantic-token condition matches `.dark &` — so switching theme is toggling the
 * `dark` class on `<html>` (mirrors the showcase's `theme-mode.ts`).
 *
 * The preview lives inside VS Code, so the default follows the editor: VS Code
 * stamps a `vscode-light` / `vscode-dark` / `vscode-high-contrast` class on the
 * webview `<body>`, and the preview tracks it LIVE — until the operator flips the
 * in-panel switch, which pins an explicit preference (persisted) and stops the
 * host-theme follow.
 *
 *   1. explicit operator preference (localStorage), else
 *   2. VS Code's active colour theme (the body class), else
 *   3. light.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'east-ui-extension.theme';

/** Does VS Code's host theme (the class it stamps on the webview body) read dark?
 *  Light / light-high-contrast → light; dark / dark-high-contrast → dark. */
export function vscodeThemeIsDark(): boolean {
    const c = document.body.classList;
    if (c.contains('vscode-light') || c.contains('vscode-high-contrast-light')) return false;
    return c.contains('vscode-dark') || c.contains('vscode-high-contrast');
}

/** The persisted operator override, if the switch has been used. */
function storedOverride(): ThemeMode | null {
    try {
        const v = localStorage.getItem(THEME_KEY);
        return v === 'dark' || v === 'light' ? v : null;
    } catch { return null; }
}

/** The mode the preview should start in — see the module doc for priority. */
export function resolveInitialTheme(): ThemeMode {
    return storedOverride() ?? (vscodeThemeIsDark() ? 'dark' : 'light');
}

/** Stamps the mode onto `<html>`: the `dark` class Chakra's `_dark` condition
 *  keys on, plus `color-scheme` so native chrome (scrollbars) follows. */
export function applyTheme(mode: ThemeMode): void {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.style.colorScheme = mode;
}

/** Current mode + a toggle that applies and persists the flip. Until the operator
 *  toggles once, the preview follows VS Code's active colour theme live. */
export function useThemeMode(): [ThemeMode, () => void] {
    const [mode, setMode] = useState<ThemeMode>(() =>
        document.documentElement.classList.contains('dark') ? 'dark' : 'light');

    // Follow the host theme (VS Code re-stamps the body class when the editor
    // theme changes) until the operator makes an explicit choice.
    useEffect(() => {
        const sync = () => {
            if (storedOverride() !== null) return;
            const next: ThemeMode = vscodeThemeIsDark() ? 'dark' : 'light';
            applyTheme(next);
            setMode(next);
        };
        const observer = new MutationObserver(sync);
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const toggle = useCallback(() => {
        setMode(prev => {
            const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
            return next;
        });
    }, []);

    return [mode, toggle];
}
