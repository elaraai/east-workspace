/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The size the showcase's e3 cuts a split task's pieces at (#1132), which its
 * worker plans pieces with and its query builder plans runs with — a module of
 * its own, so the e3 worker's bundle takes in nothing else.
 *
 * e3 aims each piece at a target and closes it between a quarter of that and
 * four times it (`E3_TEST_PIECE_BYTES`, read through e3-core's
 * `readTestPieceBytesFrom`). A deployment's target is 64 MiB; the showcase's
 * is 64 KiB, so its generated order history — megabytes, not gigabytes — runs
 * as a split call over about a dozen pieces, as a deployment's runs over
 * hundreds.
 *
 * @packageDocumentation
 */

/** The piece size the showcase's e3 aims at, in stored bytes: 64 KiB. */
export const SHOWCASE_PIECE_TARGET = 64 * 1024;

/**
 * The smallest piece the showcase's e3 cuts, in stored bytes: a quarter of its
 * target, 16 KiB. The query builder runs a query over a dataset that weighs
 * more as a split call, as it runs one over a dataset of more than e3's
 * smallest piece anywhere.
 */
export const SHOWCASE_PIECE_MIN = SHOWCASE_PIECE_TARGET / 4;
