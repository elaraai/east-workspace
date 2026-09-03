/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Code Reference tier's language — ONE choice for every example that
 * offers it (#655). A reader who wants python wants it everywhere, so the
 * selector on each example writes a tier-wide preference, persisted for the
 * session. `?lang=python` seeds it on load (the snapshot pipeline and the
 * Playwright sweep can open a page already in python).
 *
 * A tiny external store rather than context: the doc list is virtualized,
 * rows mount and unmount as the reader scrolls, and every row must agree
 * without a provider above the virtualizer.
 */

import { useSyncExternalStore } from "react";

export type CodeLanguage = "typescript" | "python";

const KEY = "east-ui-showcase.code-language";

function isLanguage(v: unknown): v is CodeLanguage {
    return v === "typescript" || v === "python";
}

function initial(): CodeLanguage {
    try {
        const fromUrl = new URLSearchParams(window.location.search).get("lang");
        if (isLanguage(fromUrl)) return fromUrl;
        const stored = sessionStorage.getItem(KEY);
        if (isLanguage(stored)) return stored;
    } catch {
        /* no window / storage (SSR, a locked-down browser) — TypeScript */
    }
    return "typescript";
}

let current: CodeLanguage = initial();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Set the tier-wide language; every mounted selector and code block follows. */
export function setCodeLanguage(language: CodeLanguage): void {
    if (language === current) return;
    current = language;
    try {
        sessionStorage.setItem(KEY, language);
    } catch {
        /* storage unavailable — the choice still holds for this document */
    }
    for (const listener of listeners) listener();
}

/** The current tier-wide language and its setter. */
export function useCodeLanguage(): [CodeLanguage, (language: CodeLanguage) => void] {
    const language = useSyncExternalStore(subscribe, () => current, () => "typescript" as const);
    return [language, setCodeLanguage];
}
