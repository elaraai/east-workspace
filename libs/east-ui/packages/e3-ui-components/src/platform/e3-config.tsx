/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<E3Provider>` — top-level React provider for e3 server identity and
 * auth.
 *
 * @remarks
 * Server identity (`apiUrl`, `repo`, `workspace`, `token`) is shared
 * across every e3-talking surface in this package — the dataset cache,
 * task-detail queries, status polls, list endpoints, etc. It therefore
 * lives in a single context here, not threaded through individual
 * stores or read out of the dataset cache as a side effect of
 * construction.
 *
 * `<E3Provider>` also owns the `<QueryClientProvider>` wrap so the
 * package's TanStack-Query-backed hooks (`useTaskDetails`,
 * `useDatasetValue`, etc.) work without callers having to mount
 * TanStack themselves.
 *
 * Mount once near the React root. Inner providers (notably
 * `<ReactiveDatasetProvider>`) read this context to construct their
 * adapters; consumers like `<UITaskPreview>` read it directly to wire
 * their own queries.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Server identity + auth for an e3 React tree.
 *
 * @property apiUrl - Base URL of the e3 API server.
 * @property repo - Repository name. Defaults to `"default"` when omitted.
 * @property workspace - Active workspace. Optional at the provider
 *  level — components that strictly require one (e.g. `<UITaskPreview>`,
 *  `Data.bind`) surface their own error if it's missing.
 * @property token - Optional bearer token for authenticated requests.
 *  May be `null` for "anonymous." Rotates freely — every call re-reads.
 */
export interface E3Config {
    apiUrl: string;
    repo?: string;
    workspace?: string;
    token?: string | null;
}

const E3ConfigContext = createContext<E3Config | null>(null);

/**
 * Props for {@link E3Provider}.
 *
 * @property children - Subtree that should see this config.
 * @property config - The {@link E3Config} to expose.
 * @property queryClient - Optional external `QueryClient`. One is
 *  created if omitted; pass an external instance to share a TanStack
 *  cache with the rest of your application.
 */
export interface E3ProviderProps {
    children: ReactNode;
    config: E3Config;
    queryClient?: QueryClient;
}

/**
 * Provide e3 server identity + auth + a TanStack-Query client to a
 * React subtree.
 *
 * @example
 * ```tsx
 * <E3Provider config={{ apiUrl: "http://localhost:3000", workspace: "prod", token }}>
 *     <ReactiveDatasetProvider>
 *         <App />
 *     </ReactiveDatasetProvider>
 * </E3Provider>
 * ```
 */
export function E3Provider({ children, config, queryClient: externalClient }: E3ProviderProps) {
    const client = useMemo(
        () => externalClient ?? new QueryClient({
            defaultOptions: { queries: { retry: 2, staleTime: 30000 } },
        }),
        [externalClient],
    );
    return (
        <E3ConfigContext.Provider value={config}>
            <QueryClientProvider client={client}>
                {children}
            </QueryClientProvider>
        </E3ConfigContext.Provider>
    );
}

/**
 * Read the active {@link E3Config}. Throws if no `<E3Provider>` is
 * mounted — every component that talks to e3 needs one.
 */
export function useE3Config(): E3Config {
    const cfg = useContext(E3ConfigContext);
    if (!cfg) {
        throw new Error(
            "useE3Config must be used within an <E3Provider>. " +
            "Mount one near your React root with apiUrl / workspace / token.",
        );
    }
    return cfg;
}

/**
 * Read the active {@link E3Config}, or `null` if no provider is
 * mounted. Use this when a component should degrade gracefully
 * (e.g. an empty state) rather than throwing.
 */
export function useE3ConfigOptional(): E3Config | null {
    return useContext(E3ConfigContext);
}
