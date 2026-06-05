/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type PlatformFunction } from "@elaraai/east/internal";
import { Share } from "@elaraai/east-ui/internal";
import { registerPlatformImplementation } from "../registry.js";

interface OptionTag<T> {
    type: "some" | "none";
    value?: T;
}

interface ShareInput {
    url: string;
    title: OptionTag<string>;
    text: OptionTag<string>;
}

function unwrap<T>(opt: OptionTag<T>): T | undefined {
    return opt.type === "some" ? opt.value : undefined;
}

function shareLink(input: ShareInput): null {
    const data: ShareData = { url: input.url };
    const title = unwrap(input.title);
    const text = unwrap(input.text);
    if (title !== undefined) data.title = title;
    if (text !== undefined) data.text = text;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        navigator.share(data).catch((err: unknown) => {
            // AbortError = user dismissed the share sheet — silent.
            const isAbort = err instanceof Error && err.name === "AbortError";
            if (!isAbort) {
                console.warn("[Share.link] navigator.share failed:", err);
                fallbackCopy(input.url);
            }
        });
        return null;
    }
    fallbackCopy(input.url);
    return null;
}

function fallbackCopy(url: string): void {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).catch((err: unknown) => {
            console.warn("[Share.link] fallback clipboard write failed:", err);
        });
    }
}

export const ShareImpl: PlatformFunction[] = [
    Share.link.implement((input: unknown) => shareLink(input as ShareInput)),
];

registerPlatformImplementation(ShareImpl);
