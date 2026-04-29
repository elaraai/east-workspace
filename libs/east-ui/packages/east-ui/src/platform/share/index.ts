/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Share platform — invoke the OS share sheet, falling back to clipboard.
 *
 * `Share.link({ url, title?, text? })` calls `navigator.share` when
 * available; otherwise copies the URL to the clipboard so the link is at
 * least pasteable. Useful for sharing scenario URLs, audit-trail
 * permalinks, etc.
 *
 * @packageDocumentation
 */

import {
    East,
    StringType,
    NullType,
    OptionType,
    StructType,
} from "@elaraai/east";

// ============================================================================
// Share.link input type
// ============================================================================

/**
 * Input struct for `Share.link`.
 *
 * @property url - The URL to share (required)
 * @property title - Optional share-sheet title
 * @property text - Optional descriptive text (precedes the URL on most apps)
 */
export const ShareLinkInputType = StructType({
    url: StringType,
    title: OptionType(StringType),
    text: OptionType(StringType),
});

/** Type alias for `ShareLinkInputType`. */
export type ShareLinkInputType = typeof ShareLinkInputType;

// ============================================================================
// Platform call
// ============================================================================

const share_link = East.platform(
    "share_link",
    [ShareLinkInputType],
    NullType,
    { optional: true },
);

/**
 * Share platform calls.
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { Button, Share, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, ($) => {
 *     const onClick = $.const(East.function([], NullType, ($) => {
 *         $(Share.link(East.value({
 *             url: "https://app.example.com/scenarios/s1",
 *             title: variant("some", "Scenario S1"),
 *             text: variant("none", null),
 *         }, Share.Types.LinkInput)));
 *     }));
 *     return Button.Root("Share", { onClick });
 * });
 * ```
 */
export const Share = {
    /**
     * Open the OS share sheet for a URL.
     *
     * @param input - `{ url, title?, text? }`
     * @returns A platform call returning `null`
     *
     * @remarks
     * Backed by `navigator.share`. Falls back to copying the URL to the
     * clipboard via `navigator.clipboard.writeText` when the Web Share API
     * is unavailable (desktop browsers, non-secure contexts). Failures are
     * logged and swallowed.
     */
    link: share_link,
    Types: {
        /**
         * East StructType for the `Share.link` input.
         *
         * @property url - The URL to share
         * @property title - Optional share-sheet title
         * @property text - Optional descriptive text
         */
        LinkInput: ShareLinkInputType,
    },
} as const;
