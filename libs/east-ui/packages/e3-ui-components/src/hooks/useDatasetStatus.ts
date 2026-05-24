/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { datasetGetStatus } from '@elaraai/e3-api-client';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { variant, type EastTypeValue } from '@elaraai/east';
import type { QueryOverrides } from './types.js';

export interface DatasetStatus {
    path: string;
    type: EastTypeValue;
    /** "unassigned" | "null" | "value" */
    refType: string;
    hash: string | null;
    sizeBytes: number | null;
}

export interface UseDatasetStatusOptions {
    requestOptions?: RequestOptions;
    pollInterval?: number;
    queryOverrides?: QueryOverrides;
}

/** Lightweight status fetch — hash, type, size. No value bytes. */
export function useDatasetStatus(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    datasetPath: string | null,
    options?: UseDatasetStatusOptions,
): UseQueryResult<DatasetStatus, Error> {
    const { requestOptions, pollInterval = 5000, queryOverrides } = options ?? {};
    const reqOpts = requestOptions ?? { token: null };

    const pathParts = useMemo(() =>
        datasetPath?.split('.').filter(Boolean).map((v) => variant('field', v)) ?? [],
        [datasetPath],
    );

    return useQuery({
        queryKey: ['datasetStatus', apiUrl, repo, workspace, datasetPath],
        queryFn: async (): Promise<DatasetStatus> => {
            const raw = await datasetGetStatus(apiUrl, repo, workspace!, pathParts, reqOpts);
            return {
                path: raw.path,
                type: raw.type as EastTypeValue,
                refType: raw.refType,
                hash: raw.hash?.type === 'some' ? raw.hash.value : null,
                sizeBytes: raw.size?.type === 'some' ? Number(raw.size.value) : null,
            };
        },
        enabled: !!workspace && !!datasetPath,
        refetchInterval: pollInterval,
        ...queryOverrides,
    });
}
