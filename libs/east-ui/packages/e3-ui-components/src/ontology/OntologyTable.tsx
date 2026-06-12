/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<OntologyTable>` — the Ontology editor's table view: a value-driver-tree
 * shaped projection of the bound graph (see `projection.ts`).
 *
 * Hierarchy lives in the stub column (objective groups → KPI sub-headers
 * with indentation); leaf process rows keep aligned columns so the surface
 * reads as a table, not a tree of cards. Rows order by global value-chain
 * stage; resource cycles share a stage and wear a pulsing ↺ badge.
 *
 * Interactions:
 * - hovering any chip highlights **every occurrence of that node** across
 *   the table (and tints the rows containing it) — hover "Cash" and the
 *   working-capital loop lights up;
 * - clicking a row expands its flow detail (fed by / feeds, with the
 *   carrying resources; cycle path; lints) with an animated reveal;
 * - clicking a chip or the expanded "open" affordance selects the node in
 *   the shared properties drawer.
 *
 * Styling rides the shared theme: `table` slot recipe for the grid chrome,
 * kind accents from `accents.ts`, and the `spec-pulse-live` keyframe for
 * cycle badges.
 *
 * @packageDocumentation
 */

import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { Box, HStack, Portal, Text, Tooltip, VStack, chakra, useSlotRecipe } from '@chakra-ui/react';
import { FiAlertTriangle, FiArrowDownRight, FiArrowUpRight, FiChevronDown, FiRefreshCw } from 'react-icons/fi';

import { NODE_KIND_ACCENT } from './accents.js';
import type { Ontology as OntologyValue } from './types.js';
import {
    projectTable,
    type KpiSection,
    type NodeChip,
    type ObjectiveGroup,
    type ProcessRow,
} from './projection.js';

// ============================================================================
// Shared bits.
// ============================================================================

interface HoverState {
    hovered: string | null;
    setHovered: (id: string | null) => void;
}

/** Themed hover tip (the shared `tooltip` slot recipe), matrix-style. */
function Tip({ label, children }: { label: React.ReactNode; children: React.ReactElement }) {
    return (
        <Tooltip.Root openDelay={150} closeDelay={60}>
            <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
            <Portal>
                <Tooltip.Positioner>
                    <Tooltip.Content>{label}</Tooltip.Content>
                </Tooltip.Positioner>
            </Portal>
        </Tooltip.Root>
    );
}

interface ChipProps extends HoverState {
    chip: NodeChip;
    emphasized?: boolean;
    onSelect: (id: string) => void;
}

/** A node chip — kind-accent dot + name. Hovering one highlights every chip
 *  with the same node id across the table; everything else dims. */
function Chip({ chip, emphasized = false, hovered, setHovered, onSelect }: ChipProps) {
    const active = hovered === chip.id;
    const dimmed = hovered !== null && !active;
    const accent = NODE_KIND_ACCENT[chip.kind];
    return (
        <Tip label={`${chip.kind} · ${chip.name}`}>
        <chakra.button
            type="button"
            display="inline-flex"
            alignItems="flex-start"
            gap="1.5"
            px="1.5"
            py="0.5"
            borderRadius="sm"
            border="1px solid"
            borderColor={active ? accent : emphasized ? 'border.strong' : 'border.subtle'}
            bg={active || emphasized ? 'bg.brand.subtle' : 'bg.surface'}
            opacity={dimmed ? 0.4 : 1}
            transform={active ? 'translateY(-1px)' : 'none'}
            boxShadow={active ? 'sm' : 'none'}
            transition="opacity 140ms ease, transform 140ms ease, border-color 140ms ease, background 140ms ease"
            fontSize="xs"
            color="fg"
            cursor="pointer"
            onMouseEnter={() => setHovered(chip.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelect(chip.id); }}
        >
            <Box w="6px" h="6px" borderRadius="full" bg={accent} flexShrink={0} mt="1" alignSelf="flex-start" />
            <Box as="span" textAlign="left" lineHeight="short">
                {chip.name}
            </Box>
        </chakra.button>
        </Tip>
    );
}

function ChipCell({ chips, emphasized, hovered, setHovered, onSelect }: {
    chips: NodeChip[];
    emphasized?: boolean;
} & HoverState & { onSelect: (id: string) => void }) {
    if (chips.length === 0) {
        return <Text as="span" fontFamily="mono" fontSize="2xs" color="fg.subtle">—</Text>;
    }
    return (
        <HStack gap="1" flexWrap="wrap">
            {chips.map(c => (
                <Chip key={c.id} chip={c} emphasized={emphasized ?? false}
                      hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
            ))}
        </HStack>
    );
}

/** Does this row mention the hovered node anywhere? Drives the row tint. */
function rowMentions(row: ProcessRow, id: string | null): boolean {
    if (id === null) return false;
    if (row.id === id) return true;
    return [row.uses, row.produces, row.kpis, row.data, row.decisions, row.policies, row.agents, row.alsoVia]
        .some(chips => chips.some(c => c.id === id));
}

// ============================================================================
// Rows.
// ============================================================================

const COLUMNS = ['Stage', 'Process', 'Uses', 'Produces', 'KPIs', 'Data', 'Decisions', 'Policies', ''] as const;
const COL_WIDTHS = ['44px', '22%', '14%', '14%', '12%', '9%', '15%', '9%', '28px'] as const;

interface RowCtx extends HoverState {
    onSelect: (id: string) => void;
    expanded: Set<string>;
    toggleExpanded: (id: string) => void;
    mounted: boolean;
    cellCss: object;
}

function FlowList({ label, icon, neighbors, hovered, setHovered, onSelect }: {
    label: string;
    icon: React.ReactNode;
    neighbors: ProcessRow['upstream'];
} & HoverState & { onSelect: (id: string) => void }) {
    return (
        <VStack alignItems="stretch" gap="1" minW="0">
            <HStack gap="1" color="fg.subtle">
                {icon}
                <Text fontFamily="mono" fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase">
                    {label}
                </Text>
            </HStack>
            {neighbors.length === 0 ? (
                <Text fontFamily="mono" fontSize="2xs" color="fg.subtle">none</Text>
            ) : neighbors.map(n => (
                <HStack key={n.id} gap="1.5" flexWrap="wrap">
                    <Chip chip={{ id: n.id, name: n.name, kind: 'process' }}
                          hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                    <Text fontSize="2xs" color="fg.muted">via {n.via.join(', ')}</Text>
                </HStack>
            ))}
        </VStack>
    );
}

const ProcessRowView = memo(function ProcessRowView({ row, index, ctx }: {
    row: ProcessRow;
    index: number;
    ctx: RowCtx;
}) {
    const { hovered, setHovered, onSelect, expanded, toggleExpanded, mounted, cellCss } = ctx;
    const isExpanded = expanded.has(row.id);
    const tinted = rowMentions(row, hovered);
    const delay = Math.min(index, 12) * 18;
    // Zebra keeps adjacent leaf rows distinguishable in dense groups; the
    // expanded row and its detail panel share one surface so they read as
    // a single attached unit.
    const zebra = index % 2 === 1;
    const rowCellCss = isExpanded ? { ...cellCss, borderBottom: 'none' } : cellCss;

    return (
        <Fragment>
            <Box
                as="tr"
                cursor="pointer"
                bg={isExpanded || zebra ? 'bg.panel' : 'transparent'}
                // Highlight via the spec table's selected treatment — a full
                // 2px inset ring — never a background tint behind row text.
                boxShadow={tinted ? 'inset 0 0 0 2px var(--chakra-colors-brand-solid)' : 'none'}
                opacity={mounted ? 1 : 0}
                transform={mounted ? 'none' : 'translateY(6px)'}
                transition={`opacity 220ms ease ${delay}ms, transform 220ms ease ${delay}ms, box-shadow 140ms ease`}
                _hover={{ boxShadow: 'inset 0 0 0 1px var(--chakra-colors-border-strong)' }}
                onClick={() => toggleExpanded(row.id)}
            >
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <HStack gap="1">
                        <Text fontFamily="mono" fontSize="2xs" fontWeight="bold" color="fg.muted">
                            S{row.stage}
                        </Text>
                        {row.cyclic && (
                            <Tip label={`Resource cycle: ${[row.name, ...row.cycleWith].join(' → ')} → ${row.name}`}>
                                <Box color="brand.fg" display="inline-flex">
                                    <FiRefreshCw size={11} />
                                </Box>
                            </Tip>
                        )}
                    </HStack>
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <VStack alignItems="stretch" gap="0.5" minW="0">
                        <HStack gap="1.5" alignItems="flex-start">
                            <Box
                                w="7px" h="7px" borderRadius="full" flexShrink={0} mt="1.5"
                                bg={NODE_KIND_ACCENT.process}
                                boxShadow={hovered === row.id ? `0 0 0 3px ${NODE_KIND_ACCENT.process}33` : 'none'}
                                transition="box-shadow 140ms ease"
                            />
                            <Text fontSize="sm" fontWeight="semibold" color="fg" lineHeight="tight">
                                {row.name}
                            </Text>
                            <Box
                                color="fg.subtle"
                                marginLeft="auto"
                                mt="1"
                                transform={isExpanded ? 'rotate(180deg)' : 'none'}
                                transition="transform 180ms ease"
                                display="inline-flex"
                                flexShrink={0}
                            >
                                <FiChevronDown size={12} />
                            </Box>
                        </HStack>
                        {row.agents.length > 0 && (
                            <HStack gap="1" flexWrap="wrap">
                                {row.agents.map(a => (
                                    <Chip key={a.id} chip={a} hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                                ))}
                            </HStack>
                        )}
                        {row.description && (
                            <Text fontSize="xs" color="fg.muted" lineHeight="snug"
                                  overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                {row.description}
                            </Text>
                        )}
                    </VStack>
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <ChipCell chips={row.uses} hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <ChipCell chips={row.produces} hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <VStack alignItems="stretch" gap="1">
                        <ChipCell chips={row.kpis} hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                        {row.alsoVia.length > 0 && (
                            <Text fontSize="2xs" color="fg.subtle">
                                also via {row.alsoVia.map(k => k.name).join(', ')}
                            </Text>
                        )}
                    </VStack>
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <ChipCell chips={row.data} hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <ChipCell chips={row.decisions} emphasized hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top">
                    <ChipCell chips={row.policies} hovered={hovered} setHovered={setHovered} onSelect={onSelect} />
                </Box>
                <Box as="td" css={rowCellCss} verticalAlign="top" textAlign="right">
                    {row.lints.length > 0 && (
                        <Tip label={<VStack alignItems="stretch" gap="0.5">{row.lints.map(l => <Text key={l} fontSize="xs">{l}</Text>)}</VStack>}>
                            <Box as="span" display="inline-flex" color="ink.warning">
                                <FiAlertTriangle size={13} />
                            </Box>
                        </Tip>
                    )}
                </Box>
            </Box>
            {/* Expanded flow detail — animated reveal, visually attached to its
                row: shared surface, no separator above, strong closing rule. */}
            <Box as="tr">
                <chakra.td colSpan={COLUMNS.length} p="0" border="none">
                    <Box
                        display="grid"
                        gridTemplateRows={isExpanded ? '1fr' : '0fr'}
                        transition="grid-template-rows 220ms ease"
                    >
                        <Box overflow="hidden" minH="0">
                            <Box
                                px="4" py="3"
                                bg="bg.panel"
                                borderBottom="2px solid"
                                borderBottomColor="border.strong"
                            >
                                <Box
                                    display="grid"
                                    gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
                                    gap="5"
                                    alignItems="start"
                                >
                                    <FlowList
                                        label="Upstream"
                                        icon={<FiArrowUpRight size={11} />}
                                        neighbors={row.upstream}
                                        hovered={hovered} setHovered={setHovered} onSelect={onSelect}
                                    />
                                    <FlowList
                                        label="Downstream"
                                        icon={<FiArrowDownRight size={11} />}
                                        neighbors={row.downstream}
                                        hovered={hovered} setHovered={setHovered} onSelect={onSelect}
                                    />
                                    {row.cyclic && (
                                        <VStack alignItems="stretch" gap="1">
                                            <HStack gap="1" color="brand.fg">
                                                <FiRefreshCw size={11} />
                                                <Text fontFamily="mono" fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase">
                                                    Cycle
                                                </Text>
                                            </HStack>
                                            <Text fontSize="xs" color="fg.muted">
                                                {[row.name, ...row.cycleWith].join(' → ')} → {row.name}
                                            </Text>
                                        </VStack>
                                    )}
                                    {row.lints.length > 0 && (
                                        <VStack alignItems="stretch" gap="1">
                                            <HStack gap="1" color="ink.warning">
                                                <FiAlertTriangle size={11} />
                                                <Text fontFamily="mono" fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase">
                                                    Warnings
                                                </Text>
                                            </HStack>
                                            {row.lints.map(l => (
                                                <Text key={l} fontSize="xs" color="fg.muted">{l}</Text>
                                            ))}
                                        </VStack>
                                    )}
                                </Box>
                                <HStack mt="2.5" justify="flex-end">
                                    <chakra.button
                                        type="button"
                                        fontFamily="mono"
                                        fontSize="2xs"
                                        letterSpacing="wider"
                                        textTransform="uppercase"
                                        color="brand.fg"
                                        cursor="pointer"
                                        _hover={{ textDecoration: 'underline' }}
                                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelect(row.id); }}
                                    >
                                        Open properties →
                                    </chakra.button>
                                </HStack>
                            </Box>
                        </Box>
                    </Box>
                </chakra.td>
            </Box>
        </Fragment>
    );
});

// ============================================================================
// Groups.
// ============================================================================

function SectionRows({ section, ctx, startIndex }: { section: KpiSection; ctx: RowCtx; startIndex: number }) {
    return (
        <Fragment>
            {section.kpi && (
                <Box as="tr" bg="bg.panel">
                    <chakra.td colSpan={COLUMNS.length} px="4" py="1.5"
                         borderBottom="1px solid" borderColor="border.subtle">
                        <HStack gap="2" pl="4">
                            <Box w="6px" h="6px" borderRadius="full" bg={NODE_KIND_ACCENT.kpi} />
                            <Text fontFamily="mono" fontSize="2xs" fontWeight="semibold"
                                  letterSpacing="wider" textTransform="uppercase" color="fg.muted">
                                via
                            </Text>
                            <Chip chip={section.kpi} hovered={ctx.hovered} setHovered={ctx.setHovered} onSelect={ctx.onSelect} />
                        </HStack>
                    </chakra.td>
                </Box>
            )}
            {section.rows.map((row, i) => (
                <ProcessRowView key={row.id} row={row} index={startIndex + i} ctx={ctx} />
            ))}
        </Fragment>
    );
}

function GroupSection({ group, ctx, collapsed, toggleCollapsed, headerCss, columnHeaderCss }: {
    group: ObjectiveGroup;
    ctx: RowCtx;
    collapsed: Set<string>;
    toggleCollapsed: (key: string) => void;
    headerCss: object;
    columnHeaderCss: object;
}) {
    const key = group.id ?? '∅';
    const isCollapsed = collapsed.has(key);
    const indent = group.depth * 5;
    let rowIndex = 0;

    return (
        <Box>
            {/* Objective header — collapsible tier of the driver tree. */}
            <HStack
                px="4" py="2.5"
                pl={`calc(${indent * 4}px + var(--chakra-spacing-4))`}
                gap="2.5"
                borderBottom="1px solid"
                borderColor="border.subtle"
                bg="bg.panel"
                cursor="pointer"
                userSelect="none"
                transition="background 140ms ease"
                _hover={{ bg: 'bg.brand.subtle' }}
                onClick={() => toggleCollapsed(key)}
            >
                <Box
                    color="fg.subtle"
                    transform={isCollapsed ? 'rotate(-90deg)' : 'none'}
                    transition="transform 180ms ease"
                    display="inline-flex"
                >
                    <FiChevronDown size={14} />
                </Box>
                <Box w="8px" h="8px" borderRadius="full"
                     bg={group.id === null ? 'border.strong' : NODE_KIND_ACCENT.objective} flexShrink={0} />
                <Text fontSize="sm" fontWeight="semibold" color="fg">{group.name}</Text>
                <Text fontFamily="mono" fontSize="2xs" letterSpacing="wider" color="fg.muted" textTransform="uppercase">
                    {group.processCount} processes · {group.decisionCount} decisions
                </Text>
                {group.lintCount > 0 && (
                    <Tip label={`${group.lintCount} completeness warnings in this group`}>
                        <HStack gap="1" color="ink.warning">
                            <FiAlertTriangle size={12} />
                            <Text fontFamily="mono" fontSize="2xs" fontWeight="bold">{group.lintCount}</Text>
                        </HStack>
                    </Tip>
                )}
                {group.description && (
                    <Text fontSize="xs" color="fg.subtle" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                        {group.description}
                    </Text>
                )}
            </HStack>

            {/* Animated collapse of the group's body. */}
            <Box display="grid" gridTemplateRows={isCollapsed ? '0fr' : '1fr'} transition="grid-template-rows 220ms ease">
                <Box overflow="hidden" minH="0">
                    {group.sections.length > 0 && group.processCount > 0 && (
                        <chakra.table css={headerCss} style={{ tableLayout: 'fixed' }}>
                            <Box as="colgroup">
                                {COL_WIDTHS.map((w, i) => <Box as="col" key={i} style={{ width: w }} />)}
                            </Box>
                            <Box as="thead">
                                <Box as="tr">
                                    {COLUMNS.map(c => (
                                        <Box as="th" key={c} css={columnHeaderCss} textAlign="left" px="3" py="1.5">
                                            {c}
                                        </Box>
                                    ))}
                                </Box>
                            </Box>
                            <Box as="tbody">
                                {group.sections.map((s, si) => {
                                    const start = rowIndex;
                                    rowIndex += s.rows.length;
                                    return <SectionRows key={s.kpi?.id ?? `direct-${si}`} section={s} ctx={ctx} startIndex={start} />;
                                })}
                            </Box>
                        </chakra.table>
                    )}
                    {group.children.map(child => (
                        <GroupSection
                            key={child.id ?? '∅'}
                            group={child}
                            ctx={ctx}
                            collapsed={collapsed}
                            toggleCollapsed={toggleCollapsed}
                            headerCss={headerCss}
                            columnHeaderCss={columnHeaderCss}
                        />
                    ))}
                </Box>
            </Box>
        </Box>
    );
}

// ============================================================================
// The table view.
// ============================================================================

export interface OntologyTableProps {
    ontology: OntologyValue;
    /** Open a node in the shared properties drawer. */
    onSelectNode: (id: string) => void;
}

export const OntologyTable = memo(function OntologyTable({ ontology, onSelectNode }: OntologyTableProps) {
    const projection = useMemo(() => projectTable(ontology), [ontology]);
    const tableRecipe = useSlotRecipe({ key: 'table' });
    const styles = useMemo(() => tableRecipe({}), [tableRecipe]);

    const [hovered, setHovered] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [showLints, setShowLints] = useState(false);

    // Entry animation — rows stagger in on first mount of the view.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        const raf = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(raf);
    }, []);

    const ctx: RowCtx = useMemo(() => ({
        hovered,
        setHovered,
        onSelect: onSelectNode,
        expanded,
        toggleExpanded: (id: string) => setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        }),
        mounted,
        cellCss: { ...(styles.cell as object), paddingLeft: '12px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--chakra-colors-border-subtle)' },
    }), [hovered, onSelectNode, expanded, mounted, styles.cell]);

    const toggleCollapsed = (key: string) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    if (projection.processCount === 0) {
        return (
            <Box p="9" textAlign="center">
                <Text fontFamily="mono" fontSize="sm" color="fg.subtle">
                    No process nodes yet — add processes in the graph view to populate the table.
                </Text>
            </Box>
        );
    }

    return (
        <Box h="100%" overflowY="auto" bg="bg.surface" fontFeatureSettings='"tnum"'>
            {/* Graph-level lints — collapsed to a slim banner. */}
            {projection.lints.length > 0 && (
                <Box
                    px="4" py="1.5"
                    borderBottom="1px solid" borderColor="border.subtle"
                    bg="bg.panel"
                    cursor="pointer"
                    onClick={() => setShowLints(v => !v)}
                >
                    <HStack gap="1.5" color="ink.warning">
                        <FiAlertTriangle size={12} />
                        <Text fontFamily="mono" fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase">
                            {projection.lints.length} graph warnings
                        </Text>
                        <Box transform={showLints ? 'rotate(180deg)' : 'none'} transition="transform 180ms ease" display="inline-flex">
                            <FiChevronDown size={11} />
                        </Box>
                    </HStack>
                    <Box display="grid" gridTemplateRows={showLints ? '1fr' : '0fr'} transition="grid-template-rows 200ms ease">
                        <Box overflow="hidden" minH="0">
                            <VStack alignItems="stretch" gap="0.5" pt="1.5">
                                {projection.lints.map(l => (
                                    <Text key={l} fontSize="xs" color="fg.muted">{l}</Text>
                                ))}
                            </VStack>
                        </Box>
                    </Box>
                </Box>
            )}

            {projection.groups.map(group => (
                <GroupSection
                    key={group.id ?? '∅'}
                    group={group}
                    ctx={ctx}
                    collapsed={collapsed}
                    toggleCollapsed={toggleCollapsed}
                    headerCss={styles.root as object}
                    columnHeaderCss={styles.columnHeader as object}
                />
            ))}
        </Box>
    );
});
