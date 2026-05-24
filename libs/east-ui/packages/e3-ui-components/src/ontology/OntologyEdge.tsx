/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<OntologyEdge>` — ReactFlow custom edge for the ontology editor.
 *
 * Styled against the bsys `.sch-conn` vocabulary: 1.5px `ink4` stroke with
 * dash patterns from {@link EDGE_DASH}, `ink2` 1.75px for emphasis, neutral
 * mono label pills (no pastel chips).
 *
 * @packageDocumentation
 */

import { memo, useMemo } from 'react';
import { getBezierPath, EdgeLabelRenderer, type EdgeProps, type Edge } from '@xyflow/react';
import { Box, Text, useToken } from '@chakra-ui/react';
import type { OntologyLinkKind } from './types.js';
import { EDGE_DASH } from './accents.js';

/** Data the parent passes through to the ReactFlow edge-renderer. */
export interface OntologyFlowEdgeData {
    type: OntologyLinkKind;
    label: string;
    attention: 'focused' | 'normal' | 'unfocused';
    [key: string]: unknown;
}

const STROKE_WIDTH_DEFAULT = 1.5;
const STROKE_WIDTH_EMPHASIZED = 1.75;

export const OntologyEdge = memo(({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    data,
}: EdgeProps<Edge<OntologyFlowEdgeData>>) => {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX, sourceY, sourcePosition,
        targetX, targetY, targetPosition,
    });

    // Pull raw hex values from theme so the SVG stroke gets a literal colour.
    const [strokeDefault, strokeEmphasized, brandSolid] = useToken('colors', [
        'gray.500', 'gray.800', 'brand.solid',
    ]);

    const dash = useMemo(
        () => (data ? EDGE_DASH[data.type] ?? 'none' : 'none'),
        [data],
    );
    const isFocused = data?.attention === 'focused';
    const isSelected = selected ?? false;
    const isEmphasized = isFocused || isSelected;
    // Spec `.sch-conn .edge` draws at full opacity; only the search "unfocused"
    // state dims (a feature on top of the static spec).
    const opacity = data?.attention === 'unfocused' ? 0.15 : 1;

    if (!data) {
        return <path id={id} className="react-flow__edge-path" d={edgePath} fill="none" stroke={strokeDefault} strokeWidth={STROKE_WIDTH_DEFAULT} />;
    }

    const stroke = isSelected ? brandSolid : isEmphasized ? strokeEmphasized : strokeDefault;
    const strokeWidth = isEmphasized ? STROKE_WIDTH_EMPHASIZED : STROKE_WIDTH_DEFAULT;

    return (
        <>
            {/* Wider invisible hit area for easier click target. */}
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                className="react-flow__edge-interaction"
            />
            <path
                id={id}
                className="react-flow__edge-path"
                d={edgePath}
                fill="none"
                markerEnd="url(#react-flow__arrowclosed)"
                style={{
                    opacity,
                    strokeDasharray: isEmphasized ? 'none' : (dash === 'none' ? undefined : dash),
                    stroke,
                    strokeWidth,
                }}
            />
            <EdgeLabelRenderer>
                <Box
                    position="absolute"
                    transform={`translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}
                    className="nodrag nopan"
                    pointerEvents="all"
                    opacity={data.attention === 'unfocused' ? 0.25 : 1}
                >
                    <Text
                        fontFamily="mono"
                        fontSize="2xs"
                        letterSpacing="wider"
                        px="2"
                        py="0.5"
                        bg={isSelected ? 'bg.brand.subtle' : 'bg.surface'}
                        color={isSelected ? 'brand.fg' : 'fg.muted'}
                        border="1px solid"
                        borderColor={isSelected ? 'brand.solid' : 'border.subtle'}
                        borderRadius="sm"
                        whiteSpace="nowrap"
                    >
                        {data.label}
                    </Text>
                </Box>
            </EdgeLabelRenderer>
        </>
    );
});

OntologyEdge.displayName = 'OntologyEdge';
