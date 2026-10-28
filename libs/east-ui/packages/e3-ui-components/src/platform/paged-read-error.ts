/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A read of a paged source that failed (#811, #1039): what the paging runtime
 * throws when a read of a window, a total, a search or a batch whose fetch
 * failed is read — or of a source whose content could not be found — its
 * reason the message, until a read after the retry gap asks again. It has a
 * type of its own, so a reader tells a read that failed — said where its rows
 * would be, with Retry — from any other error, which it throws on.
 *
 * @packageDocumentation
 */

/**
 * What marks a {@link PagedReadError}: a symbol of the runtime's registry, so
 * the mark holds whichever copy of this module made the error.
 */
const PAGED_READ_ERROR: unique symbol = Symbol.for("@elaraai/e3-ui-components:PagedReadError");

/** A read of a paged source that failed (see the module docs). */
export class PagedReadError extends Error {
    /** Its mark, which {@link isPagedReadError} reads. */
    readonly [PAGED_READ_ERROR] = true;

    /**
     * A read that failed.
     *
     * @param message - Why it failed: the server's code and message, or the error's own
     */
    constructor(message: string) {
        super(message);
        this.name = "PagedReadError";
    }
}

/**
 * Whether what was thrown is a read of a paged source that failed
 * ({@link PagedReadError}), whichever copy of this module made it.
 *
 * @param error - What was thrown
 * @returns Whether it is a read that failed
 */
export function isPagedReadError(error: unknown): error is PagedReadError {
    return typeof error === "object" && error !== null && (error as { readonly [PAGED_READ_ERROR]?: unknown })[PAGED_READ_ERROR] === true;
}
