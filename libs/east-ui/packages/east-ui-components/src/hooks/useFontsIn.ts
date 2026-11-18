/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useState } from "react";

/**
 * A count that rises once the page's fonts have arrived, so what measured
 * text before them — a Table's or a Matrix's columns, sized to their content
 * — measures it again in the faces the page draws.
 *
 * @param active - Whether anything is measured; while it is not, it waits for nothing
 * @returns The count: a dependency of the memo that measures
 */
export function useFontsIn(active: boolean): number {
    const [fontsIn, setFontsIn] = useState(0);
    useEffect(() => {
        if (!active) return undefined;
        let live = true;
        void document.fonts?.ready.then(() => { if (live) setFontsIn(n => n + 1); });
        return () => { live = false; };
    }, [active]);
    return fontsIn;
}
