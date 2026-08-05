/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from 'react';
import { useQuery, keepPreviousData, type UseQueryResult } from '@tanstack/react-query';
import { datasetGetPage } from '@elaraai/e3-api-client';
import type { RequestOptions, DatasetPageWindow } from '@elaraai/e3-api-client';
import { variant, decodeBeast2For, type EastTypeValue } from '@elaraai/east';
import type { QueryOverrides } from './types.js';

export type { DatasetPageWindow } from '@elaraai/e3-api-client';

export interface UseDatasetPageOptions {
    requestOptions?: RequestOptions;
    queryOverrides?: QueryOverrides;
    /** Set false to skip the fetch. Defaults to true. */
    enabled?: boolean;
    /**
     * Content hash of the current dataset version — part of the query key so
     * cached pages invalidate when the underlying data changes. The fetch is
     * gated on it being non-null.
     */
    hash?: string | null;
    /** East type to decode pages against. Required. */
    type: EastTypeValue;
    /** The window to read: an element window or one writer segment. */
    window: DatasetPageWindow;
}

export interface DatasetPageResult {
    /** The decoded window — a value of the dataset's own type. */
    decoded: unknown;
    /** Total elements in the dataset (pairs for Dict datasets). */
    totalElements: number;
    /** Whether `totalElements` is exact (segment windows of Set/Dict
     *  datasets report an upper bound). */
    totalExact: boolean;
    /** Segments in the stored blob; 0 when the blob carries no index. */
    segmentCount: number;
    /** Global element offset of the window's first element. */
    offset: number;
    /** Elements actually in this page (the server may clamp the limit). */
    count: number;
}

/**
 * Fetch + decode one window of a collection (Array/Set/Dict) dataset.
 *
 * Pages are keyed by content hash and window, and the previous page is held
 * on screen while the next loads, so stepping through windows never flashes
 * the loading state.
 */
export function useDatasetPage(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    datasetPath: string | null,
    options: UseDatasetPageOptions,
): UseQueryResult<DatasetPageResult, Error> {
    const { requestOptions, queryOverrides, enabled = true, hash, type, window } = options;
    const reqOpts = requestOptions ?? { token: null };

    const pathParts = useMemo(() =>
        datasetPath?.split('.').filter(Boolean).map((v) => variant('field', v)) ?? [],
        [datasetPath],
    );
    const windowKey = 'segment' in window ? `s${window.segment}` : `${window.offset}+${window.limit}`;

    return useQuery({
        queryKey: ['datasetPage', apiUrl, repo, workspace, datasetPath, hash ?? null, windowKey],
        queryFn: async (): Promise<DatasetPageResult> => {
            const page = await datasetGetPage(apiUrl, repo, workspace!, pathParts, window, reqOpts);
            const decoded = decodeBeast2For(type)(page.data);
            return {
                decoded,
                totalElements: page.totalElements,
                totalExact: page.totalExact,
                segmentCount: page.segmentCount,
                offset: page.offset,
                count: page.count,
            };
        },
        enabled: enabled && !!workspace && !!datasetPath && hash != null,
        placeholderData: keepPreviousData,
        ...queryOverrides,
    });
}
