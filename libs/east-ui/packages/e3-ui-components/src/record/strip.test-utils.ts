/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Record's tests read of its strip (`strip.tsx`), shared by each
 * suite that reads it: the words it shows for the cell under the pointer, or
 * the ring's.
 *
 * @packageDocumentation
 */

/**
 * The Record's strip as it reads — its label, its words and its keys — or `undefined` where it draws the Sheet's, or none.
 *
 * @param container - The page the Record is mounted in
 * @returns The strip's label, text and keys, each as it shows them
 */
export function stripSays(container: HTMLElement): string[] | undefined {
    const strip = container.querySelector<HTMLElement>("[data-record] [data-record-strip]");
    if (strip === null) return undefined;
    return ["stripLabel", "stripText", "stripKeys"].map((name) => strip.querySelector(`[data-slot="${name}"]`)?.textContent ?? "");
}
