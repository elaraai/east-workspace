/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Box, Text, Badge } from '@chakra-ui/react';
import type { EastTypeValue } from '@elaraai/east';

export interface EastValueViewerProps {
    type: EastTypeValue;
    value: unknown;
}

// Format a primitive value for display
function formatPrimitive(type: EastTypeValue, value: unknown): string {
    switch (type.type) {
        case 'Null':
            return 'null';
        case 'Boolean':
            return value ? 'true' : 'false';
        case 'Integer':
            return String(value);
        case 'Float': {
            const num = value as number;
            if (Number.isNaN(num)) return 'NaN';
            if (!Number.isFinite(num)) return num > 0 ? 'Infinity' : '-Infinity';
            return String(num);
        }
        case 'String':
            return `"${value}"`;
        case 'DateTime':
            return (value as Date).toISOString();
        case 'Blob':
            return `Blob[${(value as Uint8Array).length} bytes]`;
        default:
            return String(value);
    }
}

// Check if a type is a primitive (renders inline without nesting)
function isPrimitive(type: EastTypeValue): boolean {
    return ['Null', 'Boolean', 'Integer', 'Float', 'String', 'DateTime', 'Blob', 'Never'].includes(type.type);
}

// Get a short type label for display
function getTypeLabel(type: EastTypeValue, value: unknown): string {
    switch (type.type) {
        case 'Array':
            return `Array[${(value as unknown[]).length}]`;
        case 'Set':
            return `Set[${(value as Set<unknown>).size}]`;
        case 'Dict':
            return `Dict[${(value as Map<unknown, unknown>).size}]`;
        case 'Struct':
            return 'Struct';
        case 'Variant':
            return `Variant.${(value as { type: string }).type}`;
        case 'Ref':
            return 'Ref';
        default:
            return type.type;
    }
}

// Single value node - handles both primitives and complex types
function ValueNode({
    type,
    value,
    label,
    depth,
}: {
    type: EastTypeValue;
    value: unknown;
    label?: string;
    depth: number;
}) {
    // Prevent infinite recursion
    if (depth > 20) {
        return (
            <Box py={0.5} display="flex" alignItems="center" gap={2}>
                {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                <Text as="span" color="fg.muted">[max depth reached]</Text>
            </Box>
        );
    }

    // Primitives render inline
    if (isPrimitive(type)) {
        return (
            <Box py={0.5} display="flex" alignItems="center" gap={2}>
                {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                <Text as="span" color={type.type === 'String' ? 'fg.success' : type.type === 'Integer' || type.type === 'Float' ? 'link' : 'fg.muted'}>
                    {formatPrimitive(type, value)}
                </Text>
                <Badge size="xs" colorPalette="gray" variant="subtle">{type.type}</Badge>
            </Box>
        );
    }

    // Complex types render as expandable nodes
    const typeLabel = getTypeLabel(type, value);

    // Array type
    if (type.type === 'Array') {
        const items = value as unknown[];
        const elementType = type.value as EastTypeValue;
        if (items.length === 0) {
            return (
                <Box py={0.5} display="flex" alignItems="center" gap={2}>
                    {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                    <Text as="span" color="fg.muted">[]</Text>
                    <Badge size="xs" colorPalette="brand" variant="subtle">Array[0]</Badge>
                </Box>
            );
        }
        return (
            <Box>
                <details>
                    <summary style={{ cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                        <Badge size="xs" colorPalette="brand" variant="subtle">{typeLabel}</Badge>
                    </summary>
                    <Box pl={4}>
                        {items.map((item, index) => (
                            <Box
                                key={index}
                                py={1}
                                borderBottom={index < items.length - 1 ? '1px solid' : undefined}
                                borderColor="border.strong"
                            >
                                <ValueNode
                                    type={elementType}
                                    value={item}
                                    label={`[${index}]`}
                                    depth={depth + 1}
                                />
                            </Box>
                        ))}
                    </Box>
                </details>
            </Box>
        );
    }

    // Struct type
    if (type.type === 'Struct') {
        const fields = type.value as Array<{ name: string; type: EastTypeValue }>;
        const obj = value as Record<string, unknown>;
        if (fields.length === 0) {
            return (
                <Box py={0.5} display="flex" alignItems="center" gap={2}>
                    {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                    <Text as="span" color="fg.muted">{'{}'}</Text>
                    <Badge size="xs" colorPalette="warning" variant="subtle">Struct</Badge>
                </Box>
            );
        }
        return (
            <Box>
                <details>
                    <summary style={{ cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                        <Badge size="xs" colorPalette="warning" variant="subtle">{typeLabel}</Badge>
                    </summary>
                    <Box pl={4}>
                        {fields.map((field) => (
                            <ValueNode
                                key={field.name}
                                type={field.type}
                                value={obj[field.name]}
                                label={field.name}
                                depth={depth + 1}
                            />
                        ))}
                    </Box>
                </details>
            </Box>
        );
    }

    // Variant type
    if (type.type === 'Variant') {
        const cases = type.value as Array<{ name: string; type: EastTypeValue }>;
        const variant = value as { type: string; value: unknown };
        const activeCase = cases.find(c => c.name === variant.type);
        if (!activeCase) {
            return (
                <Box py={0.5} display="flex" alignItems="center" gap={2}>
                    {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                    <Text as="span" color="fg.danger">Unknown variant: {variant.type}</Text>
                </Box>
            );
        }
        // If the variant value is Null, render inline
        if (activeCase.type.type === 'Null') {
            return (
                <Box py={0.5} display="flex" alignItems="center" gap={2}>
                    {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                    <Badge size="xs" colorPalette="brand" variant="subtle">.{variant.type}</Badge>
                </Box>
            );
        }
        return (
            <Box>
                <details>
                    <summary style={{ cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                        <Badge size="xs" colorPalette="brand" variant="subtle">.{variant.type}</Badge>
                    </summary>
                    <Box pl={4}>
                        <ValueNode
                            type={activeCase.type}
                            value={variant.value}
                            depth={depth + 1}
                        />
                    </Box>
                </details>
            </Box>
        );
    }

    // Dict type (Map)
    if (type.type === 'Dict') {
        const map = value as Map<unknown, unknown>;
        const keyType = (type.value as { key: EastTypeValue; value: EastTypeValue }).key;
        const valueType = (type.value as { key: EastTypeValue; value: EastTypeValue }).value;
        if (map.size === 0) {
            return (
                <Box py={0.5} display="flex" alignItems="center" gap={2}>
                    {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                    <Text as="span" color="fg.muted">{'Map{}'}</Text>
                    <Badge size="xs" colorPalette="info" variant="subtle">Dict[0]</Badge>
                </Box>
            );
        }
        const entries = Array.from(map.entries()) as [unknown, unknown][];
        return (
            <Box>
                <details>
                    <summary style={{ cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                        <Badge size="xs" colorPalette="info" variant="subtle">{typeLabel}</Badge>
                    </summary>
                    <Box pl={4}>
                        {entries.map(([k, v], i) => (
                            <Box
                                key={i}
                                py={2}
                                borderBottom={i < entries.length - 1 ? '1px solid' : undefined}
                                borderColor="border.strong"
                            >
                                <ValueNode type={keyType} value={k} depth={depth + 1} />
                                <ValueNode type={valueType} value={v} depth={depth + 1} />
                            </Box>
                        ))}
                    </Box>
                </details>
            </Box>
        );
    }

    // Set type
    if (type.type === 'Set') {
        const set = value as Set<unknown>;
        const elementType = type.value as EastTypeValue;
        if (set.size === 0) {
            return (
                <Box py={0.5} display="flex" alignItems="center" gap={2}>
                    {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                    <Text as="span" color="fg.muted">{'Set{}'}</Text>
                    <Badge size="xs" colorPalette="brand" variant="subtle">Set[0]</Badge>
                </Box>
            );
        }
        const items = Array.from(set);
        return (
            <Box>
                <details>
                    <summary style={{ cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                        <Badge size="xs" colorPalette="brand" variant="subtle">{typeLabel}</Badge>
                    </summary>
                    <Box pl={4}>
                        {items.map((item, i) => (
                            <Box
                                key={i}
                                py={1}
                                borderBottom={i < items.length - 1 ? '1px solid' : undefined}
                                borderColor="border.strong"
                            >
                                <ValueNode
                                    type={elementType}
                                    value={item}
                                    depth={depth + 1}
                                />
                            </Box>
                        ))}
                    </Box>
                </details>
            </Box>
        );
    }

    // Ref type
    if (type.type === 'Ref') {
        const ref = value as { value: unknown };
        return (
            <Box>
                <details>
                    <summary style={{ cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                        <Badge size="xs" colorPalette="danger" variant="subtle">Ref</Badge>
                    </summary>
                    <Box pl={4}>
                        <ValueNode
                            type={type.value as EastTypeValue}
                            value={ref.value}
                            depth={depth + 1}
                        />
                    </Box>
                </details>
            </Box>
        );
    }

    // Function types
    if (type.type === 'Function' || type.type === 'AsyncFunction') {
        return (
            <Box py={0.5} display="flex" alignItems="center" gap={2}>
                {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
                <Text as="span" color="fg.muted">[function]</Text>
                <Badge size="xs" colorPalette="gray" variant="subtle">{type.type}</Badge>
            </Box>
        );
    }

    // Fallback for unknown types
    return (
        <Box py={0.5} display="flex" alignItems="center" gap={2}>
            {label && <Text as="span" color="accent.purple" fontWeight="medium">{label}:</Text>}
            <Text as="span" color="fg.muted">[{type.type}]</Text>
        </Box>
    );
}

// Main component
export function EastValueViewer({ type, value }: EastValueViewerProps) {
    return (
        <Box
            layerStyle="surface.code.dark"
            fontFamily="mono"
            fontSize="sm"
            p={4}
            overflow="auto"
            maxHeight="100%"
        >
            <ValueNode type={type} value={value} depth={0} />
        </Box>
    );
}
