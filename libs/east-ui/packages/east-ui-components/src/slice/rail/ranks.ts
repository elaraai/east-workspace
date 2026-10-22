/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where the rail's items fold among a host's (#952): every step of the rail's
 * clusters folds below {@link HOST_RANK}, and a host's own items fold from it.
 * A module of its own, so the record rail reads it without the rail's
 * components.
 *
 * @packageDocumentation
 */

/** The first rank a host's own toolbar items fold at — after every step of the rail's. */
export const HOST_RANK = 10;

/**
 * The rank a record rail's summary (`12 of 69 people`) folds at: after every
 * step of the rail, so the Filters editor its fields have folded into keeps
 * the summary a click away, and before a host's own items, so a builder's
 * view controls outlast its counts (ruled 18 Oct 2026, #1340).
 */
export const SUMMARY_RANK = HOST_RANK - 1;
