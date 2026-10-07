/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Toolbar` — one row of chrome, folded by one ladder (#952).
 *
 * Every slice-rail host lays its chrome in one: the Plan's toolbar, the
 * Sheet's, the Table's eyebrow, `Slice.Rail`. A component author lists its
 * items; each has FORMS, widest first, and each fold step (form `i` →
 * `i + 1`) a RANK. The toolbar merges every item's steps into one fold
 * sequence, by rank with ties in item order (`./fold.ts`), and renders the
 * shortest prefix of it whose row fits. Anything an author adds folds with
 * the rest just by being an item — give it forms and a rank.
 *
 * **Nothing is found by trying on screen.** The toolbar measures each form it
 * renders and keeps the width. It chooses from those widths in a layout
 * effect, before the browser paints; a form it has not measured yet is
 * rendered, measured and corrected in the same pre-paint pass. No
 * intermediate configuration is ever painted.
 *
 * **Its configuration is a function of its width.** The row takes its width
 * from its container and every item keeps its own, so nothing the toolbar
 * renders moves the numbers it chooses from. A width change is taken
 * synchronously, from the row's `ResizeObserver`, so the first frame painted
 * at a width is the configuration for that width: no settle timer, no relax
 * to everything live, no ladder answering another. An item's own content
 * moving (a label, a font arriving) is taken on the next frame.
 *
 * An item holding an open overlay (a popover or menu hanging from a trigger
 * inside it) keeps its form, and the row folds around it; so does an item an
 * author marks `held`. An overlay's trigger turns its `data-state` in the
 * overlay's own render, after the toolbar has chosen, so the toolbar watches
 * its triggers' state and chooses again, before paint, when one opens or
 * closes (#1231): a row left folded around an overlay that has closed would
 * not be the configuration for its width.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { chooseFolds, estimateWidth, foldSequence, formsAt, type FoldItem } from "./fold.js";

/** A rank past every slice-rail step (0–7): what an item's steps take unless it names its own. */
export const DEFAULT_RANK = 100;

/** One item of a {@link Toolbar}. */
export interface ToolbarItem {
    /** Its identity in the row — stable across renders. */
    key: string;
    /** The row's start cluster (the default), or its end cluster. */
    side?: "start" | "end" | undefined;
    /** Its forms, widest first. A one-form item never folds; a form that is
     *  `null` (or `false`) hides the item. */
    forms: ReadonlyArray<ReactNode>;
    /** Each fold step's rank — one for every step, or one per step (the step
     *  from form `i` to `i + 1` is `rank[i]`). Lower folds first; defaults to
     *  {@link DEFAULT_RANK}. */
    rank?: number | ReadonlyArray<number> | undefined;
    /** Keep the current form whatever the width — an overlay hangs from the
     *  item. (An open popover or menu inside the item holds it anyway.) */
    held?: boolean | undefined;
    /** Changes when the item's content does: the widths its other forms were
     *  measured at are then forgotten, and measured again when next rendered. */
    version?: unknown;
}

export interface ToolbarProps {
    /** The items, in their order along the row (the end cluster's after the
     *  start's). Falsy entries are skipped, so an item can be listed as
     *  `condition && { … }`. */
    items: ReadonlyArray<ToolbarItem | false | null | undefined>;
    /** The gap between items: `md` 10px, `lg` 12px (the default). */
    gap?: "md" | "lg" | undefined;
}

/** An open overlay inside an item: a Zag popover's or menu's trigger, open. */
const OPEN_OVERLAY = '[data-part="trigger"][data-state="open"]';

/** An overlay's trigger, whose `data-state` says whether it hangs open. */
const OVERLAY_TRIGGER = '[data-part="trigger"]';

/** The most measure-and-choose passes one change may take — each measures a
 *  form it had not, so a real toolbar settles in a few. */
const MAX_PASSES = 32;

/** A form's width is taken as moved past this many CSS px. */
const MOVED_PX = 0.5;

/** What the toolbar has measured of one item. */
interface Measured {
    /** Width by form index, in CSS px. */
    widths: Map<number, number>;
    /** The item's `version` those widths were measured at. */
    version: unknown;
}

const NO_FORMS: ReadonlyMap<string, number> = new Map();

function isItem(it: ToolbarItem | false | null | undefined): it is ToolbarItem {
    return typeof it === "object" && it !== null;
}

function isEmptyForm(form: ReactNode): boolean {
    return form === null || form === undefined || form === false;
}

/** An item's per-step ranks. */
function ranksOf(it: ToolbarItem): number[] {
    const steps = Math.max(0, it.forms.length - 1);
    const r = it.rank;
    if (r === undefined) return Array.from({ length: steps }, () => DEFAULT_RANK);
    if (typeof r === "number") return Array.from({ length: steps }, () => r);
    return Array.from({ length: steps }, (_s, i) => r[i] ?? r[r.length - 1] ?? DEFAULT_RANK);
}

/** An item as the fold model sees it — keeping the form `held`, when it holds one. */
function foldItemOf(it: ToolbarItem, held: number | undefined): FoldItem {
    return { forms: it.forms.length, ranks: ranksOf(it), empty: it.forms.map(isEmptyForm), held };
}

/**
 * Renders one row of items, each in the widest form that lets the row fit —
 * folded by one ladder over every item's steps (see the module doc).
 */
export function Toolbar({ items, gap }: ToolbarProps) {
    const styles = useSlotRecipe({ key: "toolbar" })({ gap });
    const list = items.filter(isItem);
    const [chosen, setChosen] = useState<ReadonlyMap<string, number>>(NO_FORMS);
    // A width change asks for a render; the render's layout effect measures and chooses.
    const [, setTick] = useState(0);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const measured = useRef(new Map<string, Measured>());
    const passes = useRef(0);
    const rowWidth = useRef(0);
    const observer = useRef<ResizeObserver | null>(null);
    const observed = useRef(new Set<Element>());
    const frame = useRef(0);

    const formOf = (it: ToolbarItem): number => Math.min(Math.max(chosen.get(it.key) ?? 0, 0), it.forms.length - 1);

    // The row's width, and an item's own content, as the browser lays them out.
    useLayoutEffect(() => {
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver((entries) => {
            const row = rowRef.current;
            if (row === null) return;
            let rowMoved = false;
            let itemMoved = false;
            for (const entry of entries) {
                if (entry.target === row) {
                    const px = row.getBoundingClientRect().width;
                    if (Math.abs(px - rowWidth.current) > MOVED_PX) rowMoved = true;
                    continue;
                }
                const el = entry.target as HTMLElement;
                const key = el.dataset["toolbarItem"];
                if (key === undefined) continue;
                const known = measured.current.get(key)?.widths.get(Number(el.dataset["toolbarForm"]));
                if (known === undefined || Math.abs(known - el.getBoundingClientRect().width) > MOVED_PX) itemMoved = true;
            }
            // A width change is taken before this frame paints: the frame
            // shows the configuration for the width it is painted at.
            if (rowMoved) flushSync(() => setTick((t) => t + 1));
            // Content moving is taken next frame — changing the row inside
            // the observer's own delivery would leave its notice undelivered.
            else if (itemMoved && frame.current === 0) {
                frame.current = requestAnimationFrame(() => {
                    frame.current = 0;
                    setTick((t) => t + 1);
                });
            }
        });
        observer.current = ro;
        if (rowRef.current !== null) ro.observe(rowRef.current);
        // An overlay opening or closing inside an item moves what holds its
        // form: chosen again before this frame paints, as a width change is.
        const triggers = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => {
            if (records.some((r) => r.target instanceof Element && r.target.matches(OVERLAY_TRIGGER))) flushSync(() => setTick((t) => t + 1));
        });
        if (triggers !== null && rowRef.current !== null) {
            triggers.observe(rowRef.current, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
        }
        const seen = observed.current;
        return () => {
            ro.disconnect();
            triggers?.disconnect();
            observer.current = null;
            seen.clear();
            if (frame.current !== 0) cancelAnimationFrame(frame.current);
            frame.current = 0;
        };
    }, []);

    // Measure what is on screen, and choose: before paint, after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- it runs after EVERY render by design: any render can move what the row draws, so it measures what was drawn. It ends: a pass that changes no form returns, and MAX_PASSES bounds a change.
    useLayoutEffect(() => {
        const row = rowRef.current;
        if (row === null) return;
        const cache = measured.current;
        const keys = new Set(list.map((it) => it.key));
        for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
        for (const it of list) {
            const m = cache.get(it.key);
            if (m === undefined) cache.set(it.key, { widths: new Map(), version: it.version });
            else if (!Object.is(m.version, it.version)) {
                m.widths.clear();
                m.version = it.version;
            }
        }
        const held = new Map<string, number>();
        const onScreen = new Set<Element>();
        for (const el of row.children) {
            if (!(el instanceof HTMLElement)) continue;
            const key = el.dataset["toolbarItem"];
            const m = key !== undefined ? cache.get(key) : undefined;
            if (key === undefined || m === undefined) continue;
            const form = Number(el.dataset["toolbarForm"]);
            const px = el.getBoundingClientRect().width;
            const was = m.widths.get(form);
            // Its content moved: what the other forms measured is not known any more.
            if (was !== undefined && Math.abs(was - px) > MOVED_PX) m.widths.clear();
            m.widths.set(form, px);
            if (el.querySelector(OPEN_OVERLAY) !== null) held.set(key, form);
            onScreen.add(el);
            observer.current?.observe(el);
        }
        for (const el of observed.current) if (!onScreen.has(el)) observer.current?.unobserve(el);
        observed.current = onScreen;
        for (const it of list) if (it.held === true) held.set(it.key, formOf(it));

        const available = row.getBoundingClientRect().width;
        rowWidth.current = available;
        // A row that is not laid out (not in the page yet, or no layout at
        // all) has nothing to fit: it folds nothing.
        if (available <= 0) return;
        const foldItems = list.map((it) => foldItemOf(it, held.get(it.key)));
        const sequence = foldSequence(foldItems);
        const widthOf = (i: number, form: number) => estimateWidth(cache.get(list[i]!.key)!.widths, form);
        const gapPx = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
        const forms = formsAt(foldItems, sequence, chooseFolds(foldItems, sequence, widthOf, available, gapPx));
        if (list.every((it, i) => formOf(it) === forms[i])) {
            passes.current = 0;
            return;
        }
        if (passes.current >= MAX_PASSES) {
            passes.current = 0;
            return;
        }
        passes.current += 1;
        setChosen(new Map(list.map((it, i) => [it.key, forms[i]!] as const)));
    });

    const start = list.filter((it) => it.side !== "end");
    const end = list.filter((it) => it.side === "end");
    // Every item's form of its forms, hidden ones too (`key=form/forms;…`) —
    // what the page says it folded — and the ladder it folds them on, every
    // step in the order it applies (`key>form …`): for the visual invariants
    // to hold a host's fold order to, at any width.
    const state = list.map((it) => `${it.key}=${formOf(it)}/${it.forms.length}`).join(";");
    const ladder = foldSequence(list.map((it) => foldItemOf(it, undefined)))
        .map((step) => `${list[step.item]!.key}>${step.to}`).join(" ");
    let folds = 0;
    const render = (it: ToolbarItem, firstEnd: boolean) => {
        const form = formOf(it);
        folds += form;
        const node = it.forms[form];
        if (isEmptyForm(node)) return null;
        return (
            <Box key={it.key} css={styles.item} data-toolbar-item={it.key} data-toolbar-form={form}
                data-toolbar-end={firstEnd ? "" : undefined}>
                {node}
            </Box>
        );
    };
    const startNodes = start.map((it) => render(it, false));
    let endLed = false;
    const endNodes = end.map((it) => {
        const node = render(it, !endLed);
        if (node !== null) endLed = true;
        return node;
    });
    return (
        <Box ref={rowRef} css={styles.root} data-toolbar="" data-toolbar-folds={folds} data-toolbar-state={state}
            data-toolbar-ladder={ladder}>
            {startNodes}
            {endNodes}
        </Box>
    );
}
