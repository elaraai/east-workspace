/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Each Code Reference example's language — its own choice (#655). The
 * selector on an example changes that example only; the choices persist for
 * the session so an example scrolled out of the virtualized list and back
 * keeps its language. `?lang=python` seeds every example's default on load
 * (the snapshot pipeline and the Playwright sweep can open a page in python).
 *
 * A tiny external store rather than component state: rows mount and unmount
 * as the reader scrolls, so the choice has to outlive the row.
 */

import { useCallback, useSyncExternalStore } from "react";

export type CodeLanguage = "typescript" | "python";

const KEY = "east-ui-showcase.code-language";

function isLanguage(v: unknown): v is CodeLanguage {
    return v === "typescript" || v === "python";
}

/** The default for an example with no choice of its own: `?lang=`, else TypeScript. */
const DEFAULT: CodeLanguage = (() => {
    try {
        const fromUrl = new URLSearchParams(window.location.search).get("lang");
        if (isLanguage(fromUrl)) return fromUrl;
    } catch {
        /* no window (SSR) — TypeScript */
    }
    return "typescript";
})();

function load(): Map<string, CodeLanguage> {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            return new Map(Object.entries(parsed).filter((e): e is [string, CodeLanguage] => isLanguage(e[1])));
        }
    } catch {
        /* storage unavailable or corrupt — start empty */
    }
    return new Map();
}

let choices: ReadonlyMap<string, CodeLanguage> = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The language example `id` shows. */
export function codeLanguageFor(id: string): CodeLanguage {
    return choices.get(id) ?? DEFAULT;
}

/** Set one example's language; only that example's selector and block follow. */
export function setCodeLanguageFor(id: string, language: CodeLanguage): void {
    if (codeLanguageFor(id) === language) return;
    const next = new Map(choices);
    next.set(id, language);
    choices = next;
    try {
        sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(next)));
    } catch {
        /* storage unavailable — the choice still holds for this document */
    }
    for (const listener of listeners) listener();
}

/** One example's language and its setter. */
export function useCodeLanguage(id: string): [CodeLanguage, (language: CodeLanguage) => void] {
    const language = useSyncExternalStore(subscribe, () => codeLanguageFor(id), () => "typescript" as const);
    const set = useCallback((next: CodeLanguage) => setCodeLanguageFor(id, next), [id]);
    return [language, set];
}
