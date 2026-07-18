/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tracks the Chakra v3 class-based colour mode (`dark` on `<html>`) so
 * non-Chakra chrome can follow it. React Flow themes its own canvas chrome
 * (node wrapper, MiniMap, Controls, edges) through `--xy-*` CSS variables
 * keyed on its `colorMode` prop — Chakra's `.dark` scope alone doesn't reach
 * them (#362).
 */

import { useEffect, useState } from 'react';

/** Whether the document is currently in dark mode; live across toggles. */
export function useIsDarkMode(): boolean {
    const [dark, setDark] = useState<boolean>(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
    useEffect(() => {
        const el = document.documentElement;
        const update = () => setDark(el.classList.contains('dark'));
        update();
        const observer = new MutationObserver(update);
        observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    return dark;
}
