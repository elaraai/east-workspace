/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import type { keepPreviousData } from '@tanstack/react-query';
import type { DatasetStatusDetail } from '@elaraai/e3-api-client';
import type { option } from '@elaraai/east';

/**
 * Dataset preview combining status metadata with optional data.
 * When the dataset is oversized, `value` is `{ type: 'none' }`.
 * When loaded, `value` is `{ type: 'some', value: Uint8Array }`.
 */
export type DatasetPreview = DatasetStatusDetail & {
    value: option<Uint8Array>;
};

/**
 * Subset of UseQueryOptions that can be overridden by callers.
 * Excludes queryKey, queryFn, and generic data type fields to preserve type inference.
 */
export interface QueryOverrides {
    enabled?: boolean;
    refetchInterval?: number | false;
    staleTime?: number;
    gcTime?: number;
    structuralSharing?: boolean;
    refetchOnWindowFocus?: boolean | 'always';
    refetchOnMount?: boolean | 'always';
    retry?: boolean | number;
    retryDelay?: number | ((attempt: number) => number);
    /**
     * Value to show while a new query key loads. `keepPreviousData` holds the
     * previous result on screen so a key change (e.g. an edit producing a new
     * content hash) does not flash the loading state.
     */
    placeholderData?: typeof keepPreviousData;
}
