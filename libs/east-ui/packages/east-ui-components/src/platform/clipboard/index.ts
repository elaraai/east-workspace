/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type PlatformFunction } from "@elaraai/east/internal";
import { Clipboard } from "@elaraai/east-ui/internal";
import { registerPlatformImplementation } from "../registry.js";

/**
 * Implementation of `Clipboard.copy` — writes the string to the system
 * clipboard via `navigator.clipboard.writeText` when available; falls
 * back to a hidden `<textarea>` + `document.execCommand("copy")` so
 * non-secure-context pages still work.
 *
 * Failures are caught + console-warned; the East call always resolves
 * with `null` so callers do not have to handle rejection.
 */
function copyToClipboard(text: string): null {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch((err: unknown) => {
            console.warn("[Clipboard.copy] navigator.clipboard.writeText failed:", err);
            fallbackCopy(text);
        });
        return null;
    }
    fallbackCopy(text);
    return null;
}

function fallbackCopy(text: string): void {
    if (typeof document === "undefined") return;
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.pointerEvents = "none";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    } catch (err) {
        console.warn("[Clipboard.copy] fallback copy failed:", err);
    }
}

export const ClipboardImpl: PlatformFunction[] = [
    Clipboard.copy.implement((text: unknown) => copyToClipboard(text as string)),
];

registerPlatformImplementation(ClipboardImpl);
