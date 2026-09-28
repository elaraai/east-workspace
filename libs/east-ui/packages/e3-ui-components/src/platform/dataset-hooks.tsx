/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React hooks and provider for ReactiveDataset platform functions.
 *
 * @packageDocumentation
 */

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useCallback,
    useState,
    useRef,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import type { TreePath } from "@elaraai/e3-types";
import {
    ReactiveDatasetCache,
    type ReactiveDatasetCacheInterface,
    createDefaultDatasetApi,
    datasetCacheKey,
} from "./dataset-store.js";
import {
    initializeReactiveDatasetCache,
    clearReactiveDatasetCache,
    clearBindingRegistry,
} from "./bind-runtime.js";
import {
    createDefaultFunctionApi,
    initializeFunctionApi,
    clearFunctionApi,
} from "./func-runtime.js";
import {
    createDefaultPagedApi,
    initializePagedApi,
    clearPagedApi,
} from "./paged-runtime.js";
import {
    createDefaultRecordApi,
    initializeRecordApi,
    clearRecordApi,
} from "./record-runtime.js";
import { getStagedStore } from "./staged-store.js";
import { useE3Config } from "./e3-config.js";

// =============================================================================
// Context
// =============================================================================

const ReactiveDatasetCacheContext = createContext<ReactiveDatasetCacheInterface | null>(null);

/**
 * Props for {@link ReactiveDatasetProvider}.
 *
 * @property children - Subtree that should see the dataset cache.
 */
export interface ReactiveDatasetProviderProps {
    children: ReactNode;
}

/** The cache a provider installed, and the server identity it was built for. */
interface InstalledCache {
    readonly apiUrl: string;
    readonly repo: string;
    readonly workspace: string | undefined;
    readonly cache: ReactiveDatasetCache;
}

/**
 * Provide a {@link ReactiveDatasetCache} to the component tree.
 *
 * @remarks
 * Reads server identity from the surrounding `<E3Provider>` to build a
 * default {@link DatasetApi} adapter and a workspace-scoped cache, and installs
 * them — with the `Func.bind`, `Data.bindPaged` and `Record.bind` adapters — in
 * the process-global runtimes the East-side bindings resolve through. The
 * cache's scheduler uses `queueMicrotask`, so cache notifications never fire
 * during a React render pass.
 *
 * The children render once the provider's cache is installed, so a
 * `Data.bind`'s first read finds it; they render again from nothing when the
 * server identity changes. A provider tears down only what it installed, so
 * one replacing another — re-keyed to a new workspace — or StrictMode's
 * mount → unmount → mount never leaves the runtimes empty.
 *
 * Must be mounted inside an `<E3Provider>` (which also owns the
 * `<QueryClientProvider>` wrap that this package's TanStack hooks
 * depend on). Throws otherwise.
 *
 * @example
 * ```tsx
 * <E3Provider config={{ apiUrl: "http://localhost:3000", workspace: "prod", token }}>
 *     <ReactiveDatasetProvider>
 *         <MyComponent />
 *     </ReactiveDatasetProvider>
 * </E3Provider>
 * ```
 */
export function ReactiveDatasetProvider({
    children,
}: ReactiveDatasetProviderProps) {
    const e3 = useE3Config();
    const { apiUrl, workspace } = e3;
    const repo = e3.repo ?? "default";

    // `getToken` is a getter (not a snapshot) so token rotation in the
    // surrounding context propagates without rebuilding the cache.
    const tokenRef = useRef<string | null>(e3.token ?? null);
    tokenRef.current = e3.token ?? null;

    const [installed, setInstalled] = useState<InstalledCache | null>(null);

    // One effect owns everything the provider installs. The runtimes behind
    // Data.bind, Data.bindPaged, Func.bind and Record.bind are process-global,
    // so the effect builds the cache and each adapter, installs them, and on
    // cleanup removes only what IT installed. Built here rather than during
    // render, StrictMode's setup → cleanup → setup builds a second cache
    // instead of reviving the destroyed one, and a provider that replaces
    // another installs after the old one has torn down, not before.
    useEffect(() => {
        const getToken = (): string | null => tokenRef.current;
        const cache = new ReactiveDatasetCache(
            workspace !== undefined ? { workspace } : {},
            createDefaultDatasetApi(apiUrl, repo, getToken),
        );
        cache.setScheduler((notify) => queueMicrotask(notify));
        initializeReactiveDatasetCache(cache);
        // The function and record runtimes share the cache's workspace and
        // server identity; a record IS a dataset, so its current value is read
        // through the same cache. A paged source reads windows through its own
        // endpoints and follows its dataset through the cache's status poll.
        const functionApi = createDefaultFunctionApi(apiUrl, repo, getToken);
        const pagedApi = createDefaultPagedApi(apiUrl, repo, getToken, cache);
        const recordApi = createDefaultRecordApi(apiUrl, repo, getToken);
        if (workspace !== undefined) {
            initializeFunctionApi(functionApi, workspace);
            initializePagedApi(pagedApi, workspace);
            initializeRecordApi(recordApi, cache, workspace);
        }
        // Staged edits are kept per server and repository: one browser origin
        // can serve several, and their edits must not meet.
        const unscopeStaged = getStagedStore().setScope(JSON.stringify([apiUrl, repo]));
        setInstalled({ apiUrl, repo, workspace, cache });
        return () => {
            // Order matters: drop the queued writes BEFORE destroying the
            // cache, so a write already dequeued and mid-await never reaches a
            // workspace the user has navigated away from.
            clearReactiveDatasetCache(cache);
            clearFunctionApi(functionApi);
            clearPagedApi(pagedApi);
            clearRecordApi(recordApi);
            unscopeStaged();
            cache.destroy();
            // Drop binding-registry entries for this workspace so a long
            // session navigating across workspaces doesn't leak metadata
            // for paths it no longer consults.
            if (workspace) clearBindingRegistry(workspace);
            else clearBindingRegistry();
        };
    }, [apiUrl, repo, workspace]);

    // The installed cache, while it is the one for the current identity: a
    // render between an identity change and the new install shows nothing
    // rather than the old workspace's data.
    const cache = installed !== null
        && installed.apiUrl === apiUrl && installed.repo === repo && installed.workspace === workspace
        ? installed.cache
        : null;

    // Expose cache for debugging
    useEffect(() => {
        if (cache === null || typeof window === "undefined") return;
        (window as unknown as Record<string, unknown>).__EAST_REACTIVE_DATASET_CACHE__ = cache;
        return () => {
            delete (window as unknown as Record<string, unknown>).__EAST_REACTIVE_DATASET_CACHE__;
        };
    }, [cache]);

    if (cache === null) return null;
    return (
        <ReactiveDatasetCacheContext.Provider value={cache}>
            {children}
        </ReactiveDatasetCacheContext.Provider>
    );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access the ReactiveDatasetCache from context.
 *
 * @returns The ReactiveDatasetCache instance
 * @throws Error if used outside of a ReactiveDatasetProvider
 */
export function useReactiveDatasetCache(): ReactiveDatasetCacheInterface {
    const cache = useContext(ReactiveDatasetCacheContext);
    if (!cache) {
        throw new Error("useReactiveDatasetCache must be used within a ReactiveDatasetProvider");
    }
    return cache;
}

/**
 * Like {@link useReactiveDatasetCache} but returns `null` instead of throwing
 * when used outside a `<ReactiveDatasetProvider>`. Use this when a component
 * has a graceful fallback (e.g. accepts an explicit config prop too).
 */
export function useReactiveDatasetCacheOptional(): ReactiveDatasetCacheInterface | null {
    return useContext(ReactiveDatasetCacheContext);
}

/**
 * Hook to subscribe to reactive dataset cache changes using React 18's useSyncExternalStore.
 *
 * @returns The current snapshot version
 */
export function useReactiveDatasetCacheSubscription(): number {
    const cache = useReactiveDatasetCache();
    const subscribe = useCallback((cb: () => void) => cache.subscribe(cb), [cache]);
    const getSnapshot = useCallback(() => cache.getSnapshot(), [cache]);

    return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Hook to subscribe to a specific reactive dataset key.
 *
 * @param workspace - The workspace name
 * @param path - The dataset path
 * @returns The cached value, or undefined if not loaded
 */
export function useReactiveDatasetKey(workspace: string, path: TreePath): Uint8Array | undefined {
    const cache = useReactiveDatasetCache();
    const key = datasetCacheKey(workspace, path);

    const subscribe = useCallback(
        (cb: () => void) => cache.subscribe(key, cb),
        [cache, key]
    );
    const getSnapshot = useCallback(
        () => cache.read(workspace, path),
        [cache, workspace, path]
    );

    return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Reactive dataset to preload.
 */
export interface ReactiveDatasetToPreload {
    workspace: string;
    path: TreePath;
}

/**
 * Result of usePreloadReactiveDatasets hook.
 */
export interface PreloadReactiveDatasetsResult {
    /** True while preloading */
    loading: boolean;
    /** Error if preloading failed */
    error: Error | null;
    /** Reload all datasets */
    reload: () => void;
}

/**
 * Hook to preload reactive datasets before rendering.
 *
 * @param datasets - Array of datasets to preload
 * @returns Loading state and error
 *
 * @example
 * ```tsx
 * import { variant } from "@elaraai/east";
 *
 * function MyComponent() {
 *     const { loading, error } = usePreloadReactiveDatasets([
 *         { workspace: "production", path: [variant("field", "inputs"), variant("field", "config")] },
 *         { workspace: "production", path: [variant("field", "data")] },
 *     ]);
 *
 *     if (loading) return <Spinner />;
 *     if (error) return <ErrorMessage error={error} />;
 *
 *     return <EastComponent render={myApp} />;
 * }
 * ```
 */
export function usePreloadReactiveDatasets(datasets: ReactiveDatasetToPreload[]): PreloadReactiveDatasetsResult {
    const cache = useReactiveDatasetCacheOptional();
    const [loading, setLoading] = useState(!!cache && datasets.length > 0);
    const [error, setError] = useState<Error | null>(null);
    const [reloadTrigger, setReloadTrigger] = useState(0);

    // Create stable key for the datasets array
    const datasetsKey = useMemo(
        () => datasets.map(d => datasetCacheKey(d.workspace, d.path)).join("|"),
        [datasets]
    );

    useEffect(() => {
        if (!cache) {
            // No provider — nothing to preload. Component renders without
            // populating the cache; downstream Data.bind reads will throw.
            setLoading(false);
            setError(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);

        Promise.all(
            datasets.map(({ workspace, path }) => cache.preload(workspace, path))
        )
            .then(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cache, datasetsKey, reloadTrigger]);

    const reload = useCallback(() => {
        setReloadTrigger(t => t + 1);
    }, []);

    return { loading, error, reload };
}

/**
 * Props for the ReactiveDatasetLoader component.
 */
export interface ReactiveDatasetLoaderProps {
    /** Datasets to preload */
    datasets: ReactiveDatasetToPreload[];
    /** Children to render when loaded */
    children: ReactNode;
    /** Loading fallback */
    fallback?: ReactNode;
    /** Error render function */
    onError?: (error: Error, reload: () => void) => ReactNode;
}

/**
 * Component that preloads reactive datasets before rendering children.
 *
 * @example
 * ```tsx
 * import { variant } from "@elaraai/east";
 *
 * function App() {
 *     return (
 *         <ReactiveDatasetProvider config={{ apiUrl: "..." }}>
 *             <ReactiveDatasetLoader
 *                 datasets={[
 *                     { workspace: "production", path: [variant("field", "config")] }
 *                 ]}
 *                 fallback={<Spinner />}
 *                 onError={(err, reload) => <ErrorWithRetry error={err} onRetry={reload} />}
 *             >
 *                 <EastComponent render={myApp} />
 *             </ReactiveDatasetLoader>
 *         </ReactiveDatasetProvider>
 *     );
 * }
 * ```
 */
export function ReactiveDatasetLoader({
    datasets,
    children,
    fallback = null,
    onError,
}: ReactiveDatasetLoaderProps) {
    const { loading, error, reload } = usePreloadReactiveDatasets(datasets);

    if (loading) {
        return <>{fallback}</>;
    }

    if (error) {
        if (onError) {
            return <>{onError(error, reload)}</>;
        }
        // Default error display
        return (
            <div style={{ color: "red", padding: "16px" }}>
                <strong>Failed to load datasets:</strong> {error.message}
                <button onClick={reload} style={{ marginLeft: "8px" }}>
                    Retry
                </button>
            </div>
        );
    }

    return <>{children}</>;
}

/**
 * Hook to write to a reactive dataset from React code.
 *
 * @returns A function to write to a dataset
 *
 * @example
 * ```tsx
 * import { encodeBeast2For, IntegerType, variant } from "@elaraai/east";
 *
 * function UpdateButton() {
 *     const writeDataset = useReactiveDatasetWrite();
 *
 *     const handleUpdate = async () => {
 *         await writeDataset(
 *             "production",
 *             [variant("field", "inputs"), variant("field", "count")],
 *             encodeBeast2For(IntegerType)(42n)
 *         );
 *     };
 *
 *     return <button onClick={handleUpdate}>Update</button>;
 * }
 * ```
 */
export function useReactiveDatasetWrite(): (
    workspace: string,
    path: TreePath,
    value: Uint8Array
) => Promise<void> {
    const cache = useReactiveDatasetCache();
    return useCallback(
        (workspace: string, path: TreePath, value: Uint8Array) =>
            cache.write(workspace, path, value),
        [cache]
    );
}

/**
 * Hook to check if a reactive dataset is cached.
 *
 * @param workspace - The workspace name
 * @param path - The dataset path
 * @returns True if the dataset is cached
 */
export function useReactiveDatasetHas(workspace: string, path: TreePath): boolean {
    const cache = useReactiveDatasetCache();
    const key = datasetCacheKey(workspace, path);

    const subscribe = useCallback(
        (cb: () => void) => cache.subscribe(key, cb),
        [cache, key]
    );
    const getSnapshot = useCallback(
        () => cache.has(workspace, path),
        [cache, workspace, path]
    );

    return useSyncExternalStore(subscribe, getSnapshot);
}

