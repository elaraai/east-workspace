/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<OntologyNode>` — ReactFlow custom node for the ontology editor.
 *
 * Follows the bsys `.lib-card` box: a flat bordered `paper` card, 2px
 * radius, **no top stripe** — a 32×32 brand-tinted icon on the left and a
 * content column with the name (body 13/600) over a kind tag (mono 9.5/600
 * uppercase, kind-coloured). Optional top-right flag pill. Selected →
 * brand-tint fill + brand border. Four outlined connection handles.
 *
 * @packageDocumentation
 */

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Box, Text, VStack } from '@chakra-ui/react';
import type { ComponentType } from 'react';
import {
    FiTarget, FiBarChart, FiCheckCircle, FiSettings, FiBox,
    FiDatabase, FiShield, FiFileText, FiCpu, FiFolder, FiUser,
} from 'react-icons/fi';
import type { OntologyNodeKind } from './types.js';
import { NODE_KIND_ACCENT } from './accents.js';

const NODE_ICONS: Record<OntologyNodeKind, ComponentType<{ size?: number }>> = {
    objective:   FiTarget,
    kpi:         FiBarChart,
    decision:    FiCheckCircle,
    process:     FiSettings,
    resource:    FiBox,
    agent:       FiUser,
    data:        FiDatabase,
    policy:      FiShield,
    document:    FiFileText,
    computation: FiCpu,
    group:       FiFolder,
};

/** Data the parent passes through to the ReactFlow node-renderer. */
export interface OntologyFlowNodeData {
    name: string;
    description: string | undefined;
    type: OntologyNodeKind;
    attention: 'focused' | 'normal' | 'unfocused';
    /** Optional status pill shown top-right (e.g. a validation flag). */
    flag?: string;
    [key: string]: unknown;
}

// `.sch-handle` — 8×8 paper-filled, 1.4px ink4 outline.
const HANDLE_BASE: React.CSSProperties = {
    width: 8,
    height: 8,
    background: '#ffffff',
    border: '1.4px solid #6b8080',
    boxSizing: 'border-box',
    zIndex: 5,
};

const HANDLE_TARGET: React.CSSProperties = {
    ...HANDLE_BASE,
    width: 12,
    height: 12,
    opacity: 0.45,
};

export const OntologyNode = memo(({ data, selected }: NodeProps<Node<OntologyFlowNodeData>>) => {
    const Icon = useMemo(() => NODE_ICONS[data.type] ?? FiBox, [data.type]);
    const isGroup = data.type === 'group';
    const isFocused = data.attention === 'focused';
    const isUnfocused = data.attention === 'unfocused';
    const accent = NODE_KIND_ACCENT[data.type];

    return (
        <Box
            position="relative"
            display="grid"
            gridTemplateColumns="32px 1fr"
            gap="2"
            alignItems="center"
            bg={selected ? 'bg.brand.subtle' : 'bg.surface'}
            border="1px solid"
            borderColor={selected ? 'brand.solid' : isFocused ? 'border.strong' : 'border.subtle'}
            borderStyle={isGroup ? 'dashed' : 'solid'}
            borderRadius="sm"
            px="2.5"
            py="2"
            minW={isGroup ? '200px' : '172px'}
            maxW={isGroup ? '280px' : '240px'}
            cursor="pointer"
            transition="border-color 120ms, background 120ms, opacity 120ms"
            opacity={isUnfocused ? 0.4 : 1}
            boxShadow="sm"
            _hover={{ borderColor: 'brand.solid' }}
            fontFeatureSettings='"tnum"'
        >
            {/* Source handles — outlined ink4 circles, all four sides. */}
            <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_BASE} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_BASE} />
            <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_BASE} />
            <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_BASE} />
            {/* Target handles — larger drop-zones, low-opacity outlined. */}
            <Handle type="target" position={Position.Top}    id="top-target"    style={HANDLE_TARGET} />
            <Handle type="target" position={Position.Bottom} id="bottom-target" style={HANDLE_TARGET} />
            <Handle type="target" position={Position.Left}   id="left-target"   style={HANDLE_TARGET} />
            <Handle type="target" position={Position.Right}  id="right-target"  style={HANDLE_TARGET} />

            {/* 32×32 brand-tinted icon block (left column). */}
            <Box
                w="32px"
                h="32px"
                bg="bg.brand.subtle"
                color="brand.fg"
                borderRadius="sm"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
            >
                <Icon size={18} />
            </Box>

            {/* Content column: name over kind tag (+ optional description). */}
            <VStack gap="0.5" alignItems="stretch" minW="0">
                <Text
                    fontSize="sm"
                    fontWeight="semibold"
                    color="fg"
                    lineHeight="tight"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                >
                    {data.name}
                </Text>
                <Text
                    fontFamily="mono"
                    fontSize="2xs"
                    fontWeight="semibold"
                    letterSpacing="wider"
                    textTransform="uppercase"
                    color={accent}
                    lineHeight="tight"
                >
                    {data.type}
                </Text>
                {data.description && (
                    <Text
                        fontSize="xs"
                        color="fg.muted"
                        lineHeight="snug"
                        mt="0.5"
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                    >
                        {data.description}
                    </Text>
                )}
            </VStack>

            {/* Optional status flag pill — top-right, mono uppercase. */}
            {data.flag && (
                <Box
                    position="absolute"
                    top="1"
                    right="1.5"
                    px="1.5"
                    py="0.5"
                    bg="brand.solid"
                    color="brand.contrast"
                    borderRadius="xs"
                    fontFamily="mono"
                    fontSize="9px"
                    fontWeight="bold"
                    letterSpacing="wider"
                    textTransform="uppercase"
                    lineHeight="1.2"
                >
                    {data.flag}
                </Box>
            )}
        </Box>
    );
});

OntologyNode.displayName = 'OntologyNode';
