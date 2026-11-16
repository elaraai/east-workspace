/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Text a compressor can do little with, for the specs that fill a page past
 * e3's byte budget (test use).
 *
 * @packageDocumentation
 */
import { randomStream } from "@elaraai/east/internal";

/** The letters a line is drawn from: 64 of them, six bits each that no compressor can take away. */
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-";

/**
 * A line of `width` letters that a compressor shrinks by a quarter at most:
 * each one of 64, drawn by East's seeded stream from `seed`, so a page of such
 * lines weighs about what it holds, and every run writes the same.
 *
 * @param width - Its length
 * @param seed - Where its stream starts
 * @returns The line
 */
export function noise(width: number, seed: number): string {
    const next = randomStream(seed);
    const out: string[] = new Array(width);
    for (let i = 0; i < width; i++) out[i] = LETTERS[Math.floor(next() * LETTERS.length)]!;
    return out.join("");
}
