/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<UITaskPreview>` — render a kind:'ui' e3 task.
 *
 * Pipeline: useTaskDetails → decode manifest → preload manifest reads →
 * register reads with workspace poller → fetch output → render decoded
 * value as a UIComponent tree, scoped to the manifest.
 *
 * Workspace/apiUrl/repo come from the surrounding `<ReactiveDatasetProvider>`
 * by default; can be overridden via the `config` prop (used by `<TaskPreview>`
 * which still takes these as explicit props).
 *
 * @packageDocumentation
 */

import { memo, useEffect, useMemo } from 'react';
import { Box } from '@chakra-ui/react';
import {
    UIStoreProvider,
    createUIStore,
    EastChakraComponent,
    StateImpl,
    SliceImpl,
    SliceApplyImpl,
    OverlayImpl,
} from '@elaraai/east-ui-components';
import { DecisionBindPlatform } from '../decision/handle-runtime.js';
import type { ValueTypeOf } from '@elaraai/east';
import type { UIComponentType } from '@elaraai/east-ui';
import type { PlatformFunction } from '@elaraai/east/internal';
import type { TreePath } from '@elaraai/e3-types';
import { decodeManifest } from '@elaraai/e3-ui/internal';
import {
    useReactiveDatasetCacheOptional,
    usePreloadReactiveDatasets,
    type ReactiveDatasetToPreload,
} from '../platform/dataset-hooks.js';
import { useE3ConfigOptional, type E3Config } from '../platform/e3-config.js';
import { createScopedBindPlatform } from '../platform/bind-runtime.js';
import { createScopedFuncPlatform } from '../platform/func-runtime.js';
import { createScopedRecordPlatform } from '../platform/record-runtime.js';
import { useTaskDetails, getTaskKind, getTaskMetadata } from '../hooks/useTaskDetails.js';
import { useDatasetStatus } from '../hooks/useDatasetStatus.js';
import { useDatasetValue } from '../hooks/useDatasetValue.js';
import { StatusDisplay } from './StatusDisplay.js';
import { ErrorBoundary } from './ErrorBoundary.js';

export interface UITaskPreviewProps {
    /** Task name (must have `kind: 'ui'`). */
    task: string;
    /**
     * Override the surrounding `<E3Provider>` config — useful when a
     * single page renders previews for multiple workspaces.
     */
    config?: E3Config;
    /**
     * Poll interval (ms) for the manifest's declared reads. Default 1000ms.
     */
    pollInterval?: number;
}

function treePathToString(path: TreePath): string {
    return path.map(p => p.value).join('.');
}

export const UITaskPreview = memo(function UITaskPreview({
    task,
    config,
    pollInterval = 1000,
}: UITaskPreviewProps) {
    // Read the provider non-throwingly: the `config` prop is designed to let a
    // caller render a preview without a surrounding <E3Provider>. `config` wins;
    // fall back to the provider when present. Either source alone is sufficient.
    const e3 = useE3ConfigOptional();
    const cache = useReactiveDatasetCacheOptional();
    const apiUrl = config?.apiUrl ?? e3?.apiUrl ?? null;
    const repo = config?.repo ?? e3?.repo ?? 'default';
    const workspace = config?.workspace ?? e3?.workspace ?? null;
    const token = config?.token ?? e3?.token ?? null;
    const requestOptions = { token };

    const detailsQuery = useTaskDetails(apiUrl ?? '', repo, workspace, task, { requestOptions });
    const details = detailsQuery.data;

    const kind = details ? getTaskKind(details) : null;
    const isUI = kind === 'ui';

    const manifest = useMemo(() => {
        if (!details || !isUI) return null;
        const meta = getTaskMetadata(details);
        return meta ? decodeManifest(meta) : { paths: [], functions: [], records: [] };
    }, [details, isUI]);

    const outputPath = details ? treePathToString(details.output as TreePath) : null;

    // Preload manifest paths so Data.bind().read() never misses on first paint.
    const preloads = useMemo<ReactiveDatasetToPreload[]>(
        () => (manifest && workspace ? manifest.paths.map(path => ({ workspace, path })) : []),
        [manifest, workspace],
    );
    const { loading: preloading, error: preloadError } = usePreloadReactiveDatasets(preloads);

    // Per-render scoped `Data.bind` impl (strict path validation against
    // the manifest). `OverlayImpl` here is the UI overlay (modal/dialog)
    // impl — unrelated to data bindings despite the name.
    const scopedPlatforms = useMemo<PlatformFunction[] | undefined>(
        () =>
            manifest
                ? [
                    ...StateImpl,
                    ...SliceImpl,
                    ...SliceApplyImpl,
                    ...createScopedBindPlatform(manifest),
                    ...createScopedFuncPlatform(manifest.functions),
                    ...createScopedRecordPlatform(manifest.records),
                    ...DecisionBindPlatform,
                    ...OverlayImpl,
                ]
                : undefined,
        [manifest],
    );

    // Register manifest paths with workspace poller for live updates;
    // unregister on unmount so the poller stops when nothing watches.
    useEffect(() => {
        if (!cache || !manifest || !workspace) return;
        for (const path of manifest.paths) {
            cache.setRefetchInterval(workspace, path, pollInterval);
        }
        return () => {
            for (const path of manifest.paths) {
                cache.clearRefetchInterval(workspace, path);
            }
        };
    }, [cache, manifest, workspace, pollInterval]);

    // Fetch the output value (no size gate — UI is wanted in full).
    const statusQuery = useDatasetStatus(apiUrl ?? '', repo, workspace, outputPath, { requestOptions });
    const valueQuery = useDatasetValue(apiUrl ?? '', repo, workspace, outputPath, {
        requestOptions,
        type: statusQuery.data?.type as never,
        hash: statusQuery.data?.hash ?? null,
        ...(scopedPlatforms && { platforms: scopedPlatforms }),
    });

    // Stable UIStore per UI tree (re-create when task changes — `task`
    // listed as a dep so a new store is allocated whenever the task
    // identity changes, even though the factory takes no arguments).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const store = useMemo(() => createUIStore(), [task]);

    if (!apiUrl) return <StatusDisplay variant="error" title="Configuration error" message="No apiUrl available — render UITaskPreview inside an <E3Provider> or pass a config prop." />;
    if (detailsQuery.isLoading) return <StatusDisplay variant="loading" title="Loading task..." />;
    if (detailsQuery.error) return <StatusDisplay variant="error" title="Error" message={detailsQuery.error.message} />;
    if (!details) return <StatusDisplay variant="info" title="No task" message={`Task "${task}" not found`} />;
    if (!isUI) return <StatusDisplay variant="error" title="Not a UI task" message={`Task "${task}" has kind "${kind ?? '(none)'}"`} />;
    if (preloadError) return <StatusDisplay variant="error" title="Preload failed" message={preloadError.message} />;
    if (preloading) return <StatusDisplay variant="loading" title="Loading datasets..." />;
    if (statusQuery.isLoading || !statusQuery.data) return <StatusDisplay variant="loading" title="Loading..." />;
    if (statusQuery.data.refType !== 'value') return <StatusDisplay variant="info" title="No output yet" message="Task has not produced a value" />;
    if (valueQuery.isLoading || !valueQuery.data) return <StatusDisplay variant="loading" title="Loading..." />;
    if (valueQuery.error) return <StatusDisplay variant="error" title="Decode failed" message={valueQuery.error.message} />;

    return (
        <UIStoreProvider store={store}>
            <ErrorBoundary>
                <Box height="100%" overflow="auto" p="4">
                    <EastChakraComponent
                        value={valueQuery.data.decoded as ValueTypeOf<typeof UIComponentType>}
                        storageKey={outputPath ?? task}
                    />
                </Box>
            </ErrorBoundary>
        </UIStoreProvider>
    );
});
