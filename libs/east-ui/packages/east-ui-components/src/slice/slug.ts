/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slugify `name` into a cohort id that is unique against `existing`.
 *
 * Lowercases the name and collapses every run of non-alphanumeric characters to
 * a single hyphen (trimming leading/trailing ones), falling back to `"cohort"`
 * for an all-symbol name. If that base slug is already taken it appends the
 * lowest free numeric suffix (`-2`, `-3`, …).
 *
 * Shared by both cohort-authoring surfaces — `Slice.Cohort`'s "New cohort" and
 * `Slice.Filter`'s "Save as cohort" — so they derive ids identically: a
 * collision would otherwise make the `Slice.bind` `defineCohort` primitive throw
 * (its contract errors on a duplicate id).
 *
 * @param name - the human-entered cohort name
 * @param existing - the cohort ids already defined on the slice
 * @returns a slug guaranteed not to appear in `existing`
 */
export function uniqueSlug(name: string, existing: ReadonlyArray<string>): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cohort";
    const ids = new Set(existing);
    if (!ids.has(base)) return base;
    let n = 2;
    while (ids.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}
