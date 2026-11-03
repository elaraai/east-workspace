/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Esc closes a phone's view wherever the focus is. A view hears the key as it
 * bubbles from a control in it; a control that goes off as it is pressed — a
 * Clear with nothing left to clear — drops the focus on the page's body, where
 * the key never reaches the view, so it hears the document too, as a popover's
 * dismissal does. A key something in the view took first is left alone.
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from "react";

/**
 * Closes a view on an Esc from anywhere while it shows.
 *
 * @param open - Whether the view shows
 * @param onClose - Closes it
 */
export function useViewEscape(open: boolean, onClose: () => void): void {
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            close.current();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open]);
}
