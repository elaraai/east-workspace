/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's names for the shared editing session (`src/editing/`, #879) —
 * the session, its entry versions and its binding, over the Sheet's wire rows.
 *
 * @packageDocumentation
 */
import { EditSession, type EditSessionBinding, type EntryUpdate as SharedEntryUpdate, type EntryVersion as SharedEntryVersion } from "../../editing/session.js";
import type { SheetRowValue } from "./values.js";

export type { Placement, Origin } from "../../editing/session.js";

/** One entry's version on a sheet — its draft, its wire row and its place. */
export type EntryVersion = SharedEntryVersion<SheetRowValue>;
/** One entry a sheet gesture changed. */
export type EntryUpdate = SharedEntryUpdate<SheetRowValue>;
/** What a sheet's editing session is bound to. */
export type SheetTransactionBinding = EditSessionBinding<SheetRowValue>;
/** A sheet's editing session — the shared session over its wire rows. */
export type SheetTransactions = EditSession<SheetRowValue>;
/** Constructs a sheet's editing session. */
export const SheetTransactions: new (binding: SheetTransactionBinding) => SheetTransactions = EditSession;
