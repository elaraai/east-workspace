/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's period, written into the source of its slice named after its
 * event kind (D9, `Builder Interfaces Spec.md` §7.5): the Roster's week and the
 * Allocation's day are each their own navigation, and the source holds the
 * window they read, so the rail's count and a Save's notice read the window the
 * builder reads. A range written there by anything else is written back.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useState } from "react";
import { useSlicesReactivity } from "@elaraai/east-ui-components";
import { recordSliceWindow, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { sourcePart, type SourcesChrome } from "./visibility.js";

/**
 * Writes a builder's window into its event kind's source of the slice, and
 * back whenever the source's range moves elsewhere.
 *
 * @param chrome - The payload's slice chrome; `undefined` with no slice
 * @param source - The source's name: the event kind's slot
 * @param from - The window's start
 * @param to - The window's end, half open
 * @param refused - What the builder says when the window cannot be written, and the source gives no reason
 * @returns Why the window could not be written, if it could not
 */
export function useSourceWindow(chrome: SourcesChrome | undefined, source: string, from: Date, to: Date, refused: string): string | undefined {
    const part = sourcePart(chrome, source);
    const version = useSlicesReactivity(part === undefined ? [] : [part.key]);
    const [error, setError] = useState<string>();
    const min = from.getTime(), max = to.getTime();
    useLayoutEffect(() => {
        if (part === undefined || part.config.range.type !== "some") return;
        const held = recordSliceWindow(part);
        if (held?.kind === "datetime" && held.min === min && held.max === max) return;
        try { setRecordSliceWindow(part, min, max); setError(undefined); }
        catch (reason) { setError(reason instanceof Error ? reason.message : refused); }
        // `version` moves with the source's state: a range written there is written back.
    }, [part, min, max, version, refused]);
    return error;
}
