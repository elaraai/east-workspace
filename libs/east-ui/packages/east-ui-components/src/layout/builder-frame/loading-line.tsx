/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The footer's one loading line (#1398, CL3, CL4, CL12) — the same part in
 * every builder's footer rail (`theme/slot-recipes/builder-footer.ts`), in a
 * slot of its own at the rail's trailing end, so the legend never moves as it
 * comes and goes.
 *
 * - **What it says** is the builder's, in its record's noun
 *   ({@link LoadingLineValue}): `Loading work orders 8,301–8,500`,
 *   `Loading 12–18 Mar`, `Filtering work orders…`, `Couldn't read Wed 12 May`
 *   with Retry — and its short form, the shared parts' own words
 *   (`Loading…`, `Filtering…`, `Couldn't read`).
 * - **When it shows** is the builder's one reveal clock
 *   (`useLoadingReveal`): a read in flight shows after 150 ms, and stays at
 *   least 300 ms once shown, its last words kept meanwhile; a failure shows
 *   at once and stays until it is retried. A newer read replaces the words in
 *   place: the slot never empties between two reads.
 * - **How it fits** is the rail's ({@link useFooterFit}): its full text if it
 *   fits whole, else its short form, else its dot alone with its full text
 *   kept for screen readers; a failure keeps "● Retry". No word is ever cut.
 * - **Assistive technology**: the line is a polite live region (`role
 *   status`) whose words change once a load, never a page; its dot, its short
 *   form and the copies the fit measures are `aria-hidden`.
 *
 * A builder's footer marks its legend's items `data-footer-unit` — its hints
 * also `data-footer-hints` on the rail — and the fit cuts them whole
 * (`data-footer-cut`), {@link FooterMore} ending a cut legend.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { loadingMessages } from "../../collections/loading/messages.js";
import { FOOTER_UNFIT, fitFooter, type FooterFit, type FooterFitInput, type LoadingLineForm } from "./footer-fit.js";

type Styles = Record<string, SystemStyleObject>;

/**
 * A line's words: plain text, and what it names — a range, a period — set in
 * the line's strong ink; or plain text alone, as a table whose words set
 * nothing strong gives them.
 */
export type LoadingLineText = string | readonly (string | { readonly strong: string })[];

/** What the footer's line says: a read in flight, or one that failed. */
export type LoadingLineValue =
    | {
        readonly kind: "loading";
        /** Its full text: `Loading work orders 8,301–8,500`, the range strong. */
        readonly text: LoadingLineText;
        /** Its short form: the shared `Loading…`, or `Filtering…` for a narrowing. */
        readonly short: string;
    }
    | {
        readonly kind: "failed";
        /** Its full text: `Couldn't read work orders 8,301–8,500`. */
        readonly text: LoadingLineText;
        /** Its short form, before its Retry: the shared `Couldn't read`. */
        readonly short: string;
        /** Why it failed, when known: the line's title, and heard with its words — never drawn, so the line stays one line (the failed run's own line draws it in place, CL11). */
        readonly reason?: string | undefined;
        /** Asks again. */
        readonly onRetry: () => void;
        /** Its Retry's words: the shared `Retry` unless given. */
        readonly retry?: string | undefined;
    };

/** A line's words as plain text: what the line is called by, and what a screen reader hears. */
export function loadingLineText(text: LoadingLineText): string {
    return typeof text === "string" ? text : text.map((part) => (typeof part === "string" ? part : part.strong)).join("");
}

/** Props of {@link LoadingLine}. */
export interface LoadingLineProps {
    /** What is in flight, or what failed; `undefined` while nothing is. */
    readonly value: LoadingLineValue | undefined;
    /** Whether a read in flight shows yet: the builder's reveal (`useLoadingReveal`). A failure shows whatever it says. */
    readonly shown: boolean;
    /** The form the rail's fit gives it ({@link useFooterFit}). */
    readonly form: LoadingLineForm;
}

/** The line's words, the strong parts in their ink. */
function Words({ text, styles }: { text: LoadingLineText; styles: Styles }) {
    if (typeof text === "string") return <>{text}</>;
    return <>{text.map((part, i) => (typeof part === "string" ? part : <Box key={i} as="b" css={styles.strong}>{part.strong}</Box>))}</>;
}

/** The parts of one form of the line, as the measure lays them out unseen. */
function Form({ form, value, styles, retry }: { form: LoadingLineForm; value: LoadingLineValue; styles: Styles; retry: string }) {
    const failed = value.kind === "failed";
    return (
        <Box as="span" css={styles.form} data-form={form}>
            <Box as="span" css={styles.dot} />
            {form === "full" && <Box as="span"><Words text={value.text} styles={styles} /></Box>}
            {form === "short" && <Box as="span">{value.short}</Box>}
            {failed && form !== "dot" && <Box as="span" css={styles.sep}>·</Box>}
            {failed && <Box as="span" css={styles.retry}>{retry}</Box>}
        </Box>
    );
}

/**
 * The footer's loading line — see the module docs. Place it last in the rail.
 *
 * @param props - What it says, whether it shows yet, and its form
 * @returns The line's slot: an empty live region while nothing shows
 */
export function LoadingLine({ value, shown, form }: LoadingLineProps) {
    const recipe = useSlotRecipe({ key: "builderFooterLine" });
    const styles = useMemo(() => recipe() as Styles, [recipe]);
    // What it said last: kept through the hold once its read has landed (CL4).
    const last = useRef<LoadingLineValue | undefined>(undefined);
    const now = value?.kind === "failed" ? value : shown ? value ?? last.current : undefined;
    last.current = now;
    const retry = now?.kind === "failed" ? now.retry ?? loadingMessages.retry() : loadingMessages.retry();
    if (now === undefined) {
        return <Box as="span" css={styles.root} data-footer-line="" data-idle="" role="status" aria-live="polite" />;
    }
    const failed = now.kind === "failed";
    const reason = failed ? now.reason : undefined;
    return (
        <Box as="span" css={styles.root} data-footer-line="" data-form={form} data-failed={failed ? "" : undefined} role="status" aria-live="polite"
            data-loading-line={now.kind} title={reason}>
            <Box as="span" css={styles.dot} aria-hidden="true" data-line-dot="" />
            <Box as="span" css={styles.text} data-line-text=""><Words text={now.text} styles={styles} /></Box>
            {reason !== undefined && <Box as="span" css={styles.reason} data-line-reason="">{`: ${reason}`}</Box>}
            <Box as="span" css={styles.short} aria-hidden="true" data-line-short="">{now.short}</Box>
            {failed && <Box as="span" css={styles.sep} aria-hidden="true">·</Box>}
            {failed && (
                <chakra.button type="button" css={styles.retry} data-line-retry=""
                    onClick={(event: MouseEvent) => { event.stopPropagation(); now.onRetry(); }}>
                    {retry}
                </chakra.button>
            )}
            <Box as="span" css={styles.measure} aria-hidden="true" data-line-measure="">
                <Form form="full" value={now} styles={styles} retry={retry} />
                <Form form="short" value={now} styles={styles} retry={retry} />
                <Form form="dot" value={now} styles={styles} retry={retry} />
            </Box>
        </Box>
    );
}

/** Props of {@link FooterMore}. */
export interface FooterMoreProps {
    /** Whether the rail's fit cut its legend: `fit.kept` below its units. */
    readonly shown: boolean;
    /** Its words: the shared `…` unless given. */
    readonly children?: ReactNode;
}

/**
 * The "…" that ends a legend the rail's fit cut short — laid out unseen while
 * none is, so the fit measures it whole. Place it after the legend's units.
 *
 * @param props - Whether the legend is cut
 * @returns The mark
 */
export function FooterMore({ shown, children }: FooterMoreProps) {
    const recipe = useSlotRecipe({ key: "builderFooterLine" });
    const styles = useMemo(() => recipe() as Styles, [recipe]);
    return (
        <Box as="span" css={styles.more} data-footer-more="" data-footer-cut={shown ? undefined : ""} aria-hidden="true">
            {children ?? loadingMessages.more()}
        </Box>
    );
}

/**
 * Whether a unit of the rail is cut: the attribute its element takes.
 *
 * @param index - The unit's place among the rail's units
 * @param fit - The rail's fit
 * @returns `""` for a unit the fit cut, `undefined` for one it keeps
 */
export function footerCut(index: number, fit: FooterFit): "" | undefined {
    return index >= fit.kept ? "" : undefined;
}

/** A length a computed style gives, in px. */
function px(value: string): number {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * The rail as the fit reads it: its content width and gap from its computed
 * style, and each of its items' own width — each legend unit, cut or not, at
 * its natural size, the "…", and each of the line's forms as its measure lays
 * it out. An item out of the flow, or not displayed, takes no room.
 *
 * Units are the rail's own items (`data-footer-unit`, a legend's), or run on
 * inside one item of it (`data-footer-units`, the Sheet's hints, each
 * carrying its own separator), with no gap between them but that item's.
 *
 * @param rail - The rail
 * @returns What it is made of
 */
export function measureFooter(rail: HTMLElement): FooterFitInput {
    const view = rail.ownerDocument.defaultView;
    const style = (el: Element) => (view ?? window).getComputedStyle(el);
    const css = style(rail);
    const available = rail.clientWidth - px(css.paddingInlineStart) - px(css.paddingInlineEnd);
    const gap = px(css.columnGap);
    const fixed: number[] = [];
    const units: number[] = [];
    let unitGap = gap;
    let more = 0;
    let line: FooterFitInput["line"];
    let lineCap = 0.64;
    for (const child of rail.children) {
        const width = child.getBoundingClientRect().width;
        if (child.hasAttribute("data-footer-line")) {
            if (child.hasAttribute("data-idle")) continue;
            const formWidth = (form: LoadingLineForm) => child.querySelector(`[data-line-measure] > [data-form="${form}"]`)?.getBoundingClientRect().width ?? 0;
            line = { full: formWidth("full"), short: formWidth("short"), dot: formWidth("dot") };
            const cap = style(child).maxWidth;
            if (cap.endsWith("%")) lineCap = px(cap) / 100;
            continue;
        }
        if (child.hasAttribute("data-footer-more")) { more = width; continue; }
        if (child.hasAttribute("data-footer-unit")) { units.push(width); continue; }
        if (child.hasAttribute("data-footer-units")) {
            for (const unit of child.children) if (unit.hasAttribute("data-footer-unit")) units.push(unit.getBoundingClientRect().width);
            unitGap = px(style(child).columnGap);
            continue;
        }
        const own = style(child);
        if (own.display === "none" || own.position === "absolute" || own.position === "fixed") continue;
        fixed.push(width);
    }
    return { available, gap, fixed, units, unitGap, more, hints: rail.hasAttribute("data-footer-hints"), line, lineCap };
}

/**
 * How a footer rail fits its legend and its loading line on one line (CL3):
 * the rail measured after each render, as it resizes and as fonts arrive, and
 * fitted by `fitFooter` — the units it keeps whole, the "…", the line's form.
 * It moves only when the fit does: what it measures — the items' own widths
 * and the rail's — does not change with the fit, so a measure never loops.
 *
 * @param rail - The rail
 * @returns How it fits: before its first measure, every unit kept and the line whole
 */
export function useFooterFit(rail: RefObject<HTMLElement | null>): FooterFit {
    const [fit, setFit] = useState<FooterFit>(FOOTER_UNFIT);
    const measure = useRef<() => void>(() => {});
    measure.current = () => {
        const el = rail.current;
        if (el === null) return;
        const next = fitFooter(measureFooter(el));
        setFit((was) => (was.kept === next.kept && was.form === next.form ? was : next));
    };
    // After every render: what the rail holds may have moved.
    useLayoutEffect(() => { measure.current(); });
    useLayoutEffect(() => {
        const el = rail.current;
        if (el === null) return undefined;
        const run = () => measure.current();
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(run);
        observer?.observe(el);
        const fonts = el.ownerDocument.fonts as FontFaceSet | undefined;
        fonts?.addEventListener?.("loadingdone", run);
        void fonts?.ready?.then(run, () => undefined);
        return () => {
            observer?.disconnect();
            fonts?.removeEventListener?.("loadingdone", run);
        };
    }, [rail]);
    return fit;
}
