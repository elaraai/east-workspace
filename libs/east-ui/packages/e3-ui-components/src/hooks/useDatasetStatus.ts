/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { datasetGetStatus, pollRequestOptions } from '@elaraai/e3-api-client';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { variant, type EastTypeValue } from '@elaraai/east';
import type { QueryOverrides } from './types.js';

/**
 * How often a dataset's status is polled unless asked otherwise: every half
 * minute. The status — the dataset's hash, type and size — is what a preview
 * reads its value by, so a preview follows a change within this long, which
 * a host showing a value as it changes shortens (`pollInterval`).
 */
export const DATASET_STATUS_POLL_MS = 30_000;

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
    /** How often the status is polled, in milliseconds
     *  (default {@link DATASET_STATUS_POLL_MS}) */
    pollInterval?: number;
    queryOverrides?: QueryOverrides;
}

/**
 * Lightweight status fetch — hash, type, size. No value bytes. Polled every
 * {@link DATASET_STATUS_POLL_MS} unless `options.pollInterval` says
 * otherwise, each poll one request attempt: its next poll is its retry.
 *
 * @param apiUrl - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name; nothing is read while `null`
 * @param datasetPath - The dataset's dotted path; nothing is read while `null`
 * @param options - The requests' options, the poll's interval and react-query overrides
 * @returns The query of the status
 */
export function useDatasetStatus(
    apiUrl: string,
    repo: string,
    workspace: string | null,
    datasetPath: string | null,
    options?: UseDatasetStatusOptions,
): UseQueryResult<DatasetStatus, Error> {
    const { requestOptions, pollInterval = DATASET_STATUS_POLL_MS, queryOverrides } = options ?? {};
    const reqOpts = pollRequestOptions(requestOptions ?? { token: null });

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
