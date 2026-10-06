/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { datasetGet } from '@elaraai/e3-api-client';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { variant, decodeBeast2For, type EastTypeValue } from '@elaraai/east';
import {
    StateImpl,
    SliceImpl,
    SliceApplyImpl,
    OverlayImpl,
    ClipboardImpl,
    DownloadImpl,
    ShareImpl,
} from '@elaraai/east-ui-components';
import type { PlatformFunction } from '@elaraai/east/internal';
import { BindPlatform } from '../platform/bind-runtime.js';
import { PagedPlatform } from '../platform/paged-runtime.js';
import { FuncPlatform } from '../platform/func-runtime.js';
import { RecordPlatform } from '../platform/record-runtime.js';
import { DecisionBindPlatform } from '../decision/handle-runtime.js';
import type { QueryOverrides } from './types.js';

// Fallback platform set (used when a caller doesn't pass `platforms`). It must include EVERY browser-local impl
// from east-ui-components + e3-ui-components, plus the UNSCOPED global data/func/record binds — so a ui() value
// decoded through this path never throws "Platform function 'X' is not available" (see east-contribute
// "Common traps"). UITaskPreview passes a manifest-scoped set instead; this is the unscoped fallback.
const defaultPlatformImplementations: PlatformFunction[] =
    [
        ...StateImpl, ...SliceImpl, ...SliceApplyImpl, ...OverlayImpl,
        ...ClipboardImpl, ...DownloadImpl, ...ShareImpl, ...DecisionBindPlatform,
        ...BindPlatform, ...PagedPlatform, ...FuncPlatform, ...RecordPlatform,
    ];

export interface UseDatasetValueOptions {
    requestOptions?: RequestOptions;
    queryOverrides?: QueryOverrides;
    /** Set false to skip the fetch (e.g. when oversized). Defaults to true. */
    enabled?: boolean;
    /**
     * Hash of the current dataset version. Used as part of the query key so
     * the cached value invalidates when the underlying data changes. Pass
     * `null` if not yet known — the fetch is gated on it being non-null.
     */
    hash?: string | null;
    /**
     * Platform implementations passed to `decodeBeast2For`. Closures inside
     * the decoded value (callbacks, etc) close over these. Defaults to the
     * global Data/State/Overlay impls. Pass a manifest-scoped variant for
     * per-subtree read/write validation.
     */
    platforms?: PlatformFunction[];
    /** East type to decode against. Required. */
    type: EastTypeValue;
}

export interface DatasetValueResult {
    decoded: unknown;
    sizeBytes: number;
    /** The content hash of the value read, as the response names it. */
    hash: string | null;
}

/**
 * Fetch + decode a dataset value. Caller is responsible for size gating.
 *
 * @remarks
 * The value is read as the dataset holds it now, which is not always the
 * value of the `hash` asked for: the dataset may have moved on since its
 * status named that hash. A value is cached under the hash its response names,
 * and the status is fetched again, so a reader moves to the value it got; an
 * entry that holds another hash's value is never shown as this hash's.
 */
export function useDatasetValue(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    datasetPath: string | null,
    options: UseDatasetValueOptions,
): UseQueryResult<DatasetValueResult | undefined, Error> {
    const { requestOptions, queryOverrides, enabled = true, hash, platforms, type } = options;
    const platformImpls = platforms ?? defaultPlatformImplementations;
    const reqOpts = requestOptions ?? { token: null };
    const queryClient = useQueryClient();

    const pathParts = useMemo(() =>
        datasetPath?.split('.').filter(Boolean).map((v) => variant('field', v)) ?? [],
        [datasetPath],
    );

    return useQuery({
        queryKey: ['datasetValue', apiUrl, repo, workspace, datasetPath, hash ?? null],
        queryFn: async (): Promise<DatasetValueResult> => {
            const result = await datasetGet(apiUrl, repo, workspace!, pathParts, reqOpts);
            const decoded = decodeBeast2For(type, { platform: platformImpls })(result.data);
            const value = { decoded, sizeBytes: result.data.length, hash: result.hash ?? hash ?? null };
            if (value.hash !== hash) {
                queryClient.setQueryData(['datasetValue', apiUrl, repo, workspace, datasetPath, value.hash], value);
                void queryClient.invalidateQueries({ queryKey: ['datasetStatus', apiUrl, repo, workspace, datasetPath] });
            }
            return value;
        },
        select: (value) => (value.hash === (hash ?? null) ? value : undefined),
        enabled: enabled && !!workspace && !!datasetPath && hash != null,
        ...queryOverrides,
    });
}

/**
 * Downloads a dataset's value: its beast2 bytes, which the browser saves as
 * `<path>.beast2`, the path's dots as underscores. What a preview's Download
 * does, for a host that draws Download itself (#1120).
 *
 * @param apiUrl - The e3 API's base URL
 * @param repo - The repository
 * @param workspace - The workspace
 * @param path - The dataset's dotted path, e.g. `"inputs.rows"`
 * @param requestOptions - The token, and the fetch the request goes through
 * @returns Once the browser has the file
 *
 * @example
 * ```tsx
 * <Button onClick={() => downloadDataset(apiUrl, 'default', 'main', 'tasks.report.output')}>Download</Button>
 * ```
 */
export async function downloadDataset(
    apiUrl: string,
    repo: string,
    workspace: string,
    path: string,
    requestOptions?: RequestOptions,
): Promise<void> {
    const pathParts = path.split('.').filter(Boolean).map((v) => variant('field', v));
    const result = await datasetGet(apiUrl, repo, workspace, pathParts, requestOptions ?? { token: null });
    const blob = new Blob([new Uint8Array(result.data)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${path.replace(/\./g, '_')}.beast2`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Trigger a binary download of a dataset value: {@link downloadDataset}, once the workspace and path are known. */
export function useDatasetDownload(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    datasetPath: string | null,
    requestOptions?: RequestOptions,
) {
    return useCallback(async () => {
        if (!workspace || !datasetPath) return;
        await downloadDataset(apiUrl, repo, workspace, datasetPath, requestOptions);
    }, [apiUrl, repo, workspace, datasetPath, requestOptions]);
}
