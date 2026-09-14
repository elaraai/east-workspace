/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Store-lifetime Sheet request records, independent of rendered state keys. @packageDocumentation */
import { BlobType, East, NullType, OptionType, StringType } from "@elaraai/east";

/**
 * Internal persistence for the inline adapter's idempotency ledger. Unlike
 * reactive state, this ledger must survive a Sheet disappearing from a render.
 * The browser implementation scopes it to the current UI store's lifetime.
 * @internal
 */
export const SheetRequestStore = {
    read: East.platform("sheet_requests_read", [StringType], OptionType(BlobType), { optional: true }),
    write: East.platform("sheet_requests_write", [StringType, BlobType], NullType, { optional: true }),
} as const;
