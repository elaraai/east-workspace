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

/**
 * Provide a {@link ReactiveDatasetCache} to the component tree.
 *
 * @remarks
 * Reads server identity from the surrounding `<E3Provider>` to build a
 * default {@link DatasetApi} adapter, then constructs a workspace-scoped
 * cache. Configures the cache's scheduler to use `queueMicrotask` so
 * cache notifications never fire during a React render pass.
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

    // Build the network adapter from E3 context. `getToken` is a getter
    // (not a snapshot) so token rotation in the surrounding context
    // propagates without rebuilding the cache.
    const tokenRef = useRef<string | null>(e3.token ?? null);
    tokenRef.current = e3.token ?? null;
    const api = useMemo(
        () => createDefaultDatasetApi(e3.apiUrl, e3.repo ?? "default", () => tokenRef.current),
        [e3.apiUrl, e3.repo],
    );

    const cache = useMemo(() => {
        const cfg: { workspace?: string } = {};
        if (e3.workspace !== undefined) cfg.workspace = e3.workspace;
        return new ReactiveDatasetCache(cfg, api);
    }, [api, e3.workspace]);

    // Render-time wiring: install the singleton cache + scheduler BEFORE
    // children render so the East-side `Data.bind` impl finds the cache
    // on its first read. The Data-tracker + platform implementation are
    // registered once at module-load time inside bind-runtime.ts; there
    // is nothing per-cache to register here.
    useMemo(() => {
        initializeReactiveDatasetCache(cache);
        cache.setScheduler((notify) => queueMicrotask(notify));
    }, [cache]);

    // Same wiring for `Func.bind` — the function runtime shares the
    // workspace scope and server identity with the dataset cache.
    useMemo(() => {
        if (e3.workspace !== undefined) {
            initializeFunctionApi(
                createDefaultFunctionApi(e3.apiUrl, e3.repo ?? "default", () => tokenRef.current),
                e3.workspace,
            );
        }
    }, [e3.apiUrl, e3.repo, e3.workspace]);

    // Cleanup on cache change or unmount.
    useEffect(() => {
        return () => {
            const ws = cache.getConfig().workspace;
            // Order matters: drop the queued writes BEFORE destroying
            // the cache. Otherwise a write that's already been dequeued
            // and is mid-await would fire `cache.write` against a
            // destroyed instance, leaking a network call against a
            // workspace the user has navigated away from.
            clearReactiveDatasetCache();
            clearFunctionApi();
            cache.destroy();
            // Drop binding-registry entries for this workspace so a long
            // session navigating across workspaces doesn't leak metadata
            // for paths it no longer consults.
            if (ws) clearBindingRegistry(ws);
            else clearBindingRegistry();
        };
    }, [cache]);

    // Expose cache for debugging
    useEffect(() => {
        if (typeof window !== "undefined") {
            (window as unknown as Record<string, unknown>).__EAST_REACTIVE_DATASET_CACHE__ = cache;
        }
        return () => {
            if (typeof window !== "undefined") {
                delete (window as unknown as Record<string, unknown>).__EAST_REACTIVE_DATASET_CACHE__;
            }
        };
    }, [cache]);

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

