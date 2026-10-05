/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A preview's controls, drawn by its host (#1209): a handle the host makes
 * with {@link usePreviewControls} and gives the preview as `controls`, whose
 * methods do what the preview's own bands do, for a host that draws them in
 * its own header.
 *
 * @packageDocumentation
 */

import { useState, type RefObject } from 'react';
import type { ValueTreeControls } from '@elaraai/east-ui-components';

/** What a log view does for a host's own controls (#1209). */
export interface LogViewerControls {
    /** Goes to the search's next match, after the last its first, as the band's chevron does. */
    nextMatch(): void;
    /** Goes to the search's previous match, before the first its last, as the band's chevron does. */
    previousMatch(): void;
    /**
     * Copies the log shown, as the band's Copy does.
     *
     * @returns `true` once the log is on the clipboard, `false` when the
     *   clipboard refuses it
     */
    copy(): Promise<boolean>;
}

/**
 * What a host's header does to the preview it is given to (#1209). Each
 * method does nothing while its view is not mounted: the Output tab shows no
 * log, and a value too large to show has no tree.
 */
export interface PreviewControls {
    /** Collapses every row of the value's tree, as its Collapse all does. */
    collapseAll(): void;
    /** Expands every row of the value's tree, as its Expand all does. */
    expandAll(): void;
    /** Goes to the log search's next match, as the log's chevron does. */
    nextMatch(): void;
    /** Goes to the log search's previous match, as the log's chevron does. */
    previousMatch(): void;
    /**
     * Copies the log shown, as the log's Copy does.
     *
     * @returns `true` once the log is on the clipboard, `false` when no log
     *   is shown or the clipboard refuses it
     */
    copyLog(): Promise<boolean>;
}

/** Where a preview's tree and log view put their controls, by the handle they were given. */
interface Parts {
    tree: RefObject<ValueTreeControls | null>;
    log: RefObject<LogViewerControls | null>;
}

const partsOf = new WeakMap<PreviewControls, Parts>();

/**
 * Makes the handle a host gives a preview as `controls`, to draw the
 * preview's controls in its own header (#1209).
 *
 * @returns A handle that stays the same for the life of the component, and
 *   serves one preview at a time
 *
 * @remarks
 * It holds no query, so a header outside `<E3Provider>` can make it.
 *
 * @example
 * ```tsx
 * const controls = usePreviewControls();
 *
 * <Button onClick={controls.collapseAll}>Collapse all</Button>
 * <TaskPreview apiUrl={url} repo="default" workspace={ws} task={task}
 *     toolbar={false} controls={controls} />
 * ```
 */
export function usePreviewControls(): PreviewControls {
    const [controls] = useState(() => {
        const parts: Parts = { tree: { current: null }, log: { current: null } };
        const made: PreviewControls = {
            collapseAll: () => parts.tree.current?.collapseAll(),
            expandAll: () => parts.tree.current?.expandAll(),
            nextMatch: () => parts.log.current?.nextMatch(),
            previousMatch: () => parts.log.current?.previousMatch(),
            copyLog: () => parts.log.current?.copy() ?? Promise.resolve(false),
        };
        partsOf.set(made, parts);
        return made;
    });
    return controls;
}

/**
 * The ref a preview's value tree is given, for the controls it was given.
 *
 * @param controls - The host's handle, if it gave one
 * @returns The tree's ref, or `undefined` without a handle
 */
export function treeControlsOf(controls: PreviewControls | undefined): RefObject<ValueTreeControls | null> | undefined {
    return controls === undefined ? undefined : partsOf.get(controls)?.tree;
}

/**
 * The ref a preview's log view is given, for the controls it was given.
 *
 * @param controls - The host's handle, if it gave one
 * @returns The log view's ref, or `undefined` without a handle
 */
export function logControlsOf(controls: PreviewControls | undefined): RefObject<LogViewerControls | null> | undefined {
    return controls === undefined ? undefined : partsOf.get(controls)?.log;
}
