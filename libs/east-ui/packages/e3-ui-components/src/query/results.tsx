/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The results (#938) — beside the pane, the last run's result
 * (`Query Editor Spec.md` §4.11):
 *
 * - **the band**, at the top, as tall as the pane's tab row, so the two line
 *   up across the builder: the result's controls ({@link resultToolbarItems}),
 *   Table · Tree and Download ▾ with CSV and BEAST2, on the shared toolbar's
 *   row — the band a `Library` holds its search box in;
 * - **the strips**, in flow at the top, edge to edge, each over a rule: the
 *   stale strip — its "Stale" tag, "The query changed after this run.", and
 *   Run again with its keys — while the query differs from the one the result
 *   is of; a run that gave no result, worded by how it ended; and the note
 *   after a download, dismissible;
 * - **the body**: before any run, the empty state; while a run goes, the data
 *   sources it reads over skeleton rows; a result as a Table (east-ui's Table
 *   renderer, over `results-table.ts`'s rows) or as a Value tree (east-ui's
 *   ValueTree renderer, read-only). Rows open as a Table and one value as a
 *   tree; the toolbar's switch overrides it until the next run. A stale
 *   result's body is dashed;
 * - **the footer**: the result's read-outs — its count in words and its
 *   fields, or how many of how many it shows; the run's number, time and
 *   duration, its East type on hover; and each data source it read, with its
 *   hash. Its parts give way as the results narrow.
 *
 * @packageDocumentation
 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Button, CloseButton, Menu as ChakraMenu, Portal, Skeleton, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCircleExclamation, faCircleInfo, faDownload, faSitemap, faTableList } from "@fortawesome/free-solid-svg-icons";
import { describeJqType, fromEastTypeValue, none, some } from "@elaraai/east";
import { ValueTree } from "@elaraai/east-ui";
import { EastChakraTable, EastChakraValueTree, EmptyStateView, Toolbar, type ToolbarItem, type ValueTreeValue } from "@elaraai/east-ui-components";
import { countWords, fieldLabels, shapeWords, type QueryWords } from "./model/words.js";
import { Tip, type Styles } from "./parts.js";
import { resultTable } from "./results-table.js";
import type { RunOutput, RunState } from "./run.js";
import { unwrapRecursive } from "./steps/shape.js";

/** How a result shows: as a Table of its rows, or as a Value tree. */
export type ResultView = "table" | "tree";

/** A download's format. */
export type DownloadFormat = "csv" | "beast2";

/** The fold order of the result's controls in their band: the menu to its icon first, then the switch to its icons. */
const RANK_DOWNLOAD = 25;
const RANK_VIEW = 30;

/** The results narrower than this drop the result's fields; narrower than `TIGHT`, what the run read. */
const NARROW = 600;
const TIGHT = 470;

/** Skeleton rows while a run goes. */
const SKELETON_ROWS = 6;

/**
 * How a result opens: rows — an array, a set or a vector — as a Table, one
 * value as a tree.
 *
 * @param output - the result
 * @returns its view
 */
export function pickedView(output: RunOutput): ResultView {
    const t = unwrapRecursive(output.type);
    return t.type === "Array" || t.type === "Set" || t.type === "Vector" ? "table" : "tree";
}

/** How many rows a result of rows holds; `undefined` for one value. */
function rowCount(output: RunOutput): number | undefined {
    const t = unwrapRecursive(output.type);
    if (t.type === "Array" || t.type === "Vector") return (output.value as readonly unknown[]).length;
    if (t.type === "Set") return (output.value as ReadonlySet<unknown>).size;
    return undefined;
}

/** A size in bytes, in words — `1.4 MB`. */
function byteWords(bytes: bigint, words: QueryWords): string {
    const n = Number(bytes);
    const units = ["B", "KB", "MB", "GB"] as const;
    let unit = 0;
    let value = n;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return words.messages.byteSize({ value: unit === 0 ? words.formatters.number(value) : words.formatters.value(value, undefined), unit: units[unit]! });
}

/** What a run that gave no result says: its title, and the words under it. */
export interface RunFailure {
    readonly title: string;
    readonly message: string;
}

/**
 * Why a run gave no result, in the builder's words (`Query Editor Spec.md`
 * §4.11): the checker's problems; a runtime error or e3's refusal; the time
 * limit; the size limit; a platform function the server lacks; a call that
 * never reached the server, or that the server refused.
 *
 * @param state - the run
 * @param words - the words
 * @returns the banner's title and message; `undefined` for a run that gave a result, or none yet
 */
export function runFailure(state: RunState, words: QueryWords): RunFailure | undefined {
    const m = words.messages;
    if (state.status === "failed") {
        return state.reason === "unreachable" ? { title: m.unreachable(), message: state.message } : { title: m.notRun(), message: state.message };
    }
    if (state.status !== "done" || state.output !== undefined) return undefined;
    const outcome = state.result.outcome;
    switch (outcome.type) {
        case "ok":
            return undefined;
        case "error": {
            const first = outcome.value[0];
            const ran = first !== undefined && (first.code === "runtime" || first.code === "no_value" || first.code === "invalid");
            return { title: ran ? m.notRun() : m.notRunProblems(), message: first?.message ?? "" };
        }
        case "timed_out":
            return { title: m.stoppedAfter({ seconds: words.formatters.number(Number(outcome.value.ms) / 1000) }), message: m.stoppedHint() };
        case "too_large":
            return { title: m.tooLarge(), message: m.tooLargeHint({ bytes: byteWords(outcome.value.bytes, words), limit: byteWords(outcome.value.limit, words) }) };
        case "needs_platform":
            return { title: m.needsPlatform(), message: m.needsPlatformHint({ functions: m.list({ items: outcome.value.functions }) }) };
    }
}

/** The footer's read-outs of a run: its count, its fields, the run's own line and what it read. */
export interface ResultFooter {
    /** The count in words, or the run's state — `10 orders`, `Showing 1–1,000 of 4,210`, `Running…`. */
    readonly count: string;
    /** The rows' fields — `· order, customer, total`. */
    readonly fields: string;
    /** The run's own line — `run #3 · 14:02 · 412 ms`. */
    readonly run: string;
    /** Its East type and multiplicity, on hover. */
    readonly type: string;
    /** What it read — `reads orders #4f2a1c8d · customers #9b07e3a4`. */
    readonly reads: string;
}

/**
 * The footer's read-outs of a run (`Query Editor Spec.md` §4.11).
 *
 * @param state - the run
 * @param words - the words
 * @returns the footer's parts
 */
export function resultFooter(state: RunState, words: QueryWords): ResultFooter {
    const m = words.messages;
    const f = words.formatters;
    const empty = { fields: "", run: "", type: "", reads: "" };
    if (state.status === "idle") return { count: m.noResultYet(), ...empty };
    if (state.status === "running") return { count: m.runningWord(), ...empty };
    const run = m.runLine({ n: f.bare(state.n), time: f.time(state.at), ms: f.bare(state.status === "done" ? Math.round(state.ms) : 0) });
    if (state.status === "failed") return { count: m.noResult(), fields: "", run, type: "", reads: "" };
    const { result, output, plan } = state;
    const reads = m.readsLine({ sources: result.inputs.map(i => ({ name: i.name, hash: i.hash.slice(0, 8) })) });
    const query = result.query.type === "some" ? result.query.value.value : undefined;
    const type = query === undefined ? "" : m.typeHover({
        type: describeJqType(fromEastTypeValue(query.element_type), { maxDepth: 2 }), multiplicity: query.multiplicity.type,
    });
    if (output === undefined) return { count: m.noResult(), fields: "", run, type, reads };
    const shape = plan.shape;
    const n = rowCount(output);
    if (n === undefined) {
        const count = shape !== undefined && shape.kind === "one" ? shapeWords(shape, words) : m.oneValue();
        return { count, fields: "", run, type, reads };
    }
    // Rows cut at the call's most: how many came, and that there are more.
    const shownCount = output.truncated ? m.atLeast({ count: f.number(n) }) : f.number(n);
    const rows = shape?.kind === "rows" && !output.truncated ? countWords(shape, n, words) : m.rowCount({ count: shownCount, n });
    const count = output.total !== undefined ? m.showing({ shown: f.number(n), total: f.number(output.total) }) : rows;
    const fields = shape?.kind === "rows" ? m.givesFields({ fields: fieldLabels(shape) }) : "";
    return { count, fields, run, type, reads };
}

/** Props of {@link QueryResults}. */
export interface QueryResultsProps {
    /** The run. */
    readonly state: RunState;
    /** Whether the query changed after the run that gave the result. */
    readonly stale: boolean;
    /** How the result shows. */
    readonly view: ResultView;
    /** The note after a download, until it is dismissed or the next run. */
    readonly note: string | undefined;
    /** Dismisses the note. */
    readonly onDismissNote: () => void;
    /** Runs the query again. */
    readonly onRunAgain: () => void;
    /** The words. */
    readonly words: QueryWords;
    /** The builder's storage key: the result's renderers keep their state under it. */
    readonly storageKey: string;
    /** The result's controls, for the band ({@link resultToolbarItems}). */
    readonly controls: readonly ToolbarItem[];
}

/**
 * Renders the results — see the module docs.
 *
 * @param props - The run, whether it is stale, the view, the note and the words ({@link QueryResultsProps})
 * @returns The results
 */
export const QueryResults = memo(function QueryResults({ state, stale, view, note, onDismissNote, onRunAgain, words, storageKey, controls }: QueryResultsProps) {
    const m = words.messages;
    const styles = useSlotRecipe({ key: "queryResults" })() as Styles;
    // The band a Library draws over its cards: as tall as the pane's tab row, which it lines up with.
    const band = useSlotRecipe({ key: "library" })() as Styles;
    const live = useSlotRecipe({ key: "status" })({ status: "brand", size: "sm", live: true }) as Styles;
    const rootRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState<"wide" | "narrow" | "tight">("wide");
    useEffect(() => {
        const el = rootRef.current;
        if (el === null || typeof ResizeObserver !== "function") return;
        const observer = new ResizeObserver(() => {
            const w = el.offsetWidth;
            setWidth(w < TIGHT ? "tight" : w < NARROW ? "narrow" : "wide");
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const output = state.status === "done" ? state.output : undefined;
    const failure = runFailure(state, words);
    const footer = resultFooter(state, words);
    const n = state.status === "idle" ? 0 : state.n;
    const table = useMemo(() => (output === undefined || view !== "table" ? undefined : resultTable({ type: output.type, value: output.value }, words)), [output, view, words]);
    const tree = useMemo((): ValueTreeValue | undefined => (output === undefined || view !== "tree" ? undefined : {
        root: ValueTree.materialize(output.type, output.value),
        onEdit: none, onInsert: none, onRemove: none, onTag: none,
        style: some({ height: some("100%"), maxHeight: none, openDepth: some(1n), toolbar: some(false) }),
    }), [output, view]);

    let body: ReactNode;
    if (state.status === "idle") {
        body = (
            <Box css={styles.idle} data-query-results-idle="">
                <EmptyStateView glyph="⏎" title={m.idleTitle()} description={
                    <Box as="ul" css={styles.idleList}>
                        <li>{m.idleChecks()}</li>
                        <li>{m.idleRun()}</li>
                    </Box>
                } />
            </Box>
        );
    } else if (state.status === "running") {
        body = (
            <Box css={styles.running} data-query-results-running="">
                <Box css={styles.runningHead}>
                    <Box as="span" css={live.indicator} aria-hidden />
                    <span>{m.reading({ sources: m.list({ items: state.reads }) })}</span>
                </Box>
                {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                    <Box key={i} css={styles.skeletonRow} aria-hidden>
                        <Skeleton css={styles.skeletonCell} data-width="short" />
                        <Skeleton css={styles.skeletonCell} data-width="long" />
                        <Skeleton css={styles.skeletonCell} data-width="mid" />
                    </Box>
                ))}
            </Box>
        );
    } else if (table !== undefined) {
        body = <EastChakraTable key={n} value={table} storageKey={`${storageKey}.result.table`} />;
    } else if (tree !== undefined) {
        // One storage key per builder, so runs never pile keys up: the tree keeps its expansion across runs, as a dataset's does.
        body = <EastChakraValueTree key={n} value={tree} storageKey={`${storageKey}.result.tree`} />;
    }

    return (
        <Box ref={rootRef} css={styles.root} data-query-results-view={output === undefined ? undefined : view} data-width={width}>
            <Box css={band.toolbar} role="toolbar" aria-label={m.resultControls()} data-slot="toolbar" data-query-results-bar="">
                <Toolbar items={controls} />
            </Box>
            <Box css={styles.banners}>
                {stale && output !== undefined && (
                    <Box css={styles.strip} data-tone="stale" role="status">
                        <Box as="span" css={styles.stripTag}>{m.staleTag()}</Box>
                        <Box as="span" css={styles.stripText}>{m.staleResult()}</Box>
                        <Button size="xs" variant="ghost" colorPalette="brand" css={styles.stripAction} data-query-run-again="" onClick={onRunAgain}>
                            {m.runAgain()}<Box as="span" css={styles.stripKeys}>{m.runKeys()}</Box>
                        </Button>
                    </Box>
                )}
                {failure !== undefined && (
                    <Box css={styles.strip} data-tone="error" role="alert">
                        <Box as="span" css={styles.stripIcon} aria-hidden><FontAwesomeIcon icon={faCircleExclamation} /></Box>
                        <Box css={styles.stripBody}>
                            <Box as="span" css={styles.stripTitle}>{failure.title}</Box>
                            {failure.message !== "" && <Box as="span">{failure.message}</Box>}
                        </Box>
                    </Box>
                )}
                {note !== undefined && (
                    <Box css={styles.strip} data-tone="note" role="status">
                        <Box as="span" css={styles.stripIcon} aria-hidden><FontAwesomeIcon icon={faCircleInfo} /></Box>
                        <Box as="span" css={styles.stripText}>{note}</Box>
                        <CloseButton size="2xs" css={styles.stripAction} onClick={onDismissNote} />
                    </Box>
                )}
            </Box>
            <Box css={styles.body} data-stale={stale && output !== undefined ? "" : undefined}>{body}</Box>
            <Box css={styles.footer} data-query-results-footer="">
                <Box as="span" css={styles.footerCount} data-query-result-count="">{footer.count}</Box>
                {footer.fields !== "" && <Box as="span" css={styles.footerFields} data-query-result-fields="">{footer.fields}</Box>}
                <Box css={styles.footerSpacer} />
                {footer.run !== "" && (
                    <Tip label={footer.type}>
                        <Box as="span" css={styles.footerRun} data-query-result-run="">{footer.run}</Box>
                    </Tip>
                )}
                {footer.reads !== "" && <Box as="span" css={styles.footerReads} data-query-result-reads="">{footer.reads}</Box>}
            </Box>
        </Box>
    );
});

/** What the result's toolbar items show, and do. */
export interface ResultToolbarOptions {
    /** The view shown; `undefined` without a result. */
    readonly view: ResultView | undefined;
    /** The view the run picked. */
    readonly picked: ResultView | undefined;
    /** Shows a view. */
    readonly onView: (view: ResultView) => void;
    /** Downloads the result. */
    readonly onDownload: (format: DownloadFormat) => void;
    /** The words. */
    readonly words: QueryWords;
    /** The `queryBuilder` recipe's styles. */
    readonly styles: Styles;
    /** The `seg` recipe's styles. */
    readonly seg: Styles;
}

/**
 * The result's controls, the items of the results' band (`Query Editor
 * Spec.md` §4.11): **Table · Tree**, the `seg` strip, folding to its icons;
 * and **Download ▾**, a menu of CSV and BEAST2, folding to its icon. Both are
 * off without a result.
 *
 * @param options - The view, the picked view, the downloads and the words ({@link ResultToolbarOptions})
 * @returns The items, in their order along the row
 */
export function resultToolbarItems(options: ResultToolbarOptions): ToolbarItem[] {
    const { view, picked, onView, onDownload, words, styles, seg } = options;
    const m = words.messages;
    const off = view === undefined;
    const views = (iconsOnly: boolean) => (
        <Box css={seg.root} role="group" aria-label={m.resultViewLabel()} data-query-result-view={view}>
            {(["table", "tree"] as const).map((v) => {
                const pressed = v === view;
                const label = m.resultView({ view: v });
                const hover = v === picked ? m.resultViewPicked({ view: v }) : label;
                return (
                    <Tip key={v} label={iconsOnly || v === picked ? hover : ""}>
                        <chakra.button type="button" css={seg.item} data-state={pressed ? "on" : "off"} aria-pressed={pressed} disabled={off}
                            {...(iconsOnly ? { "aria-label": label } : {})} onClick={() => onView(v)}>
                            <Box as="span" css={styles.viewIcon} aria-hidden><FontAwesomeIcon icon={v === "table" ? faTableList : faSitemap} /></Box>
                            {!iconsOnly && <span>{label}</span>}
                        </chakra.button>
                    </Tip>
                );
            })}
        </Box>
    );
    const download = (iconOnly: boolean) => (
        <ChakraMenu.Root positioning={{ placement: "bottom-end" }}>
            <ChakraMenu.Trigger asChild>
                <Button size="sm" variant="outline" disabled={off} data-query-download="" {...(iconOnly ? { "aria-label": m.download() } : {})}>
                    <FontAwesomeIcon icon={faDownload} />{!iconOnly && <>{m.download()}<FontAwesomeIcon icon={faCaretDown} /></>}
                </Button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {(["csv", "beast2"] as const).map((format) => (
                            <ChakraMenu.Item key={format} value={format} data-query-download-format={format} onSelect={() => onDownload(format)}>
                                <Box as="span" css={styles.menuLabel}>{m.downloadFormat({ format })}</Box>
                                <Box as="span" css={styles.menuMeta}>{m.downloadFormatMeta({ format })}</Box>
                            </ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
    return [
        { key: "result-view", side: "end", forms: [views(false), views(true)], rank: RANK_VIEW, version: `${view ?? ""}|${picked ?? ""}` },
        { key: "download", side: "end", forms: [download(false), download(true)], rank: RANK_DOWNLOAD, version: off ? "off" : "on" },
    ];
}

/**
 * A result's file name, from the query's name: lower-cased, every other
 * character a "-" — `top-shipped-orders-2026`.
 *
 * @param name - the query's name
 * @returns the file's name, without its extension
 */
export function resultFileName(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug === "" ? "query-result" : slug;
}

