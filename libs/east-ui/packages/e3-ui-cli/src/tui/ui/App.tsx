/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Ink root — one column of exactly `rows` lines, each exactly
 * `columns` cells, rendered from the store through the view router and the
 * shell chrome. Keys go to the controller; the terminal size and the
 * spinner drive re-renders.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Box, Text, useApp, useInput, useStdout, useWindowSize } from 'ink';
import { registerSuspend } from '../suspend.js';
import type { Controller } from '../controller.js';
import { breakpoint, shellLayout, type Size } from '../render/layout.js';
import type { Glyphs } from '../render/glyphs.js';
import { toneColor, type Theme } from '../render/theme.js';
import { useStore } from '../state/store.js';
import type { TuiState } from '../state/actions.js';
import { layoutOf } from '../model/index.js';
import { completionHits, headerHits, renderFrame } from './shell/chrome.js';
import { setLastFrame, type Hit } from './frame.js';
import { renderView } from './views/index.js';
import type { RepoFacts } from './views/about.js';
import { fitLine, type AboutInfo, type Line, type RenderCtx } from './lines.js';

/** The App's props. */
export interface AppProps {
    controller: Controller;
    theme: Theme;
    glyphs: Glyphs;
    version: string;
    about: AboutInfo;
    /** Repository facts for the about view. */
    facts: () => RepoFacts | null;
    /** Overrides the terminal size (frame specs). */
    size?: Size | undefined;
    /** The clock (frame specs). */
    now?: (() => number) | undefined;
}

/** One rendered row. */
function Row({ line, theme }: { line: Line; theme: Theme }): ReactElement {
    return (
        <Text wrap="truncate-end">
            {line.map((span, i) => (
                <Text
                    key={i}
                    color={toneColor(theme, span.tone ?? 'plain')}
                    bold={span.bold === true}
                    dimColor={span.dim === true}
                    inverse={span.inverse === true}
                >
                    {span.text}
                </Text>
            ))}
        </Text>
    );
}

/** Whether the state animates (the spinner ticks). */
function animating(state: TuiState): boolean {
    if (state.view.kind === 'launch') return true;
    const ws = state.view.kind === 'dashboard' || state.view.kind === 'task' || state.view.kind === 'input' ? state.view.ws : null;
    if (ws === null) return false;
    const execution = state.data.execution[ws];
    return execution?.state?.status.type === 'running' || execution?.settling === true;
}

/**
 * The application.
 *
 * @param props - The controller, theme, glyphs and version
 * @returns The frame
 */
export function App(props: AppProps): ReactElement {
    const { controller, theme, glyphs, version } = props;
    const state = useStore(s => s);
    const windowSize = useWindowSize();
    const { stdout } = useStdout();
    const size = props.size ?? windowSize;
    useEffect(() => {
        controller.setSize(size);
    }, [controller, size.columns, size.rows]);

    const [spinner, setSpinner] = useState(0);
    const spinning = animating(state);
    useEffect(() => {
        if (!spinning) return;
        const timer = setInterval(() => setSpinner(s => s + 1), 120);
        return () => clearInterval(timer);
    }, [spinning]);

    useInput((input, key) => {
        controller.onKey(input, key);
    });

    useEffect(() => {
        controller.attachStdout(stdout);
    }, [controller, stdout]);

    const { suspendTerminal } = useApp();
    useEffect(() => {
        registerSuspend((fn) => suspendTerminal(fn));
        return () => registerSuspend(null);
    }, [suspendTerminal]);

    const now = props.now !== undefined ? props.now() : Date.now();
    const lines = useMemo((): Line[] => {
        const bp = breakpoint(size);
        if (bp === 'refuse') {
            return [fitLine([{ text: `terminal too small (${size.columns}×${size.rows}) — need 60×16`, tone: 'neg', bold: true }], Math.max(1, size.columns))];
        }
        const layout = state.size.columns === size.columns && state.size.rows === size.rows ? layoutOf(state) : shellLayout(size, { commit: false, completion: 0 });
        const ctx: RenderCtx = { layout, g: glyphs, theme, now, version, spinner, about: props.about };
        const view = renderView(state, ctx, props.facts());
        const hits: Hit[] = [
            ...headerHits(state, ctx),
            ...(view.hits ?? []).map(h => ({ ...h, row: h.row + layout.bodyTop })),
            ...completionHits(state, ctx),
        ];
        setLastFrame({ layout, hits, pane: view.pane !== undefined ? { ...view.pane, top: view.pane.top + layout.bodyTop } : null });
        return renderFrame(state, ctx, view.body, view.hints);
    }, [state, size.columns, size.rows, glyphs, theme, now, version, spinner, props]);

    return (
        <Box flexDirection="column" width={size.columns} height={size.rows}>
            {lines.map((line, i) => <Row key={i} line={line} theme={theme} />)}
        </Box>
    );
}
