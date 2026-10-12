/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

export type PresetTag = "today" | "last7d" | "last30d" | "last90d" | "ytd";
export const PRESETS: ReadonlyArray<{ label: string; tag: PresetTag }> = [
    { label: "Today", tag: "today" },
    { label: "7d",    tag: "last7d" },
    { label: "30d",   tag: "last30d" },
    { label: "90d",   tag: "last90d" },
    { label: "YTD",   tag: "ytd" },
];

/** Use the same data-aware anchor for local and indexed-record date presets. */
export function presetAnchor(domain: { min: number; max: number } | undefined, now = new Date()): { anchor: Date; clamped: boolean } {
    const anchor = domain === undefined ? now : new Date(Math.max(domain.min, Math.min(domain.max, now.getTime())));
    return { anchor, clamped: anchor.getTime() !== now.getTime() };
}

/** Resolve a preset tag to the absolute window ending at `anchor` (#195):
 *  wall-clock now for live data, the data's last day when the domain sits
 *  entirely in the past (or future) — so presets always land ON the data.
 *  Days are UTC days, as East's DateTime is UTC and the slice's matcher
 *  resolves a preset the same way (#850): the window, its label and the rows
 *  it keeps never depend on the viewer's timezone. */
export function presetWindow(tag: PresetTag, anchor: Date, exclusive = false): { from: Date; to: Date } {
    // A record's half-open range must still include the anchor's millisecond.
    // Local Slice retains its existing inclusive endpoint.
    const to = new Date(anchor.getTime() + (exclusive ? 1 : 0));
    let from = new Date(anchor);
    switch (tag) {
        case "today":   from.setUTCHours(0, 0, 0, 0); break;
        case "last7d":  from.setUTCDate(from.getUTCDate() - 7); break;
        case "last30d": from.setUTCDate(from.getUTCDate() - 30); break;
        case "last90d": from.setUTCDate(from.getUTCDate() - 90); break;
        case "ytd":     from = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1)); break;
    }
    return { from, to };
}
