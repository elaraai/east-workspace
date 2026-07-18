/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraDeck` — renderer for the Deck grouped card collection (#359).
 *
 * Every card carries an EXPLICIT status colour from the deck's status
 * registry: a solid saturated status tag (+ matched dot, optionally
 * pulsing), a faint status-tinted face wash and a status-coloured fill
 * bar — so state reads at a glance while the surface stays in the
 * quiet, bordered, shadow-free house style. Status colours are the
 * standard tokens or custom CSS colours; the tint is derived. Metrics
 * render RAW values through the shared {@link ValueFormatType}
 * interpreter (`tickFormatter` — the same code path as chart ticks), so
 * a deck metric and an axis format identically.
 *
 * The VIEW state is an anchored POPOVER CARD on the Chakra popover
 * machine (virtual anchor + Positioner): `onClick` / `onHover` content
 * renders beneath a head INHERITED from the card face. `Deck.Readout`,
 * `Deck.Rows` and `Deck.Note` are the recipe-styled popover-body
 * vocabulary. Filtering and search flow through the SLICE interface
 * (rail cluster + derived-count footer, like Table).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { Box, Popover as ChakraPopover, Portal, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, type IconName } from "@fortawesome/fontawesome-svg-core";
import { faChevronDown, faChevronRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Deck, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useHoverCapable } from "../../contracts/adaptive.js";
import { parseCssSize } from "../../style/parse-size.js";
import { tickFormatter } from "../../charts/spec/index.js";
import { SliceRailCluster } from "../../slice/rail";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";

const deckEqual = equalFor(Deck.Types.Deck);
const readoutEqual = equalFor(Deck.Types.Readout);
const rowsEqual = equalFor(Deck.Types.Rows);
const noteEqual = equalFor(Deck.Types.Note);

/** East Deck value type. */
export type DeckValue = ValueTypeOf<typeof Deck.Types.Deck>;

/** East Deck item value type. */
export type DeckItemValue = ValueTypeOf<typeof Deck.Types.Item>;

/** East Deck readout payload value type. */
export type DeckReadoutValue = ValueTypeOf<typeof Deck.Types.Readout>;

/** East Deck rows payload value type. */
export type DeckRowsValue = ValueTypeOf<typeof Deck.Types.Rows>;

/** East Deck note payload value type. */
export type DeckNoteValue = ValueTypeOf<typeof Deck.Types.Note>;

export interface EastChakraDeckProps {
    value: DeckValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

/** Hover-peek intent delay (ms) — long enough to skip pass-through. */
const PEEK_DELAY = 300;

/** Standard status tokens → their theme colour variables. */
const TOKEN_CSS: Record<string, string> = {
    success: "var(--chakra-colors-status-pos)",
    warning: "var(--chakra-colors-status-warn)",
    danger: "var(--chakra-colors-status-neg)",
    info: "var(--chakra-colors-brand-600)",
    neutral: "var(--chakra-colors-fg-subtle)",
};

interface ResolvedStatus {
    label: string;
    /** The bold indicator colour (tag / dot / fill bar / hover border). */
    color: string;
    /** The faint face wash derived from it. */
    tint: string;
    pulse: boolean;
    hint: string | undefined;
}

/** Resolve a card's status key against the registry. */
function resolveStatus(
    statuses: DeckValue["statuses"],
    key: string | undefined,
): ResolvedStatus | undefined {
    if (key === undefined) return undefined;
    const s = statuses.get(key);
    if (s === undefined) return undefined;
    const color = s.color.type === "token" ? (TOKEN_CSS[s.color.value.type] ?? TOKEN_CSS["neutral"]!) : s.color.value;
    return {
        label: s.label,
        color,
        tint: `color-mix(in srgb, ${color} 8%, var(--chakra-colors-bg-surface))`,
        pulse: s.pulse,
        hint: getSomeorUndefined(s.hint),
    };
}

/** The status CSS vars a status paints onto a card / popover. */
function statusVars(st: ResolvedStatus | undefined): Record<string, string> | undefined {
    return st !== undefined ? { "--dc": st.color, "--dt": st.tint } : undefined;
}

/** A resolved FA solid icon, or undefined for unknown names. */
function solidIcon(name: string | undefined) {
    if (name === undefined) return undefined;
    const def = findIconDefinition({ prefix: "fas", iconName: name as IconName });
    return def ?? undefined;
}

/** Render a scalar (raw value + shared format / pre-rendered text). */
function scalarText(
    value: number | undefined,
    format: ValueTypeOf<typeof Deck.Types.Metric>["format"],
    text: ValueTypeOf<typeof Deck.Types.Metric>["text"],
): string {
    if (value === undefined) return "—";
    const pre = getSomeorUndefined(text);
    if (pre !== undefined) return pre;
    const spec = getSomeorUndefined(format);
    if (spec !== undefined) return tickFormatter(spec, "linear")(value);
    return new Intl.NumberFormat().format(value);
}

/** The solid status tag — the explicit colour indicator. */
function StatusTag({ st, styles }: { st: ResolvedStatus; styles: SlotStyles }) {
    return (
        <Box as="span" css={styles.stag} data-pulse={st.pulse ? "" : undefined}>
            <Box as="span" css={styles.sdot} data-part="sdot" />
            {st.label}
        </Box>
    );
}

// ============================================================================
// Card
// ============================================================================

function DeckCard({ item, st, styles, libStyles, open, activatable, registerEl, onActivate, onHoverStart, onHoverEnd, storageKey }: {
    item: DeckItemValue;
    st: ResolvedStatus | undefined;
    styles: SlotStyles;
    libStyles: SlotStyles;
    open: boolean;
    activatable: boolean;
    registerEl: (key: string, el: HTMLElement | null) => void;
    onActivate: (item: DeckItemValue) => void;
    onHoverStart: (item: DeckItemValue) => void;
    onHoverEnd: () => void;
    storageKey: string;
}) {
    const icon = solidIcon(getSomeorUndefined(item.icon));
    const sublabel = getSomeorUndefined(item.sublabel);
    const face = getSomeorUndefined(item.face);
    const fill = getSomeorUndefined(item.fill);
    const fillPct = fill !== undefined && fill.max > 0
        ? Math.min(100, Math.max(0, (fill.value / fill.max) * 100))
        : 0;

    return (
        <Box
            css={styles.card}
            ref={(el: HTMLElement | null) => registerEl(item.key, el)}
            data-clickable={activatable ? "" : undefined}
            data-filtered={item.filtered ? "" : undefined}
            data-status={st !== undefined ? "" : undefined}
            data-open={open ? "" : undefined}
            style={statusVars(st)}
            onMouseEnter={() => onHoverStart(item)}
            onMouseLeave={onHoverEnd}
            {...(activatable
                ? { role: "button", tabIndex: 0,
                    onClick: () => onActivate(item),
                    onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onActivate(item);
                        }
                    } }
                : {})}
        >
            {icon !== undefined && (
                <Box css={styles.cardIcon}><FontAwesomeIcon icon={icon} /></Box>
            )}
            <Box css={styles.cardBody}>
                <Box css={styles.cardHead}>
                    <Box css={styles.cardId}>
                        <Box as="span" css={styles.cardName}>{item.title}</Box>
                        {sublabel !== undefined && <Box as="span" css={styles.cardSub}>{sublabel}</Box>}
                    </Box>
                    {st !== undefined && <StatusTag st={st} styles={styles} />}
                </Box>
                {item.metrics.length > 0 && (
                    <Box css={styles.metricsRow}>
                        {item.metrics.map((m, i) => {
                            const raw = getSomeorUndefined(m.value);
                            return (
                                <Box key={i} css={styles.metricCell}>
                                    <Box as="span" css={styles.metricK}>{m.label}</Box>
                                    <Box as="span" css={styles.metricV}
                                        data-warn={m.warn ? "" : undefined}
                                        data-muted={raw === undefined ? "" : undefined}>
                                        {scalarText(raw, m.format, m.text)}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
                {item.facts.map((fact, i) => {
                    const v = fact.value;
                    if (v.type === "meter") {
                        const pct = v.value.max > 0 ? Math.min(100, Math.max(0, (v.value.value / v.value.max) * 100)) : 0;
                        const text = getSomeorUndefined(v.value.text);
                        return (
                            <Box key={i} css={libStyles.meter}>
                                <Box css={libStyles.meterTrack}><Box css={libStyles.meterFill} style={{ width: `${pct}%` }} /></Box>
                                {text !== undefined && <Box as="span" css={libStyles.meterText}>{text}</Box>}
                            </Box>
                        );
                    }
                    if (v.type === "chips") {
                        return (
                            <Box key={i} css={libStyles.chips}>
                                {v.value.map((chipText, j) => <Box key={j} as="span" css={libStyles.chip}>{chipText}</Box>)}
                            </Box>
                        );
                    }
                    return <Box key={i} as="span" css={libStyles.dimText}>{v.value}</Box>;
                })}
                {face !== undefined && (
                    <Box css={styles.face}>
                        <EastChakraComponent value={face} storageKey={`${storageKey}.face.${item.key}`} />
                    </Box>
                )}
                {fill !== undefined && (
                    <Box css={styles.fillRow}>
                        <Box css={styles.fillTrack}><Box css={styles.fillBar} style={{ width: `${fillPct}%` }} /></Box>
                        <Box as="span" css={styles.fillPct}>
                            {getSomeorUndefined(fill.text)
                                ?? (getSomeorUndefined(fill.format) !== undefined
                                    ? tickFormatter(getSomeorUndefined(fill.format), "linear")(fill.value)
                                    : `${Math.round(fillPct)}%`)}
                        </Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
}

// ============================================================================
// Popover card (the VIEW state — head inherited from the card face)
// ============================================================================

function DeckPopover({ item, st, body, mode, getAnchorRect, onDismiss, contentRef, styles, storageKey }: {
    item: DeckItemValue;
    st: ResolvedStatus | undefined;
    body: object;
    mode: "click" | "hover";
    getAnchorRect: () => DOMRect | null;
    onDismiss: () => void;
    contentRef: React.MutableRefObject<HTMLDivElement | null> | undefined;
    styles: SlotStyles;
    storageKey: string;
}) {
    const icon = solidIcon(getSomeorUndefined(item.icon));
    const sublabel = getSomeorUndefined(item.sublabel);
    return (
        <ChakraPopover.Root
            open
            onOpenChange={(e: { open: boolean }) => { if (!e.open) onDismiss(); }}
            positioning={{ placement: "right-start", getAnchorRect }}
            autoFocus={mode === "click"}
            modal={false}
        >
            <Portal>
                <ChakraPopover.Positioner>
                    <ChakraPopover.Content
                        css={styles.pop}
                        data-mode={mode}
                        data-status={st !== undefined ? "" : undefined}
                        aria-label={item.title}
                        style={statusVars(st)}
                        {...(contentRef !== undefined ? { ref: contentRef } : {})}
                        onKeyDown={(e: React.KeyboardEvent) => {
                            if (mode === "click" && e.key === "Escape") { e.preventDefault(); onDismiss(); }
                        }}
                    >
                        <Box css={styles.popHead}>
                            {icon !== undefined && (
                                <Box css={styles.cardIcon}><FontAwesomeIcon icon={icon} /></Box>
                            )}
                            <Box css={styles.cardId}>
                                <Box as="span" css={styles.cardName}>{item.title}</Box>
                                {sublabel !== undefined && <Box as="span" css={styles.cardSub}>{sublabel}</Box>}
                            </Box>
                            {st !== undefined && <StatusTag st={st} styles={styles} />}
                            {mode === "click" && (
                                <chakra.button type="button" css={styles.popClose} aria-label="Close"
                                    onClick={onDismiss}>
                                    <FontAwesomeIcon icon={faXmark} />
                                </chakra.button>
                            )}
                        </Box>
                        <Box css={styles.popBody}>
                            <EastChakraComponent value={body as never} storageKey={`${storageKey}.${mode}.${item.key}`} />
                        </Box>
                    </ChakraPopover.Content>
                </ChakraPopover.Positioner>
            </Portal>
        </ChakraPopover.Root>
    );
}

// ============================================================================
// Popover building blocks (Deck.Readout / Deck.Rows / Deck.Note)
// ============================================================================

/**
 * Renders a Deck readout rail — a bordered grid of big mono values.
 *
 * @param props - component props
 * @param props.value - the decoded `Deck.Types.Readout` payload
 * @returns the readout element
 */
export const EastChakraDeckReadout = memo(function EastChakraDeckReadout({ value }: { value: DeckReadoutValue }) {
    const styles = useSlotRecipe({ key: "deck" })() as SlotStyles;
    return (
        <Box css={styles.readout}>
            {value.cells.map((cell, i) => {
                const raw = getSomeorUndefined(cell.value);
                const unit = getSomeorUndefined(cell.unit);
                return (
                    <Box key={i} css={styles.readoutCell}>
                        <Box css={styles.readoutK}>{cell.label}</Box>
                        <Box css={styles.readoutV}
                            data-warn={cell.warn ? "" : undefined}
                            data-muted={raw === undefined ? "" : undefined}>
                            {scalarText(raw, cell.format, cell.text)}
                            {unit !== undefined && <Box as="span" css={styles.readoutU}>{unit}</Box>}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}, (prev, next) => readoutEqual(prev.value, next.value));

/**
 * Renders Deck detail rows — mono-uppercase keys with body-voice values.
 *
 * @param props - component props
 * @param props.value - the decoded `Deck.Types.Rows` payload
 * @returns the rows element
 */
export const EastChakraDeckRows = memo(function EastChakraDeckRows({ value }: { value: DeckRowsValue }) {
    const styles = useSlotRecipe({ key: "deck" })() as SlotStyles;
    return (
        <Box css={styles.drows}>
            {value.rows.map((row, i) => (
                <Box key={i} css={styles.drow}>
                    <Box as="span" css={styles.drowK}>{row.label}</Box>
                    <Box as="span" css={styles.drowV}>{row.value}</Box>
                </Box>
            ))}
        </Box>
    );
}, (prev, next) => rowsEqual(prev.value, next.value));

/**
 * Renders a Deck note — the dashed-top mono footnote.
 *
 * @param props - component props
 * @param props.value - the decoded `Deck.Types.Note` payload
 * @returns the note element
 */
export const EastChakraDeckNote = memo(function EastChakraDeckNote({ value }: { value: DeckNoteValue }) {
    const styles = useSlotRecipe({ key: "deck" })() as SlotStyles;
    return <Box css={styles.note}>{value.text}</Box>;
}, (prev, next) => noteEqual(prev.value, next.value));

// ============================================================================
// Core
// ============================================================================

interface DeckToolbarState {
    groupKey: string | null;
    collapsed: string[];
}

interface DeckGroup {
    label: string;
    summary: string | undefined;
    items: DeckItemValue[];
}

function DeckCore({ value, storageKey }: EastChakraDeckProps) {
    const styles = useSlotRecipe({ key: "deck" })() as SlotStyles;
    const libStyles = useSlotRecipe({ key: "library" })() as SlotStyles;
    const chip = useRecipe({ key: "chip" });

    const groupOptions = value.groupOptions;
    const { state: toolbar, setState: setToolbar } = usePersistedState<DeckToolbarState>(`${storageKey}.toolbar`, {
        groupKey: groupOptions[0]?.key ?? null,
        collapsed: [],
    });

    const setGroup = useCallback((key: string | null) => {
        setToolbar(prev => ({ ...prev, groupKey: key, collapsed: [] }));
    }, [setToolbar]);
    const toggleCollapsed = useCallback((label: string) => {
        setToolbar(prev => ({
            ...prev,
            collapsed: prev.collapsed.includes(label)
                ? prev.collapsed.filter(l => l !== label)
                : [...prev.collapsed, label],
        }));
    }, [setToolbar]);

    // Group items preserving first-appearance order; null group key = flat.
    const groups = useMemo<DeckGroup[]>(() => {
        const groupKey = toolbar.groupKey;
        const summaries = groupKey !== null ? value.groupSummaries.get(groupKey) : undefined;
        const out = new Map<string, DeckGroup>();
        for (const item of value.items) {
            const label = (groupKey !== null ? item.groups.get(groupKey) : undefined) ?? "";
            let entry = out.get(label);
            if (entry === undefined) {
                entry = { label, summary: summaries?.get(label), items: [] };
                out.set(label, entry);
            }
            entry.items.push(item);
        }
        return [...out.values()];
    }, [value.items, value.groupSummaries, toolbar.groupKey]);

    const onCardClickFn = useMemo(() => getSomeorUndefined(value.onCardClick), [value.onCardClick]);
    const onOpenFn = useMemo(() => getSomeorUndefined(value.onOpen), [value.onOpen]);
    const onCloseFn = useMemo(() => getSomeorUndefined(value.onClose), [value.onClose]);
    const statusOf = useCallback(
        (item: DeckItemValue) => resolveStatus(value.statuses, getSomeorUndefined(item.status)),
        [value.statuses]);

    // Card elements — the popover machine's virtual anchor source.
    const cardEls = useRef(new Map<string, HTMLElement>());
    const registerEl = useCallback((key: string, el: HTMLElement | null) => {
        if (el === null) cardEls.current.delete(key);
        else cardEls.current.set(key, el);
    }, []);
    const anchorRectFor = useCallback((key: string) => () => {
        const el = cardEls.current.get(key);
        return el !== undefined ? el.getBoundingClientRect() : null;
    }, []);

    // Click popover — sticky; the machine owns Esc / outside dismissal.
    const [open, setOpen] = useState<string | null>(null);
    const openItem = useMemo(
        () => (open !== null ? value.items.find(i => i.key === open) : undefined),
        [value.items, open]);
    const openBody = openItem !== undefined ? getSomeorUndefined(openItem.detail) : undefined;
    // Idempotent: the machine's dismissal AND the explicit close paths can
    // both fire for one close — onClose must report once.
    const close = useCallback(() => {
        if (open === null) return;
        setOpen(null);
        if (onCloseFn) queueMicrotask(() => { void onCloseFn(); });
    }, [open, onCloseFn]);
    const activate = useCallback((item: DeckItemValue) => {
        if (getSomeorUndefined(item.detail) !== undefined) {
            setOpen(item.key);
            if (onOpenFn) queueMicrotask(() => { void onOpenFn(item.key); });
        }
        if (onCardClickFn) queueMicrotask(() => onCardClickFn(item.key));
    }, [onOpenFn, onCardClickFn]);
    // Outside-dismissal fallback alongside the machine's interact-outside
    // (harmless double-fire — close is idempotent).
    const popContentRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (open === null) return;
        const onDown = (e: Event) => {
            const content = popContentRef.current;
            if (content !== null && !content.contains(e.target as Node)) close();
        };
        document.addEventListener("pointerdown", onDown);
        return () => document.removeEventListener("pointerdown", onDown);
    }, [open, close]);

    // Hover peek — hover-capable pointers only; delayed to skip pass-through.
    const hoverCapable = useHoverCapable();
    const [peek, setPeek] = useState<string | null>(null);
    const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hoverStart = useCallback((item: DeckItemValue) => {
        if (!hoverCapable || getSomeorUndefined(item.hover) === undefined) return;
        if (peekTimer.current !== null) clearTimeout(peekTimer.current);
        peekTimer.current = setTimeout(() => { setPeek(item.key); }, PEEK_DELAY);
    }, [hoverCapable]);
    const hoverEnd = useCallback(() => {
        if (peekTimer.current !== null) clearTimeout(peekTimer.current);
        peekTimer.current = null;
        setPeek(null);
    }, []);
    useEffect(() => () => { if (peekTimer.current !== null) clearTimeout(peekTimer.current); }, []);
    const peekItem = useMemo(
        () => (peek !== null ? value.items.find(i => i.key === peek) : undefined),
        [value.items, peek]);
    const peekBody = peekItem !== undefined ? getSomeorUndefined(peekItem.hover) : undefined;

    const layout = getSomeorUndefined(value.layout)?.type ?? "grid";
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const height = parseCssSize(style ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined);
    const minCardWidth = parseCssSize(style ? getSomeorUndefined(style.minCardWidth) : undefined) ?? "240px";
    const scrollable = height !== undefined || maxHeight !== undefined;

    return (
        <Box
            css={styles.root}
            data-scrollable={scrollable ? "" : undefined}
            style={{
                ...(height !== undefined ? { height } : {}),
                ...(maxHeight !== undefined ? { maxHeight } : {}),
            }}
        >
            {groupOptions.length > 0 && (
                <Box css={styles.toolbar}>
                    <Box css={styles.segGroup}>
                        <Box as="span" css={styles.segLabel}>Group by</Box>
                        {[...groupOptions, { key: null as string | null, label: "None" }].map(g => (
                            <Box
                                key={g.key ?? "∅"}
                                as="button"
                                css={{ ...chip({ tone: toolbar.groupKey === g.key ? "brand" : "neutral", size: "sm" }), cursor: "pointer" }}
                                onClick={() => setGroup(g.key)}
                            >
                                {g.label}
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}
            <Box css={styles.body} data-scrollable={scrollable ? "" : undefined}>
                {groups.map(group => {
                    const collapsed = toolbar.collapsed.includes(group.label);
                    // Group heads pick up the registry swatch + hint when
                    // grouping BY the status accessor.
                    const groupSt = resolveStatus(value.statuses, group.label !== "" ? group.label : undefined);
                    return (
                        <Box key={group.label || "∅"} css={styles.group}>
                            {group.label !== "" && (
                                <Box
                                    as="button"
                                    css={styles.groupHead}
                                    aria-expanded={!collapsed}
                                    onClick={() => toggleCollapsed(group.label)}
                                >
                                    <Box as="span" css={styles.groupChevron}>
                                        <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} />
                                    </Box>
                                    {groupSt !== undefined && (
                                        <Box as="span" css={styles.groupSwatch} style={{ background: groupSt.color }} />
                                    )}
                                    <Box as="span" css={styles.groupLabel}>{groupSt?.label ?? group.label}</Box>
                                    <Box as="span" css={styles.groupCount}>{group.items.length}</Box>
                                    {(group.summary ?? groupSt?.hint) !== undefined && (
                                        <Box as="span" css={styles.groupSummary}>{group.summary ?? groupSt?.hint}</Box>
                                    )}
                                </Box>
                            )}
                            {!collapsed && (
                                <Box
                                    css={layout === "list" ? styles.list : styles.grid}
                                    style={layout === "grid" ? { gridTemplateColumns: `repeat(auto-fill, minmax(min(${minCardWidth}, 100%), 1fr))` } : undefined}
                                >
                                    {group.items.map(item => (
                                        <DeckCard
                                            key={item.key}
                                            item={item}
                                            st={statusOf(item)}
                                            styles={styles}
                                            libStyles={libStyles}
                                            open={open === item.key}
                                            activatable={onCardClickFn !== undefined || getSomeorUndefined(item.detail) !== undefined}
                                            registerEl={registerEl}
                                            onActivate={activate}
                                            onHoverStart={hoverStart}
                                            onHoverEnd={hoverEnd}
                                            storageKey={storageKey}
                                        />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    );
                })}
            </Box>
            {value.footer.length > 0 && (
                <Box css={styles.footRow}>
                    {value.footer.map((f, i) => (
                        <Fragment key={i}>
                            {i > 0 && <Box as="span" css={styles.footSep}>·</Box>}
                            <Box as="span" css={styles.footK}>{f.label}</Box>
                            <Box as="span" css={styles.footV}>{f.value}</Box>
                        </Fragment>
                    ))}
                </Box>
            )}
            {value.legend && value.statuses.size > 0 && (
                <Box css={styles.legend}>
                    {[...value.statuses.keys()].map(key => {
                        const st = resolveStatus(value.statuses, key);
                        if (st === undefined) return null;
                        return (
                            <Box key={key} css={styles.legendItem}>
                                <Box as="span" css={styles.legendSw} style={{ background: st.color }} />
                                <Box as="span" css={styles.legendLb}>{st.label}</Box>
                                {st.hint !== undefined && <Box as="span" css={styles.legendDs}>{st.hint}</Box>}
                            </Box>
                        );
                    })}
                </Box>
            )}
            {peekItem !== undefined && peekBody !== undefined && peek !== null && open === null && (
                <DeckPopover
                    item={peekItem} st={statusOf(peekItem)} body={peekBody} mode="hover"
                    getAnchorRect={anchorRectFor(peekItem.key)} onDismiss={hoverEnd}
                    contentRef={undefined} styles={styles} storageKey={storageKey}
                />
            )}
            {openItem !== undefined && openBody !== undefined && open !== null && (
                <DeckPopover
                    item={openItem} st={statusOf(openItem)} body={openBody} mode="click"
                    getAnchorRect={anchorRectFor(openItem.key)} onDismiss={close}
                    contentRef={popContentRef} styles={styles} storageKey={storageKey}
                />
            )}
        </Box>
    );
}

// ============================================================================
// Slice wrapper
// ============================================================================

/**
 * Renders an East UI Deck value — the grouped card collection. With slice
 * chrome bound, mounts the shared rail cluster + derived-count footer
 * (the Library convention) — filtering and search flow through it.
 */
export const EastChakraDeck = memo(function EastChakraDeck(props: EastChakraDeckProps) {
    const chrome = getSomeorUndefined(props.value.slice as never) as
        { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined;
    const slice = chrome?.slice as ValueTypeOf<typeof SliceInternal.Types.Bind> | undefined;
    useSliceReactivity(slice?.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })() as SlotStyles;
    if (chrome === undefined || slice === undefined) return <DeckCore {...props} />;

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    const affordanceKinds = railAffordanceKinds(configuredKinds, state);
    const total = Number(slice.totalCount() as bigint);
    const result = Number(slice.resultCount() as bigint);
    const pct = total > 0 ? Math.round((1 - result / total) * 100) : 0;

    return (
        <Box css={{ ...frameStyles.root, height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box css={{ ...frameStyles.frameEyebrow, flexShrink: 0 }}>
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            <Box css={{ ...frameStyles.frameBody, flex: "1 1 0%", minHeight: 0, overflow: "hidden" }}>
                <DeckCore {...props} />
            </Box>
            <Box css={{ ...frameStyles.frameFooter, flexShrink: 0 }}>
                <Box as="span" css={frameStyles.frameFooterStat}>{result.toLocaleString()}</Box>
                <Box as="span">{`cards · of ${total.toLocaleString()}`}</Box>
                {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${pct}%`}</Box>}
            </Box>
        </Box>
    );
}, (prev, next) => deckEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
