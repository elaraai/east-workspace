/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * EastChakraDiff — native Chakra v3 renderer for the {@link Diff} component
 * declared in `@elaraai/e3-ui`. Surfaces all pending {@link Data.bindStaged}
 * edits across a caller-chosen set of binding paths in one card, with
 * per-leaf accept/reject, mode toggle, and merge-aware Apply.
 *
 * Visual fidelity: 1:1 with `e3-ui/docs/diff-component-mockup.html`.
 *   - brand-teal accents (#488e97), soft chips, status-paired FA icons,
 *     orange conflict mode, three-option chooser per conflict.
 *
 * Lifecycle (Apply button):
 *   1. For each staged path, compute `userPatch = diff(snapshot, buffered)`
 *      and prune leaves the user rejected.
 *   2. Compute `serverPatch = diff(snapshot, currentServer)` to detect drift.
 *   3. `detectConflictsFor` over the two patches; if any, switch to conflict
 *      UI. Otherwise `mergeFor → applyFor → cache.write → staged.discard`
 *      sequentially.
 *   4. Once all conflicts resolved (per-row chooser populates the
 *      `resolutions` map), Apply re-runs through `mergeWithResolutionsFor`.
 *
 * The renderer registers itself against the `Diff` extension at module
 * load via {@link implementUIComponent}.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Flex, HStack, Input as ChakraInput, Text, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCheck,
    faMinus,
    faPen,
    faPlus,
    faServer,
    faTriangleExclamation,
    faUser,
    faXmark,
    faArrowRight,
    faEquals,
} from "@fortawesome/free-solid-svg-icons";
import {
    decodeBeast2For,
    encodeBeast2For,
    equalFor,
    ConflictError,
    detectConflictsFor,
    mergeWithResolutionsFor,
    type Conflict,
    type Resolution,
    type EastTypeValue,
    type ValueTypeOf,
    diffFor,
    applyFor,
    prunePatchFor,
    pathToString,
    validatePatchFor,
    type PatchConflict,
    variant,
} from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { Diff, DiffBindingType } from "@elaraai/e3-ui/internal";
import { implementUIComponent } from "@elaraai/east-ui-components";

import {
    getStagedStore,
    getReactiveDatasetCache,
    datasetCacheKey,
    datasetPathToString,
    getBindingTypes,
} from "../platform/index.js";
import {
    walkPatchToTree,
    collectLeaves,
    type DiffNode,
    type LeafNode,
    type GroupNode,
} from "./walker.js";
import { formatLeafValue, formatBindingLabel } from "./format.js";
import { isPrimitiveLeafType, formatManualDraft, parseManualDraft } from "./manual.js";

// =============================================================================
// Types — pulled from the IR carrier so this stays in sync.
// =============================================================================

type DiffValue = ValueTypeOf<typeof Diff.Component.schema>;
const diffValueEqual = equalFor(Diff.Component.schema);

/**
 * What "Apply" does for this binding. Determined by the binding's mode +
 * patch presence:
 *
 * - **apply-buffer-to-source** (`staged`, no patch dataset): write the
 *   StagedStore buffer to the source dataset; drop the buffer. This is the
 *   classic transactional edit flow and supports 3-way merge against
 *   server drift since first-write.
 * - **publish-buffer-to-patch** (`staged` + patch dataset): write
 *   `diff(source, buffer)` to the patch dataset; drop the buffer. The
 *   source itself is untouched.
 * - **apply-patch-to-source** (`direct` + patch dataset): apply the patch
 *   dataset's contents to the source; clear the patch dataset.
 *
 * Bindings with `direct` and no patch dataset never appear here — there's
 * no in-flight change to surface.
 */
type CommitKind = "apply-buffer-to-source" | "publish-buffer-to-patch" | "apply-patch-to-source";

interface BindingMode {
    kind: CommitKind;
    /** Optional patch dataset path — present when `commitKind` is
     *  `publish-buffer-to-patch` or `apply-patch-to-source`. */
    patchPath?: TreePath;
    patchPathStr?: string;
    /** Patch IR's runtime type — needed to encode `unchanged` resets and
     *  pruned patches. Present when `patchPath` is. */
    patchType?: EastTypeValue;
    /** Decoded server-side patch (`diff(snapshot, currentServer)`) — only
     *  populated for `apply-buffer-to-source` (the staged 3-way merge
     *  case). */
    serverPatch?: any;
    /** Server-tree leaves keyed by path. Same population rule as
     *  `serverPatch`. */
    serverLeavesByPath?: ReadonlyMap<string, LeafNode>;
}

interface BindingState {
    /** The source TreePath. */
    path: TreePath;
    /** Display label — last segment of the path. */
    label: string;
    /** Stringified path for keys + cache lookups. */
    pathStr: string;
    /** Runtime EastType for the binding's source value. */
    stateType: EastTypeValue;
    /** Decoded user-side patch (the IR representation of the in-flight change). */
    userPatch: any;
    /** Tree of changes under this binding (null = no changes). */
    tree: DiffNode | null;
    /** Flat list of leaves under `tree` — used for total-count tallies. */
    leaves: LeafNode[];
    /** Mode-specific routing + drift data. */
    mode: BindingMode;
}

// =============================================================================
// Helpers
// =============================================================================

function getOpt<T>(opt: { type: "none"; value: null } | { type: "some"; value: T }): T | undefined {
    return opt.type === "some" ? opt.value : undefined;
}

// =============================================================================
// Density — compact / condensed presets shrink the per-row dimensions while
// the header / footer chrome stays stable (the component renders frameless
// since #151 — no card border around it).
// =============================================================================

type Density = "comfortable" | "compact" | "condensed";

interface DensityMetrics {
    /** Vertical padding inside leaf and group rows (`py`). */
    rowPadY: string;
    /** Per-depth indent step in pixels — multiplied by the row's depth. */
    indentStep: number;
    /** Font size for leaf / group labels. */
    labelFontSize: string;
    /** Font size for value chips. */
    chipFontSize: string;
    /** Square dimension for the round op icon (`OpIcon`). */
    opIconSize: string;
    /** Square dimension for the X / discard / resolve action buttons. */
    actionBtnSize: string;
}

const DENSITY_METRICS: Record<Density, DensityMetrics> = {
    comfortable: { rowPadY: "10px", indentStep: 20, labelFontSize: "14px", chipFontSize: "12px", opIconSize: "20px", actionBtnSize: "32px" },
    compact:     { rowPadY: "6px",  indentStep: 16, labelFontSize: "13px", chipFontSize: "11px", opIconSize: "18px", actionBtnSize: "26px" },
    condensed:   { rowPadY: "3px",  indentStep: 12, labelFontSize: "12px", chipFontSize: "10px", opIconSize: "16px", actionBtnSize: "22px" },
};

/** Resolve the IR `density` Option to one of the three presets. */
function resolveDensity(opt: { type: "none"; value: null } | { type: "some"; value: { type: string } }): Density {
    if (opt.type === "none") return "comfortable";
    const tag = opt.value.type;
    return tag === "compact" || tag === "condensed" ? tag : "comfortable";
}

// =============================================================================
// Reactive subscription — re-render when the staged store fires for any of
// our keys. Backed by useSyncExternalStore so concurrent React stays sane.
// =============================================================================

function useStagedKeyVersions(workspace: string, paths: TreePath[]): number {
    const store = getStagedStore();
    const keys = useMemo(
        () => paths.map(p => datasetCacheKey(workspace, p)),
        [workspace, paths],
    );
    const subscribe = useCallback((cb: () => void) => {
        const unsubs = keys.map(key => store.subscribe(key, cb));
        return () => unsubs.forEach(u => u());
    }, [store, keys]);
    const getSnapshot = useCallback(
        () => keys.reduce((acc, k) => acc + store.getKeyVersion(k), 0),
        [store, keys],
    );
    return useSyncExternalStore(subscribe, getSnapshot);
}

function useDatasetKeyVersions(workspace: string, paths: TreePath[]): number {
    const cache = getReactiveDatasetCache();
    const keys = useMemo(
        () => paths.map(p => datasetCacheKey(workspace, p)),
        [workspace, paths],
    );
    const subscribe = useCallback((cb: () => void) => {
        const unsubs = keys.map(key => cache.subscribe(key, cb));
        return () => unsubs.forEach(u => u());
    }, [cache, keys]);
    const getSnapshot = useCallback(
        () => keys.reduce((acc, k) => acc + cache.getKeyVersion(k), 0),
        [cache, keys],
    );
    return useSyncExternalStore(subscribe, getSnapshot);
}

// =============================================================================
// Per-binding state derivation — pure function, called inside useMemo.
// =============================================================================

// `direct` + no-patch bindings can never surface anything in a Diff; warn once
// per source path so the resulting empty card isn't a silent mystery (deduped
// because binding-state derivation re-runs on every render).
const warnedDirectNoPatch = new Set<string>();

function pickCommitKind(mode: "staged" | "direct", patchPath: TreePath | undefined): CommitKind | null {
    if (mode === "staged" && !patchPath) return "apply-buffer-to-source";
    if (mode === "staged" && patchPath)  return "publish-buffer-to-patch";
    if (mode === "direct" && patchPath)  return "apply-patch-to-source";
    return null;   // direct + no patch — nothing to surface in Diff
}

function deriveBindings(
    workspace: string,
    bindings: ValueTypeOf<typeof DiffBindingType>[],
): BindingState[] {
    const staged = getStagedStore();
    const cache = getReactiveDatasetCache();
    const out: BindingState[] = [];

    for (const b of bindings) {
        const sourcePath = b.source as TreePath;
        const patchPath  = b.patch.type === "some" ? (b.patch.value as TreePath) : undefined;
        const mode       = b.mode.type as "staged" | "direct";
        const types      = getBindingTypes(workspace, sourcePath);
        if (!types) continue;   // binding hasn't run yet — wait for re-render

        const commitKind = pickCommitKind(mode, patchPath);
        if (!commitKind) {
            // direct + no patch — nothing to surface. Since `direct` is the default
            // Data.bind mode, a binding handed to <Diff> like this is almost always a
            // missing `{ mode: "staged" }`; warn once so the empty card isn't a mystery.
            const key = datasetPathToString(sourcePath);
            if (!warnedDirectNoPatch.has(key)) {
                warnedDirectNoPatch.add(key);
                console.warn(
                    `[Diff] binding "${key}" is mode="direct" with no patch dataset — it writes ` +
                    `through immediately, so the Diff has nothing to review. Pass { mode: "staged" } ` +
                    `to Data.bind (or give it a patch dataset) to surface its edits here.`,
                );
            }
            continue;   // direct + no patch — hidden from Diff
        }

        const sourceType = types.sourceType;
        const patchType  = types.patchType;
        const label      = formatBindingLabel(sourcePath as ReadonlyArray<unknown>);
        const decodeSource = decodeBeast2For(sourceType);

        // ----- Resolve the userPatch (the in-flight change) -------------
        let userPatch: any;
        let serverPatch: any | undefined;
        let serverLeavesByPath: Map<string, LeafNode> | undefined;

        if (commitKind === "apply-buffer-to-source") {
            // Staged buffer with NO patch dataset. Patch = diff(snapshot, buffer).
            const entry = staged.getEntry(workspace, sourcePath);
            if (!entry) continue;
            const snapshot = decodeSource(entry.snapshot);
            const buffered = decodeSource(entry.buffered);
            userPatch = diffFor(sourceType)(snapshot, buffered);

            // Server drift — only relevant for this kind.
            serverPatch = variant("unchanged", null);
            const serverBytes = cache.read(workspace, sourcePath);
            if (serverBytes && serverBytes !== entry.snapshot) {
                try {
                    const server = decodeSource(serverBytes);
                    serverPatch = diffFor(sourceType)(snapshot, server);
                } catch {
                    // Fall through with unchanged — clean apply preferred.
                }
            }
            const serverTree = walkPatchToTree(sourceType, serverPatch, label);
            serverLeavesByPath = new Map<string, LeafNode>();
            if (serverTree) {
                for (const leaf of collectLeaves(serverTree)) {
                    serverLeavesByPath.set(leaf.path, leaf);
                }
            }
        } else if (commitKind === "publish-buffer-to-patch") {
            // Staged buffer + patch dataset. Patch we DISPLAY is diff(source, buffer).
            const entry = staged.getEntry(workspace, sourcePath);
            if (!entry) continue;
            const sourceBytes = cache.read(workspace, sourcePath);
            if (!sourceBytes) continue;
            const sourceVal = decodeSource(sourceBytes);
            const bufferedVal = decodeSource(entry.buffered);
            userPatch = diffFor(sourceType)(sourceVal, bufferedVal);
        } else {
            // commitKind === "apply-patch-to-source": read patch dataset directly.
            if (!patchPath) continue;
            const patchBytes = cache.read(workspace, patchPath);
            userPatch = patchBytes
                ? decodeBeast2For(patchType)(patchBytes)
                : variant("unchanged", null);
        }

        const tree = walkPatchToTree(sourceType, userPatch, label);
        const leaves = tree ? collectLeaves(tree) : [];

        // ----- Stale-leaf annotation for any binding with a patch dataset
        // OR for staged bindings (where the buffer's `before` may not match
        // the live source if it has drifted since first-write). Validate
        // against the live source. -------------------------------------------
        if (tree && commitKind !== "apply-buffer-to-source") {
            const sourceBytes = cache.read(workspace, sourcePath);
            if (sourceBytes) {
                try {
                    const sourceVal = decodeSource(sourceBytes);
                    const conflictsList: PatchConflict[] =
                        validatePatchFor(sourceType)(sourceVal, userPatch);
                    if (conflictsList.length > 0) {
                        const byPath = new Map<string, PatchConflict>();
                        for (const c of conflictsList) byPath.set(pathToString(c.path), c);
                        for (const leaf of leaves) {
                            const c = byPath.get(leaf.path);
                            if (c) leaf.stale = { expected: c.expected, actual: c.actual };
                        }
                    }
                } catch (err) {
                    console.error("[Diff.deriveBindings] validate failed:", err);
                }
            }
        }

        const modeData: BindingMode = { kind: commitKind };
        if (patchPath) {
            modeData.patchPath = patchPath;
            modeData.patchPathStr = datasetPathToString(patchPath);
            modeData.patchType = patchType;
        }
        if (serverPatch !== undefined) modeData.serverPatch = serverPatch;
        if (serverLeavesByPath !== undefined) modeData.serverLeavesByPath = serverLeavesByPath;

        out.push({
            path: sourcePath,
            label,
            pathStr: datasetPathToString(sourcePath),
            stateType: sourceType,
            userPatch,
            tree,
            leaves,
            mode: modeData,
        });
    }

    return out;
}

// =============================================================================
// Visual sub-components — kept inline; not exported.
// =============================================================================

type IconKind = "insert" | "delete" | "update" | "unchanged" | "conflict";

/* Op glyph — a bare semantic mark in the column gutter; the +/− value chips
 * and row context carry the rest. No tinted circle. */
const OP_GLYPH: Record<IconKind, { color: string; icon: any }> = {
    insert:    { color: "fg.success", icon: faPlus },
    delete:    { color: "fg.danger",  icon: faMinus },
    update:    { color: "fg.muted",   icon: faPen },
    unchanged: { color: "fg.subtle",  icon: faEquals },
    conflict:  { color: "fg.warning", icon: faTriangleExclamation },
};

function OpIcon({ kind, size = "20px" }: { kind: IconKind; size?: string }) {
    const p = OP_GLYPH[kind];
    return (
        <Box
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            width={size}
            color={p.color}
            flexShrink={0}
            fontSize="11px"
        >
            <FontAwesomeIcon icon={p.icon} />
        </Box>
    );
}

/* Value chip — neutral `.chip` (paper + rule-strong border, mono numerals).
 * The +/− glyph carries the only colour; the chip itself stays neutral. */
function Chip({ children, fontSize = "12px" }: { children: React.ReactNode; fontSize?: string }) {
    const chip = useRecipe({ key: "chip" });
    return (
        <Box as="span" css={chip({ numeric: true })} fontSize={fontSize}>
            {children}
        </Box>
    );
}

type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

/* Dot + WORD status flag — spec `.status` (never a tinted pill). */
function StatusFlag({ tone, label }: { tone: StatusTone; label: string }) {
    const status = useSlotRecipe({ key: "status" });
    const s = status({ status: tone, size: "sm" });
    return (
        <Box as="span" css={s.root}>
            <Box as="span" css={s.indicator} />
            <Box as="span" css={s.label}>{label}</Box>
        </Box>
    );
}

/* Per-row discard — ghost icon button (spec `.btn.ghost`). */
function ActionBtn({
    icon, title, onClick, disabled, size = "28px",
}: {
    icon: any;
    title: string;
    onClick?: () => void;
    disabled?: boolean;
    size?: string;
}) {
    return (
        <Box
            as="button"
            aria-label={title}
            aria-disabled={disabled}
            onClick={disabled ? undefined : onClick}
            width={size}
            height={size}
            borderRadius="4px"
            border="0"
            bg="transparent"
            color="fg.subtle"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            cursor={disabled ? "not-allowed" : "pointer"}
            opacity={disabled ? 0.5 : 1}
            fontSize="12px"
            transition="all 100ms ease"
            _hover={{ color: "fg", bg: "bg.muted" }}
        >
            <FontAwesomeIcon icon={icon} />
        </Box>
    );
}

interface RowProps {
    row: LeafNode;
    depth: number;
    bindingPathStr: string;
    showActions: boolean;
    /** Stable handler — `bindingPathStr` and `row.path` are passed in so
     *  the parent can hold a single shared callback without per-row closures. */
    onDiscard: (bindingPathStr: string, leafPath: string) => void;
    annotation?: { text: string; tone: "green" | "brand" | "gray" };
    metrics: DensityMetrics;
}

const DiffRow = memo(function DiffRow({ row, depth, bindingPathStr, showActions, onDiscard, annotation, metrics }: RowProps) {
    const handleDiscard = useCallback(() => onDiscard(bindingPathStr, row.path), [onDiscard, bindingPathStr, row.path]);
    return (
        <Box
            display="grid"
            gridTemplateColumns="28px 1fr auto"
            alignItems="center"
            px="18px"
            py={metrics.rowPadY}
            pl={`${18 + depth * metrics.indentStep}px`}
            gap="16px"
            borderBottomWidth="1px"
            borderBottomColor="border.subtle"
            _hover={{ bg: "bg.canvas" }}
        >
            <OpIcon kind={row.op === "unchanged" ? "unchanged" : row.op} size={metrics.opIconSize} />
            <Flex direction="column" minW={0} gap="2px">
                <Text
                    fontSize={metrics.labelFontSize}
                    fontWeight={500}
                    color={row.stale ? "fg.warning" : "fg"}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                >
                    {row.label}
                </Text>
                {row.stale && (
                    <Text fontSize="11px" color="fg.warning" fontWeight={500}>
                        <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                        {row.stale.actual === undefined
                            ? "stale — source no longer has this entry"
                            : `stale — source actually has ${formatLeafValue(row.leafType, row.stale.actual)}`}
                    </Text>
                )}
                {annotation && (
                    <Text fontSize="11px" color={`${annotation.tone}.700`} fontWeight={500}>
                        {annotation.text}
                    </Text>
                )}
            </Flex>
            <HStack gap="16px" align="center">
                <HStack gap="6px" wrap="wrap">
                    {row.before !== undefined && (
                        <Chip fontSize={metrics.chipFontSize}><Box as="span" color="fg.danger"><FontAwesomeIcon icon={faMinus} /></Box> {formatLeafValue(row.leafType, row.before)}</Chip>
                    )}
                    {row.before !== undefined && row.after !== undefined && (
                        <Box as="span" color="fg.subtle" fontSize="11px"><FontAwesomeIcon icon={faArrowRight} /></Box>
                    )}
                    {row.after !== undefined && (
                        <Chip fontSize={metrics.chipFontSize}><Box as="span" color="fg.success"><FontAwesomeIcon icon={faPlus} /></Box> {formatLeafValue(row.leafType, row.after)}</Chip>
                    )}
                </HStack>
                {showActions && (
                    <ActionBtn icon={faXmark} title="Discard this change" onClick={handleDiscard} size={metrics.actionBtnSize} />
                )}
            </HStack>
        </Box>
    );
});

interface ConflictRowProps {
    row: LeafNode;
    depth: number;
    bindingPathStr: string;
    serverValue: any;
    resolution: Resolution | undefined;
    /** Stable handler — receives the binding pathStr and the leaf path. */
    onResolve: (bindingPathStr: string, leafPath: string, r: Resolution) => void;
    metrics: DensityMetrics;
}

const ConflictRow = memo(function ConflictRow({ row, depth, bindingPathStr, serverValue, resolution, onResolve, metrics }: ConflictRowProps) {
    const yoursStr  = formatLeafValue(row.leafType, row.after);
    const theirsStr = formatLeafValue(row.leafType, serverValue);
    const isYours   = resolution?.type === "keepA";
    const isTheirs  = resolution?.type === "keepB";
    const isManual  = resolution?.type === "manual";
    const handleKeepA  = useCallback(() => onResolve(bindingPathStr, row.path, { type: "keepA" }), [onResolve, bindingPathStr, row.path]);
    const handleKeepB  = useCallback(() => onResolve(bindingPathStr, row.path, { type: "keepB" }), [onResolve, bindingPathStr, row.path]);
    const handleManual = useCallback((value: any) => onResolve(bindingPathStr, row.path, { type: "manual", value }), [onResolve, bindingPathStr, row.path]);
    const supportsManual = isPrimitiveLeafType(row.leafType);
    return (
        <Box
            display="block"
            px="18px"
            py={metrics.rowPadY}
            pl={`${18 + depth * metrics.indentStep}px`}
            bg="warning.subtle"
            borderBottomWidth="1px"
            borderBottomColor="border.subtle"
        >
            <Box display="grid" gridTemplateColumns="28px 1fr" alignItems="center" gap="16px">
                <OpIcon kind="conflict" size={metrics.opIconSize} />
                <Flex direction="column" minW={0} gap="2px">
                    <Text fontSize={metrics.labelFontSize} fontWeight={500} color="fg">
                        {row.label}
                        <Text as="span" color="fg.warning" fontWeight={500} ml="6px">· conflict</Text>
                    </Text>
                </Flex>
            </Box>
            <Box
                display="grid"
                // Compact hosts (#355): auto-fit with a 180px floor stacks the
                // KEEP YOURS / KEEP THEIRS / MANUAL cards vertically on phones
                // and keeps them side-by-side at desktop widths.
                gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
                gap="8px"
                mt="10px"
                p="12px"
                bg="white"
                border="1px solid"
                borderColor="fg.warning"
                borderRadius="md"
                role="radiogroup"
                aria-label={`Resolve ${row.path || "(root)"}`}
            >
                <ChooserOption
                    selected={isYours}
                    label="Keep yours"
                    icon={faUser}
                    value={yoursStr}
                    onClick={handleKeepA}
                />
                <ChooserOption
                    selected={isTheirs}
                    label="Keep theirs"
                    icon={faServer}
                    value={theirsStr}
                    onClick={handleKeepB}
                />
                {supportsManual && (
                    <ManualOption
                        selected={isManual}
                        leafType={row.leafType}
                        value={isManual ? (resolution as { type: "manual"; value: any }).value : row.after}
                        onChange={handleManual}
                    />
                )}
            </Box>
        </Box>
    );
});

function ChooserOption({
    selected, label, icon, value, muted, onClick,
}: {
    selected: boolean;
    label: string;
    icon: any;
    value: string;
    muted?: boolean;
    onClick: () => void;
}) {
    return (
        <Box
            as="button"
            onClick={onClick}
            border="1px solid"
            borderColor={selected ? "border.brand" : "border.subtle"}
            borderRadius="md"
            px="12px"
            py="10px"
            bg={selected ? "bg.brand.subtle" : "bg.surface"}
            cursor="pointer"
            textAlign="left"
            transition="border-color 100ms ease"
            _hover={{ borderColor: selected ? "border.brand" : "border.strong" }}
        >
            <Box
                fontFamily="mono"
                fontSize="10px"
                textTransform="uppercase"
                letterSpacing="0.06em"
                color="fg.muted"
                mb="6px"
            >
                <FontAwesomeIcon icon={icon} /> {label}
            </Box>
            <Box
                fontFamily="mono"
                fontSize="13px"
                fontWeight={600}
                color={muted ? "fg.muted" : "fg"}
            >
                {value}
            </Box>
        </Box>
    );
}

// =============================================================================
// Manual conflict editor — primitive leaves get an inline input that produces
// a typed `Resolution.manual.value`. Container leaves (Struct/Array/…) and
// "valueless" primitives (Null/Blob) don't support manual entry — the
// caller hides the Manual chooser entirely.
// =============================================================================

function ManualOption({
    selected, leafType, value, onChange,
}: {
    selected: boolean;
    leafType: EastTypeValue | null;
    value: any;
    onChange: (next: any) => void;
}) {
    return (
        <Box
            border="1px solid"
            borderColor={selected ? "border.brand" : "border.subtle"}
            borderRadius="md"
            px="12px"
            py="10px"
            bg={selected ? "bg.brand.subtle" : "bg.surface"}
            cursor="text"
            textAlign="left"
            transition="border-color 100ms ease"
            _hover={{ borderColor: selected ? "border.brand" : "border.strong" }}
        >
            <Box
                fontFamily="mono"
                fontSize="10px"
                textTransform="uppercase"
                letterSpacing="0.06em"
                color="fg.muted"
                mb="6px"
            >
                <FontAwesomeIcon icon={faPen} /> Manual
            </Box>
            <ManualEditor leafType={leafType} value={value} onChange={onChange} />
        </Box>
    );
}

function ManualEditor({
    leafType, value, onChange,
}: {
    leafType: EastTypeValue | null;
    value: any;
    onChange: (next: any) => void;
}) {
    const [draft, setDraft] = useState<string>(() => formatManualDraft(leafType, value));
    // Sync if the upstream selected value changes externally (e.g. user
    // clicks Keep yours then comes back to Manual).
    useEffect(() => {
        setDraft(formatManualDraft(leafType, value));
    }, [leafType, value]);

    const fire = useCallback((parsed: any) => {
        queueMicrotask(() => onChange(parsed));
    }, [onChange]);

    if (!leafType) return null;

    if (leafType.type === "Boolean") {
        const checked = !!value;
        return (
            <Box
                as="button"
                onClick={() => fire(!checked)}
                fontFamily="mono"
                fontSize="13px"
                fontWeight={600}
                color="fg"
                bg="transparent"
                border="0"
                cursor="pointer"
                textAlign="left"
            >
                <FontAwesomeIcon icon={checked ? faCheck : faXmark} /> {checked ? "true" : "false"}
            </Box>
        );
    }

    if (leafType.type === "Integer" || leafType.type === "Float" || leafType.type === "String") {
        const inputType = leafType.type === "String" ? "text" : "number";
        return (
            <ChakraInput
                value={draft}
                type={inputType}
                size="sm"
                fontFamily="mono"
                fontSize="13px"
                onChange={e => {
                    const next = e.target.value;
                    setDraft(next);
                    const parsed = parseManualDraft(leafType, next);
                    if (parsed.ok) fire(parsed.value);
                }}
            />
        );
    }

    if (leafType.type === "DateTime") {
        // ISO string — keep simple: text input that parses to a Date.
        return (
            <ChakraInput
                value={draft}
                type="datetime-local"
                size="sm"
                fontFamily="mono"
                fontSize="13px"
                onChange={e => {
                    const next = e.target.value;
                    setDraft(next);
                    const parsed = parseManualDraft(leafType, next);
                    if (parsed.ok) fire(parsed.value);
                }}
            />
        );
    }

    return null;
}

// =============================================================================
// Recursive node renderer — walks the DiffNode tree, indenting per depth.
// =============================================================================

interface NodeRenderProps {
    node: DiffNode;
    depth: number;
    binding: BindingState;
    /** Whether per-leaf and per-group Discard buttons render. False ⇒ read-only. */
    interactive: boolean;
    inConflictMode: boolean;
    conflicts: { pathStr: string; conflict: Conflict }[] | null;
    resolutions: ReadonlyMap<string, Resolution>;
    /** Stable handlers — receive bindingPath + leafPath so leaf children
     *  can be memoised without per-render closure churn. */
    discardLeaf: (pathStr: string, leafPath: string) => void;
    discardSubtree: (pathStr: string, leafPaths: string[]) => void;
    setResolution: (pathStr: string, conflictPath: string, r: Resolution) => void;
    metrics: DensityMetrics;
}

const NodeRender = memo(function NodeRender(props: NodeRenderProps) {
    const { node, depth, binding, interactive,
        inConflictMode, conflicts, resolutions,
        discardLeaf, discardSubtree, setResolution, metrics } = props;

    if (node.kind === "leaf") {
        const isConflict = inConflictMode && !!conflicts?.some(
            c => c.pathStr === binding.pathStr && c.conflict.path === node.path,
        );
        if (isConflict) {
            // Conflict UI fires for `apply-buffer-to-source` (the staged
            // 3-way merge case). Other commit kinds don't carry a separate
            // serverPatch.
            const serverLeaf = binding.mode.kind === "apply-buffer-to-source"
                ? binding.mode.serverLeavesByPath?.get(node.path)
                : undefined;
            return (
                <ConflictRow
                    row={node}
                    depth={depth}
                    bindingPathStr={binding.pathStr}
                    serverValue={serverLeaf?.after}
                    resolution={resolutions.get(rowKey(binding.pathStr, node.path))}
                    onResolve={setResolution}
                    metrics={metrics}
                />
            );
        }
        return (
            <DiffRow
                row={node}
                depth={depth}
                bindingPathStr={binding.pathStr}
                showActions={interactive}
                onDiscard={discardLeaf}
                metrics={metrics}
            />
        );
    }

    // Group node.
    return (
        <>
            <GroupHeader
                node={node}
                depth={depth}
                bindingPathStr={binding.pathStr}
                showActions={interactive}
                onDiscardAll={discardSubtree}
                metrics={metrics}
            />
            {node.children.map(child => (
                <NodeRender
                    key={child.path || `${child.kind}:${child.label}`}
                    {...props}
                    node={child}
                    depth={depth + 1}
                />
            ))}
        </>
    );
});

interface GroupHeaderProps {
    node: GroupNode;
    depth: number;
    bindingPathStr: string;
    showActions: boolean;
    /** Stable handler — receives the binding's pathStr and the precomputed
     *  subtreeLeafPaths (from `node.subtreeLeafPaths`). */
    onDiscardAll: (bindingPathStr: string, leafPaths: string[]) => void;
    metrics: DensityMetrics;
}

const GroupHeader = memo(function GroupHeader({ node, depth, bindingPathStr, showActions, onDiscardAll, metrics }: GroupHeaderProps) {
    const eyebrow = useSlotRecipe({ key: "eyebrowRow" });
    const es = eyebrow({});
    const handleDiscardAll = useCallback(
        () => onDiscardAll(bindingPathStr, node.subtreeLeafPaths),
        [onDiscardAll, bindingPathStr, node.subtreeLeafPaths],
    );

    // Depth-0 group = the binding's section header → a full eyebrow-row.
    if (depth === 0) {
        return (
            <Box css={es.root}>
                <Box css={es.lbl}>{node.label}</Box>
                <Box css={es.meta} gap="10px">
                    <Box as="span">{node.leafCount} change{node.leafCount === 1 ? "" : "s"}</Box>
                    {showActions && (
                        <ActionBtn icon={faXmark} title="Discard all changes here" onClick={handleDiscardAll} size={metrics.actionBtnSize} />
                    )}
                </Box>
            </Box>
        );
    }

    // Nested struct/array group → a quieter indented mono label row. No op
    // column: the label sits at the row indent so child leaves (whose icon
    // starts one step further in) read as nested beneath it.
    return (
        <Box
            display="grid"
            gridTemplateColumns="1fr auto"
            alignItems="center"
            px="18px"
            py={metrics.rowPadY}
            pl={`${18 + depth * metrics.indentStep}px`}
            gap="16px"
            borderBottomWidth="1px"
            borderBottomColor="border.subtle"
        >
            <HStack gap="6px" minW={0}>
                <Text as="span" fontFamily="mono" fontSize="11px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="fg.muted" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{node.label}</Text>
                <Text as="span" fontFamily="mono" fontSize="10px" color="fg.subtle">· {node.leafCount}</Text>
            </HStack>
            {showActions && (
                <ActionBtn icon={faXmark} title="Discard all changes here" onClick={handleDiscardAll} size={metrics.actionBtnSize} />
            )}
        </Box>
    );
});

// =============================================================================
// Main component
// =============================================================================

export interface EastChakraDiffProps {
    value: DiffValue;
    storageKey: string;
}

const EastChakraDiff = memo(function EastChakraDiff({ value }: EastChakraDiffProps) {
    const cache = getReactiveDatasetCache();
    const staged = getStagedStore();
    const workspace = cache.getConfig().workspace ?? "";

    // Local state — tracks user choices, separate from server data.
    const [conflicts, setConflicts] = useState<{ pathStr: string; conflict: Conflict }[] | null>(null);
    const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
    const [committing, setCommitting] = useState(false);

    const irBindings = useMemo(
        () => (value.bindings ?? []) as ValueTypeOf<typeof DiffBindingType>[],
        [value.bindings],
    );
    const interactive = !(getOpt(value.readonly) ?? false);
    const onCommittedFn = getOpt(value.onCommitted) as (() => void) | undefined;
    const onDiscardedFn = getOpt(value.onDiscarded) as (() => void) | undefined;
    const density = resolveDensity(value.density);
    const metrics = DENSITY_METRICS[density];

    const eyebrow = useSlotRecipe({ key: "eyebrowRow" });
    const es = eyebrow({});
    const commit = useSlotRecipe({ key: "commitBar" });
    const cs = commit({});

    // Subscribe — every binding's source path always; patch path when present.
    // Both StagedStore and ReactiveDatasetCache may carry the in-flight change,
    // depending on the binding's commit kind.
    const allDatasetPaths = useMemo(() => {
        const paths: TreePath[] = [];
        for (const b of irBindings) {
            paths.push(b.source as TreePath);
            if (b.patch.type === "some") paths.push(b.patch.value as TreePath);
        }
        return paths;
    }, [irBindings]);
    const allSourcePaths = useMemo(
        () => irBindings.map(b => b.source as TreePath),
        [irBindings],
    );
    const stagedVersion = useStagedKeyVersions(workspace, allSourcePaths);
    const datasetVersion = useDatasetKeyVersions(workspace, allDatasetPaths);
    const bindings = useMemo(
        () => deriveBindings(workspace, irBindings),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [workspace, irBindings, stagedVersion, datasetVersion],
    );

    // Clear conflicts/resolutions when the patch shape changes (IR refresh,
    // server moved, or user discarded a leaf in conflict mode). Stale
    // resolutions could otherwise apply to paths that no longer exist.
    useEffect(() => {
        setConflicts(null);
        setResolutions(new Map());
    }, [value, stagedVersion, datasetVersion]);

    // Hide bindings with no leaves — covers the "buffered === snapshot" edge
    // case where StagedStore still holds an entry but the user reverted it.
    const visibleBindings = useMemo(
        () => bindings.filter(b => b.leaves.length > 0),
        [bindings],
    );

    const totalLeaves = useMemo(
        () => visibleBindings.reduce((acc, b) => acc + b.leaves.length, 0),
        [visibleBindings],
    );

    // Handlers ---------------------------------------------------------------

    /** Mutates the staged buffer to revert the listed leaf paths under a
     *  binding. Bridges Diff "discard" actions to {@link StagedStore}: builds
     *  a pruned patch (everything *except* the discarded leaves), applies it
     *  to the snapshot, writes the result as the new buffered value. If the
     *  resulting buffer matches the snapshot, drops the staged entry instead. */
    const discardPaths = useCallback((pathStr: string, leafPaths: string[]) => {
        const b = visibleBindings.find(x => x.pathStr === pathStr);
        if (!b) return;

        // Keep everything *except* the leaves the user discarded.
        const reject = new Set<string>(leafPaths);
        const pruned = prunePatchFor(b.stateType)(b.userPatch, path => !reject.has(pathToString(path)));

        if (b.mode.kind === "apply-patch-to-source") {
            // Patch lives in a sibling e3.input. Write the pruned patch
            // directly to that path. `unchanged` clears it.
            const patchPath = b.mode.patchPath!;
            const patchType = b.mode.patchType!;
            void cache.write(workspace, patchPath, encodeBeast2For(patchType)(pruned));
            return;
        }

        // Staged kinds (apply-buffer-to-source / publish-buffer-to-patch)
        // both keep edits in the StagedStore buffer. Apply the pruned
        // patch to the buffer's basis (snapshot for apply-buffer-to-source,
        // live source for publish-buffer-to-patch) to compute the new
        // buffered value.
        const entry = staged.getEntry(workspace, b.path);
        if (!entry) return;

        if (pruned.type === "unchanged") {
            staged.discard(workspace, b.path);
            return;
        }

        const decode = decodeBeast2For(b.stateType);
        const encode = encodeBeast2For(b.stateType);
        const basisBytes = b.mode.kind === "apply-buffer-to-source"
            ? entry.snapshot
            : (cache.read(workspace, b.path) ?? entry.snapshot);
        const basisVal = decode(basisBytes);
        const newBuffered = applyFor(b.stateType)(basisVal, pruned);
        if (equalFor(b.stateType)(basisVal, newBuffered)) {
            staged.discard(workspace, b.path);
            return;
        }
        staged.write(workspace, b.path, entry.snapshot, encode(newBuffered));
    }, [visibleBindings, staged, workspace, cache]);

    const discardLeaf = useCallback((pathStr: string, leafPath: string) => {
        discardPaths(pathStr, [leafPath]);
    }, [discardPaths]);

    const discardSubtree = useCallback((pathStr: string, leafPaths: string[]) => {
        discardPaths(pathStr, leafPaths);
    }, [discardPaths]);

    const setResolution = useCallback((pathStr: string, conflictPath: string, r: Resolution) => {
        const key = rowKey(pathStr, conflictPath);
        setResolutions(prev => {
            const next = new Map(prev);
            next.set(key, r);
            return next;
        });
    }, []);

    const onApply = useCallback(async () => {
        if (committing) return;
        setCommitting(true);
        try {
            // Per binding: detect conflicts, merge, apply, commit. Discard
            // already mutated the staged buffer, so b.userPatch is clean —
            // no pruning step here.
            const detected: { pathStr: string; conflict: Conflict }[] = [];
            const merges: Array<{ b: BindingState; merged: any }> = [];

            for (const b of visibleBindings) {
                if (b.userPatch.type === "unchanged") {
                    merges.push({ b, merged: variant("unchanged", null) });
                    continue;
                }

                // The 3-way merge tool only fires for `apply-buffer-to-source`
                // — the other commit kinds don't carry a separate snapshot
                // to detect drift against.
                if (b.mode.kind !== "apply-buffer-to-source"
                    || !b.mode.serverPatch
                    || b.mode.serverPatch.type === "unchanged") {
                    merges.push({ b, merged: b.userPatch });
                    continue;
                }

                const serverPatch = b.mode.serverPatch;
                const detector = detectConflictsFor(b.stateType);
                const here = detector(b.userPatch, serverPatch);

                // Try resolving — collect any unresolved into the conflict UI.
                const resolutionsHere = new Map<string, Resolution>();
                for (const c of here) {
                    const r = resolutions.get(rowKey(b.pathStr, c.path));
                    if (r) resolutionsHere.set(c.path, r);
                    else detected.push({ pathStr: b.pathStr, conflict: c });
                }

                if (detected.length === 0) {
                    try {
                        const merged = mergeWithResolutionsFor(b.stateType)(b.userPatch, serverPatch, resolutionsHere);
                        merges.push({ b, merged });
                    } catch (err) {
                        if (err instanceof ConflictError) {
                            for (const c of err.conflicts) {
                                detected.push({ pathStr: b.pathStr, conflict: c });
                            }
                        } else throw err;
                    }
                }
            }

            if (detected.length > 0) {
                setConflicts(detected);
                return; // user must resolve before next Apply attempt.
            }

            // All clean — apply each merged patch + write + clear local state.
            for (const { b, merged } of merges) {
                const decode = decodeBeast2For(b.stateType);
                const encode = encodeBeast2For(b.stateType);

                if (b.mode.kind === "apply-patch-to-source") {
                    // Apply the patch dataset to the source, then clear it.
                    // Both writes go through cache.batch() so subscribers
                    // see a single consistent post-commit state.
                    const patchPath = b.mode.patchPath!;
                    const patchType = b.mode.patchType!;
                    const encodePatch = encodeBeast2For(patchType);
                    if (merged.type === "unchanged") {
                        await cache.write(workspace, patchPath, encodePatch(variant("unchanged", null)));
                        continue;
                    }
                    const sourceBytes = cache.read(workspace, b.path);
                    if (!sourceBytes) continue;
                    const next = applyFor(b.stateType)(decode(sourceBytes), merged);
                    const writes: Promise<void>[] = [];
                    cache.batch(() => {
                        writes.push(cache.write(workspace, b.path, encode(next)));
                        writes.push(cache.write(workspace, patchPath, encodePatch(variant("unchanged", null))));
                    });
                    await Promise.all(writes);
                    continue;
                }

                if (b.mode.kind === "publish-buffer-to-patch") {
                    // Publish: write the merged patch (computed earlier as
                    // diff(source, buffer)) to the patch dataset, drop the
                    // buffer. Source is untouched.
                    const patchPath = b.mode.patchPath!;
                    const patchType = b.mode.patchType!;
                    const encodePatch = encodeBeast2For(patchType);
                    await cache.write(workspace, patchPath, encodePatch(merged));
                    staged.discard(workspace, b.path);
                    continue;
                }

                // commitKind === "apply-buffer-to-source": apply merged
                // (which is the user's patch with conflict resolutions
                // baked in) to the snapshot to compute the new value, then
                // write it to source.
                if (merged.type === "unchanged") {
                    staged.discard(workspace, b.path);
                    continue;
                }
                const snapshot = decode(staged.getEntry(workspace, b.path)!.snapshot);
                const next = applyFor(b.stateType)(snapshot, merged);
                await cache.write(workspace, b.path, encode(next));
                staged.discard(workspace, b.path);
            }

            setConflicts(null);
            setResolutions(new Map());
            if (onCommittedFn) queueMicrotask(() => onCommittedFn());
        } catch (err) {
            console.error("[Diff.onApply] failed during apply:", err);
            throw err;
        } finally {
            setCommitting(false);
        }
    }, [committing, visibleBindings, resolutions, cache, staged, workspace, onCommittedFn]);

    const onDiscardAll = useCallback(() => {
        for (const b of visibleBindings) {
            if (b.mode.kind === "apply-patch-to-source") {
                // Patch lives in a sibling dataset — clear it.
                const patchPath = b.mode.patchPath!;
                const patchType = b.mode.patchType!;
                const encodePatch = encodeBeast2For(patchType);
                void cache.write(workspace, patchPath, encodePatch(variant("unchanged", null)));
            } else {
                // apply-buffer-to-source / publish-buffer-to-patch — both
                // keep the in-flight change in the staged buffer; drop it.
                staged.discard(workspace, b.path);
            }
        }
        setConflicts(null);
        setResolutions(new Map());
        if (onDiscardedFn) queueMicrotask(() => onDiscardedFn());
    }, [visibleBindings, staged, workspace, cache, onDiscardedFn]);

    // Workspace not configured — diagnostic only visible to devs.
    if (!cache.getConfig().workspace) {
        return (
            <Box layerStyle="banner.error" borderRadius="md" p="12px" fontFamily="mono" fontSize="xs">
                Diff renderer requires a configured workspace on the ReactiveDatasetCache.
            </Box>
        );
    }

    // Empty state — no staged edits.
    if (visibleBindings.length === 0) {
        return (
            <Box
                layerStyle="surface.frameless"
                p="28px"
                textAlign="center"
                color="fg.subtle"
                fontFamily="mono"
                fontSize="11px"
                fontWeight="600"
                letterSpacing="0.12em"
                textTransform="uppercase"
            >
                No staged edits to review
            </Box>
        );
    }

    // Render -----------------------------------------------------------------

    const inConflictMode = conflicts !== null && conflicts.length > 0;
    const resolvedCount = inConflictMode
        ? conflicts!.reduce(
            (n, { pathStr, conflict }) => n + (resolutions.has(rowKey(pathStr, conflict.path)) ? 1 : 0),
            0,
        )
        : 0;
    const allConflictsResolved = inConflictMode && resolvedCount === conflicts!.length;

    // Stale leaves — overlay-mode patch ops whose `before` doesn't match the
    // current source. `applyFor` would throw on commit, so block Apply until
    // the user discards or re-edits the stale leaves.
    const staleLeafCount = visibleBindings.reduce(
        (n, b) => n + b.leaves.reduce((m, l) => m + (l.stale ? 1 : 0), 0),
        0,
    );
    const hasStaleLeaves = staleLeafCount > 0;

    return (
        <Box
            layerStyle="surface.frameless"
            fontFamily="body"
        >
            {/* Header — single eyebrow-row: label · counts · status flag. */}
            <Box css={es.root}>
                <Box css={es.lbl}>Pending changes</Box>
                <Box css={es.meta} gap="0">
                    <Box as="span">{visibleBindings.length} staged</Box>
                    <Box as="span" css={es.sep}>·</Box>
                    <Box as="span">{totalLeaves} change{totalLeaves === 1 ? "" : "s"}</Box>
                    <Box as="span" css={es.sep}>·</Box>
                    {inConflictMode
                        ? <StatusFlag tone={allConflictsResolved ? "success" : "danger"} label={allConflictsResolved ? "Ready" : `${conflicts!.length} conflict${conflicts!.length === 1 ? "" : "s"}`} />
                        : hasStaleLeaves
                        ? <StatusFlag tone="warning" label={`${staleLeafCount} stale`} />
                        : <StatusFlag tone="success" label="No conflicts" />}
                </Box>
            </Box>

            {inConflictMode && (
                <Box
                    display="flex"
                    alignItems="center"
                    gap="8px"
                    px="18px"
                    py="10px"
                    bg="warning.subtle"
                    borderBottomWidth="1px"
                    borderBottomColor="border.subtle"
                    fontFamily="mono"
                    fontSize="11px"
                    letterSpacing="0.04em"
                    textTransform="uppercase"
                    color="fg.warning"
                >
                    <FontAwesomeIcon icon={faTriangleExclamation} />
                    Server moved during your edit — resolve {resolvedCount}/{conflicts!.length} before applying.
                </Box>
            )}

            {/* Body */}
            <Box py="4px">
                {visibleBindings.map(b => b.tree && (
                    <NodeRender
                        key={b.pathStr}
                        node={b.tree}
                        depth={0}
                        binding={b}
                        interactive={interactive}
                        inConflictMode={inConflictMode}
                        conflicts={conflicts}
                        resolutions={resolutions}
                        discardLeaf={discardLeaf}
                        discardSubtree={discardSubtree}
                        setResolution={setResolution}
                        metrics={metrics}
                    />
                ))}
            </Box>

            {/* Footer — commit bar (hidden in read-only mode). */}
            {interactive && (() => {
                const applyDisabled = committing
                    || (inConflictMode && !allConflictsResolved)
                    || hasStaleLeaves
                    || totalLeaves === 0;
                const applyLabel = inConflictMode && !allConflictsResolved
                    ? "Resolve conflicts"
                    : `Apply ${totalLeaves} change${totalLeaves === 1 ? "" : "s"}`;
                return (
                    <Box css={cs.root}>
                        <Box css={cs.draft}>
                            {inConflictMode ? (
                                <><Box as="span" css={cs.pending}>{resolvedCount}/{conflicts!.length}</Box> resolved</>
                            ) : hasStaleLeaves ? (
                                <>Apply blocked · <Box as="span" css={cs.pending}>{staleLeafCount} stale</Box></>
                            ) : (
                                <><Box as="span" css={cs.pending}>{totalLeaves} change{totalLeaves === 1 ? "" : "s"}</Box> · clean merge</>
                            )}
                        </Box>
                        <Box css={cs.btnRow}>
                            <Box as="button" css={cs.btnDanger} onClick={onDiscardAll}>
                                Discard all
                            </Box>
                            <Box
                                as="button"
                                css={cs.btnPrimary}
                                aria-disabled={applyDisabled}
                                onClick={applyDisabled ? undefined : onApply}
                                title={hasStaleLeaves ? "Discard or re-edit the stale changes before applying." : undefined}
                            >
                                {applyLabel}
                            </Box>
                        </Box>
                    </Box>
                );
            })()}
        </Box>
    );
}, (prev, next) => diffValueEqual(prev.value, next.value));

function rowKey(pathStr: string, leafPath: string): string {
    return `${pathStr}::${leafPath}`;
}

export { EastChakraDiff };

// =============================================================================
// Side-effect — register the renderer for the Diff extension on module load.
// =============================================================================

implementUIComponent(Diff.Component, EastChakraDiff);
