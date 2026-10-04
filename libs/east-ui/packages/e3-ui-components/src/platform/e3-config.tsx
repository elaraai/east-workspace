/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<E3Provider>` — top-level React provider for e3 server identity and
 * auth.
 *
 * @remarks
 * Server identity (`apiUrl`, `repo`, `workspace`, `token`, and the `fetch`
 * requests go through) is shared
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
import type { RequestOptions } from "@elaraai/e3-api-client";
import { recoveryDelay } from "./recovery.js";

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
 * @property fetch - The `fetch` every request goes through
 *  (`RequestOptions.fetch`); the global `fetch` when omitted. A host that
 *  answers e3's API itself — e3 running in a page — gives its own. Changes
 *  freely, as the token does.
 */
export interface E3Config {
    apiUrl: string;
    repo?: string;
    workspace?: string;
    token?: string | null;
    fetch?: typeof globalThis.fetch;
}

/**
 * The request options an {@link E3Config} gives: its token, and its `fetch`
 * when it gives one.
 *
 * @remarks
 * The provider's runtimes and the previews build their requests' options
 * here, so a `fetch` the config gives reaches every request they make.
 *
 * @param config - The token and the `fetch` to send requests with
 * @returns The options for `@elaraai/e3-api-client`'s calls
 */
export function e3RequestOptions(config: {
    token?: string | null | undefined;
    fetch?: typeof globalThis.fetch | undefined;
}): RequestOptions {
    const token = config.token ?? null;
    return config.fetch === undefined ? { token } : { token, fetch: config.fetch };
}

const E3ConfigContext = createContext<E3Config | null>(null);

/**
 * Props for {@link E3Provider}.
 *
 * @property children - Subtree that should see this config.
 * @property config - The {@link E3Config} to expose.
 * @property queryClient - Optional external `QueryClient`. One is
 *  created if omitted, which tries a failed query twice more before it
 *  reports the failure, after waits drawn as a view's own tries are
 *  ({@link recoveryDelay}), so views that failed together do not try
 *  again together. Pass an external instance to share a TanStack cache
 *  with the rest of your application; its own retries apply.
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
            // TanStack counts the failures before a retry from 0.
            defaultOptions: { queries: { retry: 2, retryDelay: (failures) => recoveryDelay(failures + 1), staleTime: 30000 } },
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
