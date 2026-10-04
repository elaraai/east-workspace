/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<UITaskPreview>` — render an e3 task whose role is `ui`.
 *
 * Pipeline: useTaskDetails → the role's manifest → preload manifest reads →
 * register reads with workspace poller → fetch output → render decoded
 * value as a UIComponent tree, scoped to the manifest.
 *
 * The output renders when it is a UI component: its type is `UIComponentType`
 * or a subtype of it, as East's `isSubtype` judges. Any other output is never
 * read: the preview names its type in place ("This task's output is a String,
 * not a UI component"), the kiosk too. A UI component that fails to decode or
 * to render names its error.
 *
 * Workspace/apiUrl/repo come from the surrounding `<ReactiveDatasetProvider>`
 * by default; can be overridden via the `config` prop (used by `<TaskPreview>`
 * which still takes these as explicit props), whose workspace must be the one
 * the provider serves.
 *
 * Each stage that fails shows its failure, and recovers by itself for as long
 * as the preview is mounted, so a preview on a screen no one touches, such as
 * a kiosk's, goes on once the server answers again: the task's details, the
 * preload, and the output's status and value are tried again after waits that
 * back off from 1 s to 30 s, drawn at random so previews that failed together
 * try again apart. The failure shows until a try reads, never going back to
 * loading.
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
    NavImpl,
    SliceImpl,
    SliceApplyImpl,
    OverlayImpl,
    ClipboardImpl,
    DownloadImpl,
    ShareImpl,
} from '@elaraai/east-ui-components';
import { fromEastTypeValue, isPrimitiveType, isSubtype, printTypeSummary, type EastType, type ValueTypeOf } from '@elaraai/east';
import { UIComponentType } from '@elaraai/east-ui';
import type { PlatformFunction } from '@elaraai/east/internal';
import type { TreePath } from '@elaraai/e3-types';
import {
    useReactiveDatasetCacheOptional,
    usePreloadReactiveDatasets,
    type ReactiveDatasetToPreload,
} from '../platform/dataset-hooks.js';
import { e3RequestOptions, useE3ConfigOptional, type E3Config } from '../platform/e3-config.js';
import { useQueryRecovery } from '../platform/recovery.js';
import { createScopedBindPlatform } from '../platform/bind-runtime.js';
import { createScopedPagedPlatform } from '../platform/paged-runtime.js';
import { createScopedFuncPlatform } from '../platform/func-runtime.js';
import { createScopedRecordPlatform } from '../platform/record-runtime.js';
import { DecisionBindPlatform } from '../decision/handle-runtime.js';
import { useTaskDetails } from '../hooks/useTaskDetails.js';
import { useDatasetStatus } from '../hooks/useDatasetStatus.js';
import { useDatasetValue } from '../hooks/useDatasetValue.js';
import { StatusDisplay } from './StatusDisplay.js';
import { ErrorBoundary } from './ErrorBoundary.js';

export interface UITaskPreviewProps {
    /** Task name (a task whose role is `ui`). */
    task: string;
    /**
     * Override the surrounding `<E3Provider>`'s server identity, or supply one
     * where there is none. A `workspace` it names must be the one the
     * surrounding `<ReactiveDatasetProvider>` serves: `Data.bind` and
     * `Data.bindPaged` read through process-global runtimes bound to that
     * workspace, so a page previews one workspace, and a preview whose override
     * names another shows an error.
     */
    config?: E3Config;
    /**
     * Poll interval (ms) for the manifest's declared reads while what they
     * show changes: the workspace's poll backs off to 5 s once nothing has,
     * and comes back to this on a change or when the viewer acts. Default
     * 1000ms.
     */
    pollInterval?: number;
    /**
     * Chromeless mode: drop the padding + scroll wrapper so the ui output
     * (e.g. a deployed `<App>` shell that owns its own layout) fills its
     * container edge-to-edge — for host kiosk embedding. Default `false`
     * (the padded, scrollable preview wrapper).
     */
    bare?: boolean;
}

function treePathToString(path: TreePath): string {
    return path.map(p => p.value).join('.');
}

/**
 * A type as the preview names it: its kind as East names it, with its article
 * ("a String", "an Array"), a recursive type by its node's.
 */
function kindOf(type: EastType): string {
    const kind = type.type === 'Recursive' ? (type.node as EastType).type : type.type;
    return `${/^[AEIOU]/.test(kind) ? 'an' : 'a'} ${kind}`;
}

export const UITaskPreview = memo(function UITaskPreview({
    task,
    config,
    pollInterval = 1000,
    bare = false,
}: UITaskPreviewProps) {
    // Read the provider non-throwingly: the `config` prop is designed to let a
    // caller render a preview without a surrounding <E3Provider>. `config` wins;
    // fall back to the provider when present. Either source alone is sufficient.
    const e3 = useE3ConfigOptional();
    const cache = useReactiveDatasetCacheOptional();
    const apiUrl = config?.apiUrl ?? e3?.apiUrl ?? null;
    const repo = config?.repo ?? e3?.repo ?? 'default';
    const workspace = config?.workspace ?? e3?.workspace ?? null;
    const requestOptions = e3RequestOptions({
        token: config?.token ?? e3?.token ?? null,
        fetch: config?.fetch ?? e3?.fetch,
    });
    // The data bindings read the workspace the provider serves, through
    // runtimes that are process-global: an override naming another workspace
    // would render its task over this one's data.
    const bound = cache?.getConfig().workspace;
    const foreign = config?.workspace !== undefined && bound !== undefined && config.workspace !== bound;

    const detailsQuery = useTaskDetails(apiUrl ?? '', repo, workspace, task, { requestOptions });
    const detailsFailure = useQueryRecovery(detailsQuery);
    const details = detailsQuery.data;

    const manifest = useMemo(() => (details?.role.type === 'ui' ? details.role.value : null), [details]);

    const outputPath = details ? treePathToString(details.output.path) : null;

    // Preload manifest paths so Data.bind().read() never misses on first paint.
    const preloads = useMemo<ReactiveDatasetToPreload[]>(
        () => (manifest && workspace && !foreign ? manifest.paths.map(path => ({ workspace, path })) : []),
        [manifest, workspace, foreign],
    );
    const { loading: preloading, error: preloadError } = usePreloadReactiveDatasets(preloads);

    // Per-render scoped `Data.bind` impl (strict path validation against
    // the manifest). `OverlayImpl` here is the UI overlay (modal/dialog)
    // impl — unrelated to data bindings despite the name.
    const scopedPlatforms = useMemo<PlatformFunction[] | undefined>(
        () =>
            manifest
                ? [
                    // EVERY browser-local platform impl (unscoped — no manifest paths) from east-ui-components +
                    // e3-ui-components MUST be listed here, or a ui() task that uses it throws "Platform function
                    // '<x>_bind' is not available" — and only inside an e3 ui() task, so component tests miss it
                    // (see east-contribute "Common traps"). The manifest-SCOPED data/func/record binds follow.
                    ...StateImpl,
                    ...NavImpl,
                    ...SliceImpl,
                    ...SliceApplyImpl,
                    ...OverlayImpl,
                    ...ClipboardImpl,
                    ...DownloadImpl,
                    ...ShareImpl,
                    ...DecisionBindPlatform,
                    ...createScopedBindPlatform(manifest),
                    ...createScopedPagedPlatform(manifest.pages),
                    ...createScopedFuncPlatform(manifest.functions),
                    ...createScopedRecordPlatform(manifest.records),
                ]
                : undefined,
        [manifest],
    );

    // Register manifest paths with workspace poller for live updates;
    // unregister on unmount so the poller stops when nothing watches.
    useEffect(() => {
        if (!cache || !manifest || !workspace || foreign) return;
        for (const path of manifest.paths) {
            cache.setRefetchInterval(workspace, path, pollInterval);
        }
        return () => {
            for (const path of manifest.paths) {
                cache.clearRefetchInterval(workspace, path);
            }
        };
    }, [cache, manifest, workspace, pollInterval, foreign]);

    // Fetch the output value (no size gate — UI is wanted in full).
    const statusQuery = useDatasetStatus(apiUrl ?? '', repo, workspace, outputPath, { requestOptions });
    const statusFailure = useQueryRecovery(statusQuery);
    // An output that is not a UI component — its type neither UIComponentType
    // nor a subtype of it — is named, never read (#1118).
    const outputType = useMemo(() => (statusQuery.data ? fromEastTypeValue(statusQuery.data.type) : null), [statusQuery.data]);
    const notUI = outputType !== null && !isSubtype(outputType, UIComponentType) ? outputType : null;
    const valueQuery = useDatasetValue(apiUrl ?? '', repo, workspace, outputPath, {
        requestOptions,
        type: statusQuery.data?.type as never,
        hash: statusQuery.data?.hash ?? null,
        enabled: notUI === null,
        ...(scopedPlatforms && { platforms: scopedPlatforms }),
    });
    const valueFailure = useQueryRecovery(valueQuery);

    // Stable UIStore per UI tree (re-create when task changes — `task`
    // listed as a dep so a new store is allocated whenever the task
    // identity changes, even though the factory takes no arguments).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const store = useMemo(() => createUIStore(), [task]);

    if (!apiUrl) return <StatusDisplay variant="error" title="Configuration error" message="No apiUrl available — render UITaskPreview inside an <E3Provider> or pass a config prop." />;
    if (foreign) {
        return <StatusDisplay variant="error" title="Workspace mismatch" message={`config names workspace "${config?.workspace}", and the data bindings read workspace "${bound}", the one the surrounding <ReactiveDatasetProvider> serves: a page previews one workspace.`} />;
    }
    // Each stage's failure before its loading state: a query that failed has
    // no data, and would otherwise show as loading forever, and one tried
    // again shows its failure until it reads, never going back to loading.
    if (detailsFailure) return <StatusDisplay variant="error" title="Error" message={detailsFailure.message} />;
    if (detailsQuery.isLoading) return <StatusDisplay variant="loading" title="Loading task..." />;
    if (!details) return <StatusDisplay variant="info" title="No task" message={`Task "${task}" not found`} />;
    if (!manifest) return <StatusDisplay variant="error" title="Not a UI task" message={`Task "${task}" is a ${details.role.type} task`} />;
    if (preloadError) return <StatusDisplay variant="error" title="Preload failed" message={preloadError.message} />;
    if (preloading) return <StatusDisplay variant="loading" title="Loading datasets..." />;
    if (statusFailure) return <StatusDisplay variant="error" title="Error" message={statusFailure.message} />;
    if (statusQuery.isLoading || !statusQuery.data) return <StatusDisplay variant="loading" title="Loading..." />;
    if (statusQuery.data.refType !== 'value') return <StatusDisplay variant="info" title="No output yet" message="Task has not produced a value" />;
    if (notUI !== null) {
        return (
            <StatusDisplay
                variant="error"
                title="Not a UI component"
                message={`This task's output is ${kindOf(notUI)}, not a UI component`}
                {...(!isPrimitiveType(notUI) && { details: printTypeSummary(notUI) })}
            />
        );
    }
    if (valueFailure) return <StatusDisplay variant="error" title="Load failed" message={valueFailure.message} />;
    if (valueQuery.isLoading || !valueQuery.data) return <StatusDisplay variant="loading" title="Loading..." />;

    return (
        <UIStoreProvider store={store}>
            <ErrorBoundary>
                {/* bare: fill the container, no inset/scroll wrapper — the ui
                    output (typically an <App>) owns its own layout + scrolling. */}
                <Box height="100%" overflow={bare ? undefined : 'auto'} p={bare ? undefined : '4'} minH={bare ? 0 : undefined}>
                    <EastChakraComponent
                        value={valueQuery.data.decoded as ValueTypeOf<typeof UIComponentType>}
                        storageKey={outputPath ?? task}
                    />
                </Box>
            </ErrorBoundary>
        </UIStoreProvider>
    );
});
