/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo, useCallback } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { datasetGet } from '@elaraai/e3-api-client';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { variant, decodeBeast2For, type EastTypeValue } from '@elaraai/east';
import {
    StateImpl,
    SliceImpl,
    SliceApplyImpl,
    OverlayImpl,
} from '@elaraai/east-ui-components';
import type { PlatformFunction } from '@elaraai/east/internal';
import { BindPlatform } from '../platform/bind-runtime.js';
import type { QueryOverrides } from './types.js';

const defaultPlatformImplementations: PlatformFunction[] =
    [...StateImpl, ...SliceImpl, ...SliceApplyImpl, ...BindPlatform, ...OverlayImpl];

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
}

/** Fetch + decode a dataset value. Caller is responsible for size gating. */
export function useDatasetValue(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    datasetPath: string | null,
    options: UseDatasetValueOptions,
): UseQueryResult<DatasetValueResult, Error> {
    const { requestOptions, queryOverrides, enabled = true, hash, platforms, type } = options;
    const platformImpls = platforms ?? defaultPlatformImplementations;
    const reqOpts = requestOptions ?? { token: null };

    const pathParts = useMemo(() =>
        datasetPath?.split('.').filter(Boolean).map((v) => variant('field', v)) ?? [],
        [datasetPath],
    );

    return useQuery({
        queryKey: ['datasetValue', apiUrl, repo, workspace, datasetPath, hash ?? null],
        queryFn: async (): Promise<DatasetValueResult> => {
            const result = await datasetGet(apiUrl, repo, workspace!, pathParts, reqOpts);
            const t0 = performance.now();
            const decoded = decodeBeast2For(type, { platform: platformImpls })(result.data);
            const kind = (type as { type?: string })?.type ?? 'unknown';
            console.log(
                `[east-value] decode ${kind} ${(result.data.length / 1024).toFixed(1)}KB in ${(performance.now() - t0).toFixed(1)}ms (${datasetPath})`,
            );
            return { decoded, sizeBytes: result.data.length };
        },
        enabled: enabled && !!workspace && !!datasetPath && hash != null,
        ...queryOverrides,
    });
}

/** Trigger a binary download of a dataset value. */
export function useDatasetDownload(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    datasetPath: string | null,
    requestOptions?: RequestOptions,
) {
    const reqOpts = useMemo(
        () => requestOptions ?? { token: null },
        [requestOptions],
    );

    const pathParts = useMemo(() =>
        datasetPath?.split('.').filter(Boolean).map((v) => variant('field', v)) ?? [],
        [datasetPath],
    );

    return useCallback(async () => {
        if (!workspace || !datasetPath) return;
        const result = await datasetGet(apiUrl, repo, workspace, pathParts, reqOpts);
        const blob = new Blob([new Uint8Array(result.data)], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${datasetPath.replace(/\./g, '_')}.beast2`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [apiUrl, repo, workspace, datasetPath, pathParts, reqOpts]);
}
