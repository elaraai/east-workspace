/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<InputPreview>` — an input's value, editable, under a band naming the
 * input.
 *
 * A host that names the input and draws the preview's controls in its own
 * header passes `bare`, so the preview draws no band naming the input, and
 * `toolbar={false}`; it controls the key search with `search` and acts on the
 * tree through the `controls` it makes with `usePreviewControls`, which reach
 * the value's {@link DatasetPreview} (#1209).
 *
 * @packageDocumentation
 */

import { memo } from 'react';
import { Box, Text, Flex } from '@chakra-ui/react';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { DatasetPreview, type DatasetPreviewProps } from './DatasetPreview.js';

export interface InputPreviewProps {
    apiUrl: string;
    repo: string;
    workspace: string;
    path: string;
    requestOptions?: RequestOptions;
    /** No band naming the input, for a host whose frame names it, as
     *  `TaskPreview`'s `bare` drops its own (#1209). Default `false`. */
    bare?: boolean;
    /** `false` draws no band above the value: see {@link DatasetPreviewProps.toolbar}. Default `true`. */
    toolbar?: boolean;
    /** The value's key search, controlled: see {@link DatasetPreviewProps.search}. */
    search?: string;
    /** Told the text of the value's own search box: see {@link DatasetPreviewProps.onSearchChange}. */
    onSearchChange?: (search: string) => void;
    /** The handle a host's own Collapse all and Expand all act through: see {@link DatasetPreviewProps.controls}. */
    controls?: DatasetPreviewProps['controls'];
}

export const InputPreview = memo(function InputPreview({
    apiUrl,
    repo,
    workspace,
    path,
    requestOptions,
    bare = false,
    toolbar,
    search,
    onSearchChange,
    controls,
}: InputPreviewProps) {
    const displayName = path.replace(/^\.inputs\./, '');

    return (
        // `height` rather than `flex`, matching the sibling previews: the host
        // mount is not always a flex container, and a `flex` bound would then
        // silently fall back to auto height and grow with the content.
        <Box height="100%" display="flex" flexDirection="column" overflow="hidden">
            {!bare && (
                <Flex px={4} py={2} borderBottom="1px solid" borderColor="border.subtle" bg="bg.surface" align="center" justify="space-between">
                    <Text fontSize="body.lg" fontWeight="medium" color="fg">{displayName}</Text>
                </Flex>
            )}
            <Box flex={1} overflow="hidden" minHeight={0}>
                <DatasetPreview
                    apiUrl={apiUrl}
                    repo={repo}
                    workspace={workspace}
                    path={path}
                    editable
                    {...(requestOptions != null && { requestOptions })}
                    {...(toolbar !== undefined && { toolbar })}
                    {...(search !== undefined && { search })}
                    {...(onSearchChange !== undefined && { onSearchChange })}
                    {...(controls !== undefined && { controls })}
                />
            </Box>
        </Box>
    );
}, (prev, next) => prev.path === next.path && prev.workspace === next.workspace
    && prev.apiUrl === next.apiUrl && prev.repo === next.repo && prev.bare === next.bare
    // A rotated token, or another fetch, re-renders the preview, or its reads
    // keep the old one (as TaskPreview's, #959).
    && prev.requestOptions?.token === next.requestOptions?.token
    && Object.is(prev.requestOptions?.fetch, next.requestOptions?.fetch)
    // The host's controls (#1209).
    && prev.toolbar === next.toolbar && prev.search === next.search
    && Object.is(prev.onSearchChange, next.onSearchChange) && Object.is(prev.controls, next.controls));
