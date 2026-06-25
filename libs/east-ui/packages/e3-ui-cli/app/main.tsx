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
 * driver: `ready` once the content has actually rendered (component: next
 * frame; task: once all e3 fetches settle), or `error` when an East
 * compile/render failure is present (detected by the stable `[data-east-error]`
 * hook, not by title text) or a thrown error is caught.
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
import { QueryClient } from '@tanstack/react-query';
import {
    system,
    UIStore,
    UIStoreProvider,
    OverlayManagerProvider,
    DragLayerProvider,
    EncodedEastFunction,
} from '@elaraai/east-ui-components';
import { E3Provider, ReactiveDatasetProvider, TaskPreview } from '@elaraai/e3-ui-components';

type ShotPayload =
    | { kind: 'component'; b64: string }
    | { kind: 'task'; apiUrl: string; repo: string; workspace: string; task: string };

const payload = (window as unknown as { __E3_UI_SHOT__?: ShotPayload }).__E3_UI_SHOT__;
const storageKey = (window as unknown as { __E3_UI_SHOT_KEY__?: string }).__E3_UI_SHOT_KEY__ ?? 'shot';
const isTask = payload?.kind === 'task';

// One QueryClient shared with E3Provider so readiness can observe e3 fetches.
const taskQueryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 30_000 } } });

function setStatus(status: 'ready' | 'error', message?: string): void {
    const root = document.getElementById('shot-root');
    if (!root) return;
    root.setAttribute('data-shot-status', status);
    if (message) root.setAttribute('data-shot-error', message.slice(0, 600));
}

/** Report `error` if an East error card is present, else `ready`. Never
 *  downgrades an already-reported error (no-payload / thrown / earlier). */
function finishStatus(): void {
    const root = document.getElementById('shot-root');
    if (root?.getAttribute('data-shot-status') === 'error') return;
    const errorCard = document.querySelector('[data-east-error]');
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

/** Component mode: the function compiles + renders synchronously, so report
 *  one frame after commit. */
function ComponentReady({ children }: { children: ReactNode }): ReactNode {
    useEffect(() => {
        const id = requestAnimationFrame(finishStatus);
        return () => cancelAnimationFrame(id);
    }, []);
    return children;
}

/** Task mode: render is async (fetch task output + bound datasets). Report once
 *  every e3 query has started and settled — not on the first (loading) paint. */
function TaskReady({ children }: { children: ReactNode }): ReactNode {
    useEffect(() => {
        let seenFetching = false;
        let done = false;
        const start = Date.now();
        const interval = window.setInterval(() => {
            if (done) return;
            const inFlight = taskQueryClient.isFetching();
            if (inFlight > 0) seenFetching = true;
            const elapsed = Date.now() - start;
            const settled = seenFetching && inFlight === 0;     // fetches done
            const noQueries = !seenFetching && elapsed > 2_000;  // nothing to fetch (cached/empty)
            const hardStop = elapsed > 25_000;                  // give up, let capture surface state
            if (settled || noQueries || hardStop) {
                done = true;
                window.clearInterval(interval);
                requestAnimationFrame(finishStatus);
            }
        }, 100);
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
            <E3Provider
                config={{ apiUrl: payload.apiUrl, repo: payload.repo, workspace: payload.workspace }}
                queryClient={taskQueryClient}
            >
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
// definite height (full bleed). Components get a shrink-to-fit framed card.
const frameProps = isTask
    ? { w: '100%', h: '100vh', overflow: 'hidden' as const }
    : { layerStyle: 'frame', bg: 'bg.surface', p: '6', display: 'inline-block' as const, minW: '320px' };

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
