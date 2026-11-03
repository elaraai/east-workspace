/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's parts on a phone (`Query Builder Phone Spec.md`): the
 * first row ({@link phoneQueryToolbar}, QP1–QP4) — Table · Tree, the count line
 * that opens *This result*, and Run — and the band of one notice over the pane
 * strip ({@link QueryLiveBand}, QP16). *This result* (QP34) is a
 * `SliceEditPopover` in the toolbar, which a phone's frame opens as a view over
 * the builder: the query, what it gives, the run and what it read, how it read
 * them, and its downloads.
 *
 * @packageDocumentation
 */

import { memo, useMemo, useState, type ReactNode } from "react";
import { Box, Button, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCheck, faDownload, faPlay, faSitemap, faTableList, faXmark } from "@fortawesome/free-solid-svg-icons";
import { SliceEditPopover, type ToolbarItem } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { planBadge, planWords, type QueryWords } from "./model/words.js";
import { resultFileName, resultFooter, type DownloadFormat, type ResultView } from "./results.js";
import type { RunState } from "./run.js";

/** The narrowest frame whose Table · Tree says its words (QP2). */
const SEG_WORDS_FROM = 366;

/** What a phone's first row holds, and does. */
export interface PhoneToolbarOptions {
    readonly history: ToolbarItem;
    readonly state: RunState;
    readonly view: ResultView | undefined;
    /** The count of the result kept under a run that gave none (5e). */
    readonly keptCount: string | undefined;
    readonly onView: (view: ResultView) => void;
    /** The result's views this builder offers, in the switch's order: Table · Tree shows only where there are two. */
    readonly views: readonly ResultView[];
    readonly onDownload: (format: DownloadFormat) => void;
    readonly onRun: () => void;
    /** The query's name. */
    readonly name: string;
    /** The builder's width, px. */
    readonly width: number;
    readonly words: QueryWords;
}

/** A run's result, when it gave one. */
const output = (state: RunState) => (state.status === "done" ? state.output : undefined);

/** The first row, one item (QP1). */
const QueryPhoneBar = memo(function QueryPhoneBar({ state, view, keptCount, onView, views, onDownload, onRun, name, width, words }: Omit<PhoneToolbarOptions, "history">) {
    const styles = useSlotStyles("queryPhone");
    const m = words.messages;
    const [open, setOpen] = useState(false);
    const footer = resultFooter(state, words);
    const running = state.status === "running";
    const hasResult = state.status === "done" || state.status === "failed";
    const icons = width < SEG_WORDS_FROM;
    const off = view === undefined;
    // A result read a page at a time is not in the browser to download (#1113).
    const noDownload = off || output(state)?.paged !== undefined;
    const planned = state.status === "idle" ? undefined : state.planned;
    const pieces = state.status === "done" ? state.pieces : undefined;
    const progress = running ? state.progress : undefined;
    const lines = useMemo(() => (planned === undefined ? [] : planWords(planned.explanation, words, { progress, pieces })), [planned, words, progress, pieces]);
    const badge = planned === undefined ? undefined : planBadge(planned, words, { progress, pieces });
    const row = (key: string, text: ReactNode, mono = false) => text === "" ? null : (
        <Box css={styles.resultRow}>
            <Box as="span" css={styles.resultKey}>{key}</Box>
            <Box as="span" css={styles.resultValue} data-mono={mono ? "" : undefined}>{text}</Box>
        </Box>
    );
    const fieldCount = footer.fields === "" ? 0 : footer.fields.split(",").length;
    const givesLine = fieldCount === 0 ? footer.count : `${footer.count} · ${words.formatters.number(fieldCount)} ${fieldCount === 1 ? "field" : "fields"}`;
    const runLine = footer.run.replace(/^run /, "");
    const reads = footer.reads.replace(/^reads /, "").split(" · ").filter((part) => part !== "");
    const countText = state.status === "idle" ? m.notRunYet() : running ? "…" : output(state) === undefined ? keptCount ?? footer.count : footer.count;
    const trigger = (
        <chakra.button type="button" css={styles.countTarget} disabled={!hasResult} data-query-count="" aria-label={hasResult ? m.thisResult() : undefined}>
            <Box as="span" css={styles.count} data-idle={state.status === "idle" ? "" : undefined}>
                <span>{countText}</span>
                {hasResult && <FontAwesomeIcon icon={faCaretDown} aria-hidden />}
            </Box>
        </chakra.button>
    );
    return (
        <Box css={styles.bar} data-query-phone-bar="">
            {views.length > 1 && <Box css={styles.seg} role="group" aria-label={m.resultViewLabel()} data-query-result-view={view}>
                {views.map((v) => (
                    <chakra.button key={v} type="button" css={styles.segItem} data-state={v === view ? "on" : "off"} data-icons={icons ? "" : undefined} aria-pressed={v === view} disabled={off}
                        {...(icons ? { "aria-label": m.resultView({ view: v }) } : {})} onClick={() => onView(v)}>
                        <Box as="span" css={styles.segIcon} aria-hidden><FontAwesomeIcon icon={v === "table" ? faTableList : faSitemap} /></Box>
                        {!icons && <span>{m.resultView({ view: v })}</span>}
                    </chakra.button>
                ))}
            </Box>}
            <SliceEditPopover open={open} onOpenChange={setOpen} trigger={trigger}
                label={<>{m.thisResult()} {footer.run !== "" && <Box as="span" css={styles.viewContext}>{footer.run.split(" · ").slice(0, 2).join(" · ")}</Box>}</>}>
                <Box css={styles.result} data-query-this-result="">
                    <Box css={styles.resultSection}>
                        <Box css={styles.resultHead}>{m.thisResult()}</Box>
                        {row(m.thisResultQuery(), name)}
                        {row(m.thisResultGives(), givesLine)}
                        {row(m.thisResultRun(), runLine, true)}
                        {reads.length > 0 && row(m.thisResultReads(), <>{reads.map((source, i) => <Box as="span" key={i} display="block">{source}</Box>)}</>, true)}
                    </Box>
                    {badge !== undefined && (
                        <Box css={styles.resultSection}>
                            <Box css={styles.resultHead}>{m.planTitle()}</Box>
                            <Box as="ul" css={styles.resultLines} data-query-plan={planned?.kind}>
                                {lines.map((line, i) => <li key={i}>{line.text}{line.code !== undefined && <code>{line.code}</code>}</li>)}
                            </Box>
                        </Box>
                    )}
                    <Box css={styles.resultSection}>
                        <Box css={styles.resultHead}>{m.thisResultDownload()}</Box>
                        <Box css={styles.resultActions}>
                            {(["csv", "beast2"] as const).map((format) => (
                                <Button key={format} size="md" variant="outline" css={styles.resultAction} disabled={noDownload} data-query-download-format={format}
                                    onClick={() => onDownload(format)}><FontAwesomeIcon icon={faDownload} />{m.downloadFormat({ format })}</Button>
                            ))}
                        </Box>
                        <Box css={styles.resultNote}>{m.savedAs({ slug: resultFileName(name) })}</Box>
                    </Box>
                </Box>
            </SliceEditPopover>
            <chakra.button type="button" css={styles.runTarget} aria-busy={running ? true : undefined} data-query-run="" onClick={onRun}>
                <Box as="span" css={styles.run}>
                    {running ? <Box as="span" css={styles.runLive} aria-hidden /> : <Box as="span" css={styles.runIcon} aria-hidden><FontAwesomeIcon icon={faPlay} /></Box>}
                    {m.run()}
                </Box>
            </chakra.button>
        </Box>
    );
});

/**
 * A phone's first row (QP1): the history for the second row, and one item of
 * Table · Tree, the count line and Run.
 *
 * @param options - What the row holds ({@link PhoneToolbarOptions})
 * @returns The items
 */
export function phoneQueryToolbar(options: PhoneToolbarOptions): ToolbarItem[] {
    const { history, ...rest } = options;
    return [history, { key: "query.phone", forms: [null], phone: { form: <QueryPhoneBar {...rest} />, grow: true } }];
}

/** Props of {@link QueryLiveBand}. */
export interface QueryLiveBandProps {
    readonly text: string;
    /** A save's notice, its mark the success ink's. */
    readonly saved: boolean;
    readonly onDismiss: () => void;
    readonly words: QueryWords;
}

/**
 * The band over the pane strip (QP16): one notice until another replaces it or
 * × dismisses it. It describes main, so a pane's view covers it.
 *
 * @param props - The notice ({@link QueryLiveBandProps})
 * @returns The band
 */
export const QueryLiveBand = memo(function QueryLiveBand({ text, saved, onDismiss, words }: QueryLiveBandProps) {
    const styles = useSlotStyles("queryPhone");
    return (
        <Box css={styles.live} role="status" data-footer-live="" data-footer-ambient="" data-query-live="">
            {saved ? <Box as="span" css={styles.liveCheck} aria-hidden><FontAwesomeIcon icon={faCheck} /></Box> : <Box as="span" css={styles.liveDot} aria-hidden />}
            <Box as="span" css={styles.liveText}>{text}</Box>
            <chakra.button type="button" css={styles.liveClose} aria-label={words.messages.dismissNotice()} onClick={onDismiss}><FontAwesomeIcon icon={faXmark} /></chakra.button>
        </Box>
    );
});
