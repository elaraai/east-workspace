/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The jq view's editor (#937) — the Query tab in jq (`Query Editor Spec.md`
 * §4.8): the program as text, filling the tab, with
 *
 * - **a gutter** of line numbers, each with a dot in the tone of the worst
 *   problem starting on its line;
 * - **highlighting** from east's lexer (`lexJq`): a layer of tokens behind a
 *   text field whose text is transparent, each token's kind, the problem it is
 *   part of and the range gone to from the panel set as data attributes the
 *   `jqEditor` recipe colours, underlines and tints;
 * - **completions** from east's `completeJq` after a word character, `.`, `"`
 *   or `$`, and on Ctrl Space: the data sources in plain words, a path's
 *   fields with their types, a variant's `type` and `value`, case names, the
 *   variables bound and the builtins; and the data's values where the builder
 *   already holds a summary of the rows there (#934's cache: the jq view
 *   fetches none). They close when the caret moves, on blur and on ⌘⏎;
 * - **the problems panel**: the check in words, then each of the checker's
 *   diagnostics — its code, where it starts and its sentence — and a note on
 *   each part of the jq that stays a jq step in the visual view. Going to one
 *   selects its range; a fix applies its text edits and puts the caret after
 *   them.
 *
 * Keys: ⌘/Ctrl ⏎ runs (the builder's); Tab inserts two spaces, or takes the
 * completion offered; ↓ ↑ move through the completions, wrapping, ⏎ takes one
 * and Esc closes them. The text is the host's while it is typed, with the
 * browser's own undo; focus leaving the editor is the jq left (`onLeave`), and
 * a fix is a gesture of its own (`onFix`). The completions' measured position
 * is the editor's one inline style.
 *
 * @packageDocumentation
 */

import {
    memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState,
    type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type SyntheticEvent,
} from "react";
import { Box, Button, Kbd, chakra, useSlotRecipe } from "@chakra-ui/react";
import {
    completeJq, lexJq,
    type CheckJqResult, type CompleteJqOptions, type EastType, type JqCompletion, type JqCompletionKind, type JqTokenKind,
} from "@elaraai/east";
import type { QueryMessages } from "./model/messages.js";
import { summaryAt, type Summary, type SummaryCache } from "./model/summaries.js";
import { human, plainKind, plural, type QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import type { PartStyles, Styles } from "./parts.js";
import { JQ_STEP_NOTE, datasetType } from "./steps/check.js";
import { parseSteps } from "./steps/parse.js";
import { singular } from "./steps/shape.js";

/** What Tab inserts without completions open. */
const TAB = "  ";
/** The run of characters a character's width is measured by. */
const MEASURE = "x".repeat(50);
/** The gap between the caret's line and the completions, and the room they keep from the code's edge. */
const GAP = 4;
const INSET = 4;

/** Each completion's glyph, by what it is (`Query Editor Spec.md` §4.8). */
const GLYPH: Readonly<Record<JqCompletionKind, string>> = {
    dataset: "ds", field: ".f", case: "cs", key: "[k]", value: "\"v", variable: "$", builtin: "fn",
};

/** How bad a problem is: an error stops the query running; a warning does not; a note says what a part of the jq is. */
type Severity = "error" | "warning" | "note";
const RANK: Readonly<Record<Severity, number>> = { note: 1, warning: 2, error: 3 };

/** A range of the text: its first offset, and the offset after its last. */
interface Range {
    readonly from: number;
    readonly to: number;
}

/** A fix the panel offers: its label, and the text edits it makes, which do not overlap. */
interface JqFix {
    readonly label: string;
    readonly edits: readonly { readonly from: number; readonly to: number; readonly insert: string }[];
}

/** A problem, as the panel lists it and the code marks it. */
interface JqProblem {
    readonly severity: Severity;
    /** The checker's code; `custom` for a part that stays a jq step. */
    readonly code: string;
    /** The checker's sentence. */
    readonly message: string;
    /** The text it is about, when it is about some, and where that starts: 1-based. */
    readonly range: Range | undefined;
    readonly line: number;
    readonly column: number;
    readonly fixes: readonly JqFix[];
}

/** A run of one token's text on one line, as the highlighting draws it. */
interface Piece {
    readonly text: string;
    readonly kind: JqTokenKind;
    /** The worst problem it is part of. */
    readonly mark: Severity | undefined;
    /** Whether it is in the range gone to. */
    readonly active: boolean;
}

/** The completions open: the range they replace, and the active one. */
interface Completions {
    /** The start of the word being typed. */
    readonly from: number;
    /** The end of the word under the caret. */
    readonly to: number;
    readonly items: readonly JqCompletion[];
    readonly index: number;
}

/** The worse of two severities. */
function worse(a: Severity | undefined, b: Severity): Severity {
    return a === undefined || RANK[b] > RANK[a] ? b : a;
}

/** The 0-based line and column of an offset. */
function positionOf(text: string, offset: number): { line: number; column: number } {
    let line = 0;
    let start = 0;
    for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
        line += 1;
        start = i + 1;
    }
    return { line, column: offset - start };
}

/** The ranges of the parts of the text that stay jq steps in the visual view; none when it is not steps. */
function jqStepRanges(text: string, root: EastType): Range[] {
    const parsed = parseSteps(text, root);
    if ("error" in parsed) return [];
    const jq = new Set(parsed.query.steps.flatMap(s => (s.type === "jq" ? [s.value.id] : [])));
    return parsed.spans.flatMap(s => (jq.has(s.stepId) ? [{ from: s.from, to: s.to }] : []));
}

/** The checker's diagnostics, then a note on each part that stays a jq step. */
function problemsOf(text: string, checked: CheckJqResult, notes: readonly Range[]): JqProblem[] {
    const problems = checked.diagnostics.map((d): JqProblem => {
        const span = d.span.type === "some" ? d.span.value : undefined;
        return {
            severity: d.severity.type === "warning" ? "warning" : "error",
            code: d.code,
            message: d.message,
            range: span === undefined ? undefined : { from: Number(span.offset), to: Number(span.offset + span.length) },
            line: span === undefined ? 0 : Number(span.line),
            column: span === undefined ? 0 : Number(span.column),
            fixes: d.fixes.map(fix => ({
                label: fix.label,
                edits: fix.edits.map(e => ({ from: Number(e.offset), to: Number(e.offset + e.length), insert: e.insert })),
            })),
        };
    });
    for (const note of notes) {
        const { line, column } = positionOf(text, note.from);
        problems.push({ severity: "note", code: "custom", message: JQ_STEP_NOTE, range: note, line: line + 1, column: column + 1, fixes: [] });
    }
    return problems;
}

/**
 * The text as lines of pieces: each token of east's lexer, cut where a
 * problem's range or the range gone to starts or ends, and at line breaks.
 */
function layOut(text: string, marks: readonly (Range & { readonly severity: Severity })[], active: Range | undefined): Piece[][] {
    const cuts = [...new Set([...marks.flatMap(m => [m.from, m.to]), ...(active === undefined ? [] : [active.from, active.to])])].sort((a, b) => a - b);
    const lines: Piece[][] = [[]];
    const push = (from: number, to: number, kind: JqTokenKind): void => {
        let mark: Severity | undefined;
        for (const m of marks) if (m.from < to && m.to > from) mark = worse(mark, m.severity);
        lines[lines.length - 1]!.push({ text: text.slice(from, to), kind, mark, active: active !== undefined && from >= active.from && to <= active.to });
    };
    for (const token of lexJq(text)) {
        let at = token.from;
        for (const cut of [...cuts.filter(c => c > token.from && c < token.to), token.to]) {
            let start = at;
            for (let i = text.indexOf("\n", start); i !== -1 && i < cut; i = text.indexOf("\n", start)) {
                if (i > start) push(start, i, token.kind);
                lines.push([]);
                start = i + 1;
            }
            if (cut > start) push(start, cut, token.kind);
            at = cut;
        }
    }
    return lines;
}

/** A fix's edits applied, and the caret after the last. */
function applyEdits(text: string, edits: JqFix["edits"]): { text: string; caret: number } {
    let out = "";
    let at = 0;
    let caret = 0;
    for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
        out += text.slice(at, edit.from) + edit.insert;
        caret = out.length;
        at = edit.to;
    }
    return { text: out + text.slice(at), caret };
}

/**
 * The summary of the rows at the caret's stage, when the builder holds one:
 * the program before the last pipe outside every bracket, read as steps.
 */
function stageSummary(text: string, caret: number, root: EastType, summaries: JqEditorProps["summaries"]): Summary | undefined {
    let depth = 0;
    let cut = -1;
    for (const token of lexJq(text.slice(0, caret))) {
        if (token.kind === "punctuation") {
            if (token.text === "(" || token.text === "[" || token.text === "{") depth += 1;
            else if (token.text === ")" || token.text === "]" || token.text === "}") depth = Math.max(0, depth - 1);
        } else if (token.kind === "pipe" && depth === 0) cut = token.from;
    }
    if (cut < 0) return undefined;
    const parsed = parseSteps(text.slice(0, cut), root);
    if ("error" in parsed) return undefined;
    const request = summaryAt(parsed.query, parsed.query.steps.length, root);
    return request === undefined ? undefined : summaries.cache.get(request, summaries.hashes);
}

/** The most common values at a path of a summary's rows that start with a prefix. */
function summaryValues(summary: Summary | undefined, path: string, prefix: string): { value: string; count: number }[] {
    const leaf = summary?.leaves.get(path);
    if (leaf === undefined || leaf.values.type !== "some") return [];
    const typed = prefix.toLowerCase();
    return leaf.values.value.filter(v => v.value.toLowerCase().startsWith(typed)).map(v => ({ value: v.value, count: Number(v.n) }));
}

/** The footer's words for a completion: its doc, a builtin's signature, or its label and detail. */
function docOf(item: JqCompletion, m: QueryMessages): string {
    if (item.doc !== undefined && item.doc !== "") return item.doc;
    return item.kind === "builtin" ? item.detail : m.jqCompletionLine({ label: item.label, detail: item.detail });
}

/** Keeps the focus where it is: a press on the completions. */
function keepFocus(event: MouseEvent): void {
    event.preventDefault();
}

/** Props of {@link JqEditor}. */
export interface JqEditorProps {
    /** The jq as typed. */
    readonly text: string;
    /** Its check: east's checker over the root. */
    readonly checked: CheckJqResult;
    /** The root: what completions offer, and what the text is read as steps over. */
    readonly root: QueryRoot;
    /** The builder's summaries: the values completions offer, where one is held. */
    readonly summaries: { readonly cache: SummaryCache; readonly hashes: ReadonlyMap<string, string> };
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
    /** Told each change of the text. */
    readonly onText: (text: string) => void;
    /** Told the focus left the editor: the jq typed, one gesture. */
    readonly onLeave: () => void;
    /** Told a fix taken: the text it makes, and its label — one gesture of its own. */
    readonly onFix: (text: string, label: string) => void;
}

/**
 * Renders the jq view's editor — see the module docs.
 *
 * @param props - The text and its check, the root, the summaries, the words and what it tells ({@link JqEditorProps})
 * @returns The editor
 */
export const JqEditor = memo(function JqEditor({ text, checked, root, summaries, ps, onText, onLeave, onFix }: JqEditorProps) {
    const words: QueryWords = ps.words;
    const m = words.messages;
    const f = words.formatters;
    const jqRecipe = useSlotRecipe({ key: "jqEditor" });
    const popoverRecipe = useSlotRecipe({ key: "popover" });
    const comboboxRecipe = useSlotRecipe({ key: "combobox" });
    const statusRecipe = useSlotRecipe({ key: "status" });
    const jq = useMemo(() => jqRecipe() as Styles, [jqRecipe]);
    const popover = useMemo(() => popoverRecipe() as Styles, [popoverRecipe]);
    const combobox = useMemo(() => comboboxRecipe() as Styles, [comboboxRecipe]);
    const dots = useMemo(() => ({
        error: statusRecipe({ status: "danger", size: "sm" }) as Styles,
        warning: statusRecipe({ status: "warning", size: "sm" }) as Styles,
        note: statusRecipe({ status: "neutral", size: "sm" }) as Styles,
        success: statusRecipe({ status: "success", size: "sm" }) as Styles,
    }), [statusRecipe]);

    const ids = useId();
    const listId = `${ids}-completions`;
    const optionId = (index: number): string => `${ids}-completion-${index}`;
    const scrollerRef = useRef<HTMLDivElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const measureRef = useRef<HTMLSpanElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // ── The problems, the marks they make, and the lines ────────────────
    const notes = useMemo(() => jqStepRanges(text, root.type), [text, root]);
    const problems = useMemo(() => problemsOf(text, checked, notes), [text, checked, notes]);
    const [active, setActive] = useState<Range | undefined>(undefined);
    const marks = useMemo(() => problems.flatMap(p => (p.range === undefined ? []
        : [{ from: p.range.from, to: Math.max(p.range.to, p.range.from + 1), severity: p.severity }])), [problems]);
    const lines = useMemo(() => layOut(text, marks, active), [text, marks, active]);
    const worst = useMemo(() => {
        const byLine = new Map<number, Severity>();
        for (const p of problems) if (p.range !== undefined) byLine.set(p.line - 1, worse(byLine.get(p.line - 1), p.severity));
        return byLine;
    }, [problems]);
    const errors = problems.filter(p => p.severity === "error").length;
    const warnings = problems.filter(p => p.severity === "warning").length;
    const tone = errors > 0 ? "error" : warnings > 0 ? "warning" : "success";

    // ── A character's width, once the fonts are ready ───────────────────
    const [charWidth, setCharWidth] = useState(0);
    useLayoutEffect(() => {
        const measure = (): void => {
            const el = measureRef.current;
            const width = el === null ? 0 : el.getBoundingClientRect().width / MEASURE.length;
            if (width > 0) setCharWidth(width);
        };
        measure();
        let live = true;
        const fonts: FontFaceSet | undefined = measureRef.current?.ownerDocument.fonts;
        void fonts?.ready.then(() => { if (live) measure(); });
        return () => { live = false; };
    }, []);

    // ── Completions ─────────────────────────────────────────────────────
    const [open, setOpen] = useState<Completions | undefined>(undefined);
    // The caret the completions were made at: moving it closes them.
    const caret = useRef(0);
    // The caret to set once a change the editor made has rendered.
    const pending = useRef<number | undefined>(undefined);
    const complete = useCallback((t: string, at: number, forced: boolean): Completions | undefined => {
        if (!forced && !/[\w.$"]$/.test(t.slice(0, at))) return undefined;
        // The values are the summary's of the rows at the caret, read only when a string asks for them.
        let summary: Summary | undefined | null = null;
        const options: CompleteJqOptions = {
            root: true,
            values: (path, prefix) => {
                if (summary === null) summary = stageSummary(t, at, root.type, summaries);
                return summaryValues(summary, path, prefix);
            },
            describeRoot: (name) => {
                const type = datasetType(root.type, name);
                return type === undefined ? undefined : plainKind(type, words, plural(human(singular(name))));
            },
        };
        const found = completeJq(t, at, root.type, options);
        if (found === null || found.items.length === 0) return undefined;
        let to = at;
        while (to < t.length && /\w/.test(t[to]!)) to += 1;
        return { from: found.from, to, items: found.items, index: 0 };
    }, [root, summaries, words]);

    /** Replaces a range of the text, and puts the caret where it belongs once the text renders. */
    const replace = useCallback((from: number, to: number, insert: string, after: number = from + insert.length) => {
        const next = text.slice(0, from) + insert + text.slice(to);
        caret.current = after;
        setOpen(undefined);
        setActive(undefined);
        if (next === text) {
            areaRef.current?.setSelectionRange(after, after);
            return;
        }
        pending.current = after;
        onText(next);
    }, [text, onText]);
    useLayoutEffect(() => {
        const at = pending.current;
        const area = areaRef.current;
        if (at === undefined || area === null) return;
        pending.current = undefined;
        area.focus({ preventScroll: true });
        area.setSelectionRange(at, at);
    }, [text]);

    /** Takes a completion: from the start of the word to its end, its closing quote not doubled. */
    const accept = useCallback((at: Completions, item: JqCompletion) => {
        let insert = item.insert;
        let after = at.from + insert.length;
        if (insert.endsWith("\"") && text[at.to] === "\"") {
            insert = insert.slice(0, -1);
            after = at.from + insert.length + 1;
        }
        replace(at.from, at.to, insert, after);
    }, [text, replace]);

    // ── The text field ──────────────────────────────────────────────────
    const onChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
        const next = event.target.value;
        const at = event.target.selectionStart;
        caret.current = at;
        setActive(undefined);
        setOpen(complete(next, at, false));
        onText(next);
    }, [complete, onText]);
    const onSelect = useCallback((event: SyntheticEvent<HTMLTextAreaElement>) => {
        const at = event.currentTarget.selectionStart;
        if (at === caret.current) return;
        caret.current = at;
        setOpen(undefined);
    }, []);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing) return;
        const area = event.currentTarget;
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            // ⌘⏎ runs: the builder's. The completions close.
            setOpen(undefined);
            return;
        }
        if (event.ctrlKey && (event.key === " " || event.code === "Space")) {
            event.preventDefault();
            caret.current = area.selectionStart;
            setOpen(complete(area.value, area.selectionStart, true));
            return;
        }
        if (open !== undefined) {
            const n = open.items.length;
            switch (event.key) {
                case "ArrowDown":
                case "ArrowUp":
                    event.preventDefault();
                    setOpen({ ...open, index: (open.index + (event.key === "ArrowDown" ? 1 : n - 1)) % n });
                    return;
                case "Enter":
                case "Tab":
                    event.preventDefault();
                    accept(open, open.items[open.index]!);
                    return;
                case "Escape":
                    event.preventDefault();
                    setOpen(undefined);
                    return;
                default:
                    break;
            }
        }
        if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            replace(area.selectionStart, area.selectionEnd, TAB);
        }
    }, [open, complete, accept, replace]);
    const onAreaBlur = useCallback(() => setOpen(undefined), []);
    // The focus leaving the editor — not moving within it — is the jq left.
    const onRootBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        onLeave();
    }, [onLeave]);

    // ── The problems panel ──────────────────────────────────────────────
    const go = useCallback((problem: JqProblem) => {
        const range = problem.range;
        const area = areaRef.current;
        if (range === undefined || area === null) return;
        setActive(range);
        setOpen(undefined);
        caret.current = range.from;
        area.focus({ preventScroll: true });
        area.setSelectionRange(range.from, range.to);
        const row = highlightRef.current?.children[problem.line - 1];
        if (row instanceof HTMLElement && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    }, []);
    const fix = useCallback((taken: JqFix) => {
        const { text: next, caret: after } = applyEdits(text, taken.edits);
        caret.current = after;
        pending.current = after;
        setActive(undefined);
        setOpen(undefined);
        onFix(next, taken.label);
    }, [text, onFix]);

    // ── Where the completions go: under the caret's line, the label over the word ──
    const [place, setPlace] = useState<{ left: number; top: number } | undefined>(undefined);
    const openFrom = open?.from;
    const openIndex = open?.index;
    useLayoutEffect(() => {
        if (openFrom === undefined) {
            setPlace(undefined);
            return;
        }
        const highlight = highlightRef.current;
        const pop = popRef.current;
        if (highlight === null || pop === null) return;
        const { line, column } = positionOf(text, openFrom);
        const row = highlight.children[line];
        const lineTop = row instanceof HTMLElement ? row.offsetTop : 0;
        const lineHeight = row instanceof HTMLElement ? row.offsetHeight : 0;
        const lineLeft = row instanceof HTMLElement ? row.offsetLeft : 0;
        const box = pop.getBoundingClientRect();
        const scale = pop.offsetWidth > 0 && box.width > 0 ? box.width / pop.offsetWidth : 1;
        const label = pop.querySelector<HTMLElement>("[data-label]");
        const shift = label === null ? 0 : (label.getBoundingClientRect().left - box.left) / scale;
        const left = Math.max(INSET, lineLeft + column * charWidth - shift);
        // Below the line; above it when it does not fit below and does above.
        const height = pop.offsetHeight;
        const below = lineTop + lineHeight + GAP;
        const above = lineTop - GAP - height;
        const scroller = scrollerRef.current;
        const flip = scroller !== null && below + height > scroller.scrollTop + scroller.clientHeight && above >= scroller.scrollTop;
        const top = flip ? above : below;
        setPlace(prev => (prev !== undefined && prev.left === left && prev.top === top ? prev : { left, top }));
    }, [openFrom, text, charWidth]);
    // The active completion stays in view, in the list.
    useLayoutEffect(() => {
        const list = listRef.current;
        if (openIndex === undefined || list === null) return;
        const item = list.children[openIndex];
        if (!(item instanceof HTMLElement)) return;
        const top = item.offsetTop;
        const bottom = top + item.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }, [openIndex]);

    const activeItem = open === undefined ? undefined : open.items[open.index];
    const check = dots[tone];
    return (
        <Box css={jq.root} data-query-jq-editor="" onBlur={onRootBlur}>
            <Box ref={scrollerRef} css={jq.editor}>
                <Box css={jq.content}>
                    <Box css={jq.gutter} aria-hidden data-query-jq-gutter="">
                        {lines.map((_, i) => (
                            <Box key={i} css={jq.line}>
                                <Box as="span" css={jq.dot} data-severity={worst.get(i)} />
                                {f.bare(i + 1)}
                            </Box>
                        ))}
                    </Box>
                    <Box css={jq.code}>
                        <Box ref={highlightRef} css={jq.highlight} aria-hidden data-query-jq-highlight="">
                            {lines.map((pieces, i) => (
                                <Box key={i} css={jq.codeLine}>
                                    {pieces.map((p, j) => (
                                        <chakra.span key={j} css={jq.token} data-kind={p.kind} data-mark={p.mark} data-active={p.active ? "" : undefined}>
                                            {p.text}
                                        </chakra.span>
                                    ))}
                                </Box>
                            ))}
                        </Box>
                        <chakra.textarea
                            ref={areaRef}
                            css={jq.input}
                            value={text}
                            wrap="off"
                            aria-label={m.jqLabel()}
                            aria-autocomplete="list"
                            aria-controls={open === undefined ? undefined : listId}
                            aria-activedescendant={open === undefined ? undefined : optionId(open.index)}
                            spellCheck={false}
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            data-query-jq=""
                            onChange={onChange}
                            onKeyDown={onKeyDown}
                            onSelect={onSelect}
                            onBlur={onAreaBlur}
                        />
                        <chakra.span ref={measureRef} css={jq.measure} aria-hidden>{MEASURE}</chakra.span>
                        {open !== undefined && (
                            <Box ref={popRef} css={[popover.content!, jq.completions!]} data-query-completions="" style={place} onMouseDown={keepFocus}>
                                <Box ref={listRef} id={listId} role="listbox" aria-label={m.jqCompletionsLabel()} css={jq.completionList}>
                                    {open.items.map((item, i) => (
                                        <Box
                                            key={`${i}:${item.label}`}
                                            id={optionId(i)}
                                            role="option"
                                            aria-selected={i === open.index}
                                            data-highlighted={i === open.index ? "" : undefined}
                                            data-kind={item.kind}
                                            css={[combobox.item!, jq.completion!]}
                                            onPointerMove={i === open.index ? undefined : () => setOpen({ ...open, index: i })}
                                            onClick={() => accept(open, item)}
                                        >
                                            <chakra.span css={jq.glyph} data-glyph="">{GLYPH[item.kind]}</chakra.span>
                                            <chakra.span css={jq.completionLabel} data-label="">{item.label}</chakra.span>
                                            <chakra.span css={jq.completionDetail} data-detail="" data-warn={item.warn === true ? "" : undefined}>{item.detail}</chakra.span>
                                        </Box>
                                    ))}
                                </Box>
                                <Box css={[popover.footer!, jq.completionFooter!]}>
                                    <chakra.span css={jq.completionDoc} data-doc="">{activeItem === undefined ? "" : docOf(activeItem, m)}</chakra.span>
                                    <Kbd css={jq.completionKeys}>{m.jqCompletionKeys()}</Kbd>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </Box>
            </Box>
            <Box css={jq.problems} data-query-jq-problems="">
                <Box css={jq.summary}>
                    <Box as="span" css={check.root} data-query-jq-check={tone}>
                        <Box as="span" css={check.indicator} aria-hidden />
                        <Box as="span" css={check.label}>{m.jqCheck({ problems: f.number(errors), n: errors, warnings: f.number(warnings), w: warnings })}</Box>
                    </Box>
                    <Box as="span" css={jq.hint}>{m.jqHint()}</Box>
                </Box>
                <Box css={jq.problemList} role="list" aria-label={m.jqProblemsLabel()}>
                    {problems.map((p, i) => (
                        <Box key={i} role="listitem" css={jq.problem} data-severity={p.severity} data-query-jq-problem={p.code}>
                            <Box as="span" css={[dots[p.severity].indicator!, jq.problemDot!]} aria-hidden />
                            <chakra.button type="button" css={jq.problemGo} disabled={p.range === undefined} onClick={() => go(p)}>
                                <Box as="span" css={jq.problemHead}>
                                    <Box as="span" css={jq.problemCode} data-severity={p.severity}>
                                        {m.jqProblemCode({ code: p.code, note: p.severity === "note" })}
                                    </Box>
                                    {p.range !== undefined && (
                                        <Box as="span" css={jq.problemAt}>{m.jqProblemAt({ line: f.bare(p.line), column: f.bare(p.column) })}</Box>
                                    )}
                                </Box>
                                <Box as="span" css={jq.problemMessage}>{p.message}</Box>
                            </chakra.button>
                            {p.fixes.length > 0 && (
                                <Box css={jq.problemFixes}>
                                    {p.fixes.map((fx, j) => (
                                        <Button key={j} size="xs" variant="outline" data-query-jq-fix="" onClick={() => fix(fx)}>{fx.label}</Button>
                                    ))}
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            </Box>
        </Box>
    );
});
