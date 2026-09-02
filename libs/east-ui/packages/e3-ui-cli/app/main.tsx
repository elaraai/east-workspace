/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Prebuilt browser app for `e3-ui shot`. Reads the IR payload the CLI injects
 * as `window.__E3_UI_SHOT__`, decodes it, and renders it — either a standalone
 * component via `EncodedEastFunction`, or a live e3 task via `TaskPreview` —
 * inside the Chakra + UIStore + Overlay + DragLayer provider stack the in-repo
 * snapshot harness uses.
 *
 * Readiness is signalled on `#shot-root[data-shot-status]` for the capture
 * driver: `ready` once the content has rendered (component: next frame; task:
 * once the e3-ui loading indicators clear and stay clear), or `error` when a
 * failure card is present — detected by stable hooks (`[data-east-error]` from
 * EastErrorDisplay, `[data-status="error"]` from e3-ui's StatusDisplay /
 * ErrorBoundary), never by scraping text.
 *
 * @packageDocumentation
 */

// Self-hosted brand fonts. Imported DIRECTLY from `@fontsource` rather than via
// `@elaraai/east-ui-components/fonts`: that barrel's `@fontsource` CSS imports do
// not survive a production (Rollup) bundle through the dist boundary — the woff2
// are copied but the `@font-face` rules are dropped — so the brand fonts must be
// the app's own direct dependencies. Keep these in sync with east-ui-components/src/fonts.ts.
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';
// Side-effect import: the east-ui + e3-ui platform implementations / renderers
// (registered at module load).
import '@elaraai/e3-ui-components';

import { Component, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider } from '@chakra-ui/react';
import {
    system,
    UIStore,
    UIStoreProvider,
    OverlayManagerProvider,
    DragLayerProvider,
    EncodedEastFunction,
} from '@elaraai/east-ui-components';
import { E3Provider, ReactiveDatasetProvider, TaskPreview } from '@elaraai/e3-ui-components';
import type { ShotPayload } from '../src/shot-payload.js';

/** Task-mode readiness timing. */
const TASK_READY = {
    pollMs: 100,
    /** Loading indicators must be absent for this long before declaring ready. */
    stableMs: 400,
} as const;

/** Hard-stop budget (ms) for a never-settling task — set by the CLI from the
 *  capture timeout (so it always fires before the driver's navigation timeout);
 *  falls back to 25s if the app is opened directly. */
const TASK_HARD_STOP_MS =
    (window as unknown as { __E3_UI_SHOT_DEADLINE__?: number }).__E3_UI_SHOT_DEADLINE__ ?? 25_000;

const ERROR_SELECTOR = '[data-east-error], [data-status="error"]';
const LOADING_SELECTOR = '[data-status="loading"]';

const payload = (window as unknown as { __E3_UI_SHOT__?: ShotPayload }).__E3_UI_SHOT__;
const storageKey = (window as unknown as { __E3_UI_SHOT_KEY__?: string }).__E3_UI_SHOT_KEY__ ?? 'shot';
const isTask = payload?.kind === 'task';

function setStatus(status: 'ready' | 'error', message?: string): void {
    const root = document.getElementById('shot-root');
    if (!root) return;
    root.setAttribute('data-shot-status', status);
    if (message) root.setAttribute('data-shot-error', message.slice(0, 600));
}

/** Report `error` if a failure card is present (East compile/render error, or an
 *  e3-ui task/fetch error), else `ready`. Never downgrades an already-reported
 *  error (no-payload / thrown / earlier). */
function finishStatus(): void {
    const root = document.getElementById('shot-root');
    if (root?.getAttribute('data-shot-status') === 'error') return;
    const errorCard = document.querySelector(ERROR_SELECTOR);
    if (errorCard) setStatus('error', (errorCard as HTMLElement).innerText.slice(0, 600));
    else setStatus('ready');
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Catches thrown render errors and reports them to the capture driver. */
class ShotErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
    override state = { error: null as string | null };
    static getDerivedStateFromError(err: unknown): { error: string } {
        return { error: err instanceof Error ? err.message : String(err) };
    }
    override componentDidCatch(err: unknown): void {
        setStatus('error', err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
    override render(): ReactNode {
        if (this.state.error) return <Box fontFamily="mono" color="fg.error" p="4">{this.state.error}</Box>;
        return this.props.children;
    }
}

/** Component mode: the function compiles + renders synchronously, so report one
 *  frame after commit. (Components doing async sub-loads without a Skeleton —
 *  e.g. Map tiles — should raise `--wait`; capture also waits on networkidle.) */
function ComponentReady({ children }: { children: ReactNode }): ReactNode {
    useEffect(() => {
        const id = requestAnimationFrame(finishStatus);
        return () => cancelAnimationFrame(id);
    }, []);
    return children;
}

/**
 * Task mode: the render is an async cascade (task details -> dataset preload ->
 * status -> value -> decode), staged across TWO QueryClients with `enabled`
 * gates and a 5s status refetch. Observing `isFetching()` is unreliable (it dips
 * to 0 between waves and can't see the dataset cache's private client). Instead
 * gate on the e3-ui loading indicators (`[data-status="loading"]` on every
 * StatusDisplay loading state, incl. "Loading datasets…"): declare ready only
 * once NONE are present AND that has held for `stableMs`, so a transient
 * inter-wave gap can't trigger a premature capture.
 */
function TaskReady({ children }: { children: ReactNode }): ReactNode {
    useEffect(() => {
        let done = false;
        let clearSince: number | null = null;
        const start = Date.now();
        const interval = window.setInterval(() => {
            if (done) return;
            const now = Date.now();
            const loading = document.querySelector(LOADING_SELECTOR) !== null;
            if (loading) {
                clearSince = null;
            } else {
                clearSince ??= now;
                if (now - clearSince >= TASK_READY.stableMs) {
                    done = true;
                    window.clearInterval(interval);
                    requestAnimationFrame(finishStatus);
                    return;
                }
            }
            if (now - start >= TASK_HARD_STOP_MS) {
                done = true;
                window.clearInterval(interval);
                document.getElementById('shot-root')?.setAttribute('data-shot-partial', 'true');
                console.warn(
                    `[e3-ui shot] task did not settle within ${TASK_HARD_STOP_MS}ms — capturing current state (may be incomplete).`,
                );
                requestAnimationFrame(finishStatus);
            }
        }, TASK_READY.pollMs);
        return () => window.clearInterval(interval);
    }, []);
    return children;
}

function App(): ReactNode {
    if (!payload) {
        setStatus('error', 'No payload — window.__E3_UI_SHOT__ was not injected.');
        return <Box fontFamily="mono" color="fg.error" p="4">No component payload.</Box>;
    }
    if (payload.kind === 'task') {
        // Live e3 task: fetch the already-computed output + bound datasets and
        // render via the same TaskPreview the VS Code extension uses.
        return (
            <E3Provider config={{ apiUrl: payload.apiUrl, repo: payload.repo, workspace: payload.workspace }}>
                <ReactiveDatasetProvider>
                    <TaskPreview
                        apiUrl={payload.apiUrl}
                        repo={payload.repo}
                        workspace={payload.workspace}
                        task={payload.task}
                    />
                </ReactiveDatasetProvider>
            </E3Provider>
        );
    }
    const bytes = base64ToBytes(payload.b64);
    return <EncodedEastFunction bytes={bytes} storageKey={storageKey} />;
}

// Task previews are built to fill a fixed-height parent — give the frame a
// definite height (full bleed). Components get a shrink-to-fit framed card by
// default; `--frame-width` (injected as __E3_UI_SHOT_FRAME_WIDTH__) mounts the
// frame at a DEFINITE width instead — 'full' fills the viewport — so
// width-flexible components (Schematic / Plan / Table, all `width: 100%` of
// their container) render faithfully instead of collapsing to intrinsic width.
const frameWidth =
    (window as unknown as { __E3_UI_SHOT_FRAME_WIDTH__?: string | null }).__E3_UI_SHOT_FRAME_WIDTH__ ?? null;
const componentFrameProps = frameWidth === null
    ? { display: 'inline-block' as const, minW: '320px' }
    : { display: 'block' as const, w: frameWidth === 'full' ? '100%' : frameWidth };
const frameProps = isTask
    ? { w: '100%', h: '100vh', overflow: 'hidden' as const }
    : { layerStyle: 'frame', bg: 'bg.surface', p: '6', ...componentFrameProps };

const Ready = isTask ? TaskReady : ComponentReady;

const store = new UIStore();
createRoot(document.getElementById('root')!).render(
    <ChakraProvider value={system}>
        <UIStoreProvider store={store}>
            <OverlayManagerProvider>
                <DragLayerProvider>
                    <Box id="shot-root" data-shot-status="pending" bg="bg.canvas" p={isTask ? '0' : '6'} minH="100vh">
                        <Box id="shot-frame" {...frameProps}>
                            <ShotErrorBoundary>
                                <Ready>
                                    <App />
                                </Ready>
                            </ShotErrorBoundary>
                        </Box>
                    </Box>
                </DragLayerProvider>
            </OverlayManagerProvider>
        </UIStoreProvider>
    </ChakraProvider>,
);
