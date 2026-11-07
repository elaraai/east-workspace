/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The inspectors' forms, measured in a real browser (#1220): every field
 * `FieldForm` draws in the Sheet's inspector and in the Plan's, aligned to the
 * pixel. A form is one column — each field's label, control and help line at
 * the form's edge, every control that fills its field as wide as the others,
 * and a Set or Clear at the field's end, clear of its control and centred on
 * its line. A one-line control — a text, a number, a date, a select, a
 * reference, a read-only value — is the design system's Input, 32px (44px on
 * a coarse pointer), whatever its kind; a checkbox's box sits centred on that
 * line, and a tag's chip is the design system's 22px. One rhythm: 16px between fields, a nested struct's among them, and
 * 8px inside a field — from its label to its control, from its control to its
 * help line, from a group's head to its first field. A variant's block (#1549)
 * sits right under its choice, 16px under it and as wide, its fields set in
 * from the choice's start: the block is their column. Nothing runs past the
 * pane's edge or is cut off, and no word breaks across lines where the pane has
 * room for it whole; a changed field's tint stays clear of its neighbours and
 * inside the pane, and so does a focus ring.
 *
 * Read over the Sheet's examples — the machines' upkeep (`sheetUpkeep`, a
 * field of every kind: a machine with every field set, one with its Options
 * empty, a field changed, a row's issue), the workshop's line, a new line with
 * no field given but its notes, band, several rows and nothing selected, and a
 * batch's line and band — over the Plan's print works: one event, several, a
 * press's row and nothing selected, and the overlaps banner (#1198) over a
 * press's row with an overlap and one of its jobs — and over the Flowchart's
 * depot (#1250, #1504): over its records a state, a transition with its
 * evidence, a decision, a lane, several states, nothing selected, a field
 * changed, an end no state stands for and the Issues tab — a chip in its ink —
 * and, read only through the rail's sources, a transition's every field
 * printed — and over the
 * Schematic's data centre floor (#1391): nothing selected, a rack — its own
 * fields, its load's and its position, and on a phone its Connect to… (#1394)
 * — the fibre run and the power feed it is
 * joined to, their ends as Choosers and their sides as tags, a cooling unit's
 * own Details, two racks, an area read only, a field changed, and a rack typed
 * off the floor, listed in Issues — and over the Record's joinery (#1549): a
 * painted piece's finish, its block under its choice and a block in that under
 * its gloss, a stain chosen in its place, and a bare piece's choice alone.
 * Pinned beside main on a desktop, overlaid on a phone — the joinery at both a
 * phone's widths too, its blocks' place being the measure; in both themes,
 * the joinery in one. No screenshot is read: boxes and computed
 * styles, polled until the page is at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test inspector-form`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { visitBuilder } from "./builder-page";
import { openExample, rowId, rowSel } from "./plan-page";
import { DATA_CENTRE, centred, openSchematic, openTab as openLibraryTab, printedRef, screenPoint, sizeTo } from "./schematic-page";

const SHEETS = "e3/sheet/sheet";
const EVENTS = "e3/plan/plan-events";

/** The design system's Input: a one-line control's height (`base-components.md` › Field & forms). */
const LINE = 32;
/** The touch height: every control on a coarse pointer (#346). */
const TOUCH = 44;
/** Between fields. */
const BETWEEN = 16;
/** Inside a field: its label to its control, its control to its help line; a group's head to its first field. */
const INSIDE = 8;
/** A one-line control's text: the design system's body, 13px — 16px on a coarse pointer, under which a phone zooms into a focused field (#346). */
const TYPE = { fine: "13px", coarse: "16px" } as const;
/** The box a tag is typed into: the chips' 12.5px — 16px on a coarse pointer. */
const TAG_TYPE = { fine: "12.5px", coarse: "16px" } as const;
/** A tag's chip: the design system's tag chip (`parts-tag-chip.html`), on any pointer. */
const CHIP = 22;
/** A help line: mono 11px. */
const HELP_TYPE = "11px";

/** The open pane's panel: the end slot's sheet, pinned beside main or floating over it. */
const PANEL = "[data-orientation][data-side][data-surface]";

/**
 * Each word in the pane broken across lines though the pane has room for it
 * whole — a box squeezed narrower than its words, which then stand a letter or
 * two to a line (the Plan's overlaps lines did, beside their times, #1198). A
 * word wider than the pane's own width may break: the pane has no line for it.
 * Evaluated in the page on the pane's slot; an empty list holds.
 */
const brokenWords = (slot: Element, panelSel: string): string[] => {
    const out: string[] = [];
    const panel = slot.querySelector(panelSel) ?? slot;
    const room = panel.getBoundingClientRect().width;
    const ctx = document.createElement("canvas").getContext("2d")!;
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const el = node.parentElement;
        if (el === null || el.getClientRects().length === 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden") continue;
        ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        for (const word of (node.textContent ?? "").matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, word.index);
            range.setEnd(node, word.index + word[0].length);
            const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
            if (lines.size > 1 && ctx.measureText(word[0]).width < room) {
                out.push(`"${word[0]}" stands on ${lines.size} lines, in a ${Math.round(el.getBoundingClientRect().width * 10) / 10}px box`);
            }
        }
    }
    return out;
};

/** What the form measures wrong, read in the page — each a line naming the field and what is out of line — and every
 *  word broken where the pane has room for it ({@link brokenWords}). */
async function formFaults(pane: Locator, coarse: boolean): Promise<string[]> {
    return [...await formLayoutFaults(pane, coarse), ...await pane.evaluate(brokenWords, PANEL)];
}

/** What the form's layout measures wrong, read in the page — each a line naming the field and what is out of line. */
async function formLayoutFaults(pane: Locator, coarse: boolean): Promise<string[]> {
    return pane.evaluate((slot, { coarse, line, touch, between, inside, panelSel, type, tagType, chipHeight, helpType }) => {
        const bad: string[] = [];
        const panel = slot.querySelector(panelSel) ?? slot;
        const P = panel.getBoundingClientRect();
        const H = coarse ? touch : line;
        const T = coarse ? type.coarse : type.fine;
        const TT = coarse ? tagType.coarse : tagType.fine;
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
        const px = (n: number) => `${Math.round(n * 10) / 10}px`;
        const box = (el: Element) => el.getBoundingClientRect();
        const bordered = (el: Element) => {
            const s = getComputedStyle(el);
            return ["Top", "Right", "Bottom", "Left"].every((side) => Number.parseFloat(s[`border${side}Width` as "borderTopWidth"]) > 0 && s[`border${side}Style` as "borderTopStyle"] !== "none");
        };
        // A field's column: the form's — or, a field of the case a variant holds, its block's under the choice (#1549),
        // set in past the block's rule and padding.
        const columnOf = (field: Element, form: Element) => {
            const block = field.closest("[data-field-block]");
            const F = box(form);
            if (block === null || !form.contains(block)) return { left: F.left, right: F.right, width: F.width, edge: "the form's" };
            const K = box(block);
            const s = getComputedStyle(block);
            const left = K.left + Number.parseFloat(s.borderLeftWidth) + Number.parseFloat(s.paddingLeft);
            const right = K.right - Number.parseFloat(s.borderRightWidth) - Number.parseFloat(s.paddingRight);
            return { left, right, width: right - left, edge: "its block's" };
        };
        const forms = [...panel.querySelectorAll("[data-field-form]")];
        if (forms.length === 0) bad.push("the pane shows no form");
        for (const form of forms) {
            const F = box(form);
            if (F.width === 0) { bad.push("a form not laid out"); continue; }
            // ── One rhythm: the form's own items, a variant's block among them, then each group's.
            const items = [...form.children].filter((el) => box(el).height > 0);
            for (let i = 1; i < items.length; i++) {
                const at = items[i]!;
                const gap = box(at).top - box(items[i - 1]!).bottom;
                const part = at.getAttribute("data-field") ?? at.getAttribute("data-field-group") ?? (at.hasAttribute("data-field-block") ? `${at.getAttribute("data-field-block")}'s block` : null);
                if (!near(gap, between)) bad.push(`${part}: ${px(gap)} under the field before it, not ${between}px`);
            }
            for (const group of form.querySelectorAll("[data-field-group]")) {
                const head = group.firstElementChild!;
                const fields = [...group.querySelectorAll("[data-field]")];
                const first = fields[0];
                if (first !== undefined) {
                    const gap = box(first).top - box(head).bottom;
                    if (!near(gap, inside)) bad.push(`${group.getAttribute("data-field-group")}: its first field sits ${px(gap)} under its head, not ${inside}px`);
                }
                for (let i = 1; i < fields.length; i++) {
                    const gap = box(fields[i]!).top - box(fields[i - 1]!).bottom;
                    if (!near(gap, between)) bad.push(`${fields[i]!.getAttribute("data-field")}: ${px(gap)} under the field before it in ${group.getAttribute("data-field-group")}, not ${between}px`);
                }
            }
            for (const field of form.querySelectorAll("[data-field]")) {
                const key = field.getAttribute("data-field")!;
                const editor = field.getAttribute("data-editor")!;
                const B = box(field);
                const root = field.querySelector("[data-scope=field][data-part=root]");
                const label = root?.querySelector(":scope > [data-part=label]") ?? null;
                if (root === null || label === null) { bad.push(`${key}: no field around it`); continue; }
                // The control's line: what the field holds after its label.
                const lineEl = label.nextElementSibling;
                const help = root.querySelector(":scope > [data-part=helper-text]");
                const side = field.querySelector("[data-field-set], [data-field-clear]");
                // ── One column: the form's, or its block's.
                const C = columnOf(field, form);
                if (!near(B.left, C.left) || !near(B.right, C.right)) bad.push(`${key}: the field spans ${px(B.left - C.left)}–${px(B.right - C.left)} of ${C.edge} ${px(C.width)}`);
                for (const [what, el] of [["label", label], ["control", lineEl], ["help line", help]] as const) {
                    if (el === null) continue;
                    if (!near(box(el).left, C.left)) bad.push(`${key}: its ${what} starts ${px(box(el).left - C.left)} in from ${C.edge} edge`);
                }
                if (lineEl === null) { bad.push(`${key}: no control`); continue; }
                const L = box(lineEl);
                // ── Inside a field: 8px from the label to the control, and from the control to its help line.
                const toLine = L.top - box(label).bottom;
                if (!near(toLine, inside)) bad.push(`${key}: its control sits ${px(toLine)} under its label, not ${inside}px`);
                // What the line holds: a checkbox, tags, the host's own control, or one bordered box — a text, a
                // number, a date, a select, a read-only value, a checklist's box, or a field with no value yet.
                const tick = lineEl.querySelector("[data-scope=checkbox][data-part=control]");
                const tagged = lineEl.querySelector("[data-scope=tags-input][data-part=control]");
                // Up to four cases are a radio group (#1473), which has no control's box.
                const radios = lineEl.querySelector("[data-field-choice=radio]");
                const shape = editor === "custom" ? "custom" : tick !== null ? "checkbox" : tagged !== null ? "tags" : radios !== null ? "radio" : "line";
                // The control's bordered box: the tags' own, or the first in the line that is not the Set or Clear.
                const control = shape === "tags" ? tagged
                    : [lineEl, ...lineEl.querySelectorAll("*")].find((el) => bordered(el) && box(el).width > 20 && (side === null || !side.contains(el))) ?? null;
                if (help !== null) {
                    const under = (shape === "line" || shape === "tags") && control !== null ? control : lineEl;
                    const gap = box(help).top - box(under).bottom;
                    if (!near(gap, inside)) bad.push(`${key}: its help line sits ${px(gap)} under its control, not ${inside}px`);
                    const size = getComputedStyle(help).fontSize;
                    if (size !== helpType) bad.push(`${key}: its help line is set in ${size}, not ${helpType}`);
                }
                // ── One height per line, and one type: the text a control holds.
                if (shape === "line") {
                    if (control === null) bad.push(`${key}: no bordered control`);
                    else {
                        if (!near(box(control).height, H)) bad.push(`${key} (${editor}): its control is ${px(box(control).height)} tall, not ${H}px`);
                        const text = control.matches("input, button") ? control : control.querySelector("input, [role=spinbutton]") ?? control;
                        const size = getComputedStyle(text).fontSize;
                        if (size !== T) bad.push(`${key} (${editor}): its text is set in ${size}, not ${T}`);
                    }
                }
                if (shape === "tags" && control !== null) {
                    // One row of chips, or none, is one line; more rows grow it.
                    const rows = new Set([...control.querySelectorAll("[data-part=item], [data-part=input]")].map((c) => Math.round(box(c).top)));
                    if (rows.size <= 1 ? !near(box(control).height, H) : box(control).height < H - 0.5) bad.push(`${key} (tags): its control is ${px(box(control).height)} tall over ${rows.size} rows, not ${H}px`);
                    // Each chip the design system's: a row stands its line whatever its chips' height, so the chips are read too.
                    for (const chip of control.querySelectorAll("[data-part=item-preview]")) {
                        if (!near(box(chip).height, chipHeight)) bad.push(`${key} (tags): its chip "${chip.textContent}" is ${px(box(chip).height)} tall, not ${chipHeight}px`);
                    }
                    const typed = control.querySelector("[data-part=input]");
                    const size = typed === null ? null : getComputedStyle(typed).fontSize;
                    if (size !== null && size !== TT) bad.push(`${key} (tags): its box is set in ${size}, not ${TT}`);
                }
                if (shape === "checkbox") {
                    const T = box(tick!);
                    if (!near(L.height, H)) bad.push(`${key} (checkbox): its line is ${px(L.height)} tall, not ${H}px`);
                    if (!near(T.top + T.height / 2, L.top + L.height / 2)) bad.push(`${key} (checkbox): its box is centred ${px(T.top + T.height / 2 - (L.top + L.height / 2))} off its line`);
                }
                // ── A control that fills its field: from the form's edge to its end, or to its Set or Clear.
                const fills = control !== null && (shape === "line" || shape === "tags");
                if (side !== null) {
                    const S = box(side);
                    const what = side.hasAttribute("data-field-set") ? "Set" : "Clear";
                    if (!near(S.right, C.right)) bad.push(`${key}: its ${what} ends ${px(C.right - S.right)} short of ${C.edge} edge`);
                    const A = fills ? box(control!) : L;
                    if (fills && S.left < A.right + 4 - 0.5) bad.push(`${key}: its ${what} sits ${px(S.left - A.right)} from its control`);
                    const mid = A.top + A.height / 2;
                    if (!near(S.top + S.height / 2, mid)) bad.push(`${key}: its ${what} is centred ${px(S.top + S.height / 2 - mid)} off its control's line`);
                } else if (fills && control !== null && !near(box(control).right, C.right)) {
                    bad.push(`${key} (${editor}): its control ends ${px(C.right - box(control).right)} short of ${C.edge} edge`);
                }
                if (fills && control !== null && !near(box(control).left, C.left)) bad.push(`${key} (${editor}): its control starts ${px(box(control).left - C.left)} in from ${C.edge} edge`);
            }
        }
        // ── Nothing escapes the pane, or is cut off.
        for (const el of panel.querySelectorAll("*")) {
            const s = getComputedStyle(el);
            const b = box(el);
            if (b.width <= 1 || b.height <= 1 || s.visibility === "hidden" || s.clip.startsWith("rect(0")) continue;
            if (b.left < P.left - 0.5 || b.right > P.right + 0.5) {
                const what = el.getAttribute("data-field") ?? el.getAttribute("data-part") ?? el.tagName.toLowerCase();
                bad.push(`${what}: ${px(b.left - P.left)}–${px(b.right - P.left)} past the pane's ${px(P.width)}`);
            }
        }
        for (const el of panel.querySelectorAll("[data-field] *")) {
            const s = getComputedStyle(el);
            const clips = s.overflowX === "hidden" || s.overflowX === "clip" || el.tagName === "INPUT";
            if (!clips || el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
            const text = el instanceof HTMLInputElement ? el.value : el.textContent ?? "";
            const titled = el.closest("[title]")?.getAttribute("title") === text;
            if (s.textOverflow !== "ellipsis" || !titled) bad.push(`${el.closest("[data-field]")!.getAttribute("data-field")}: "${text}" is cut off`);
        }
        // ── A changed field's tint: the field's own, inside the pane, and clear of every other field's — as if each
        // of them were changed too, so two changed fields' tints never meet.
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--chakra-colors-brand-tint)";
        document.body.appendChild(probe);
        const tint = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const fields = [...panel.querySelectorAll("[data-field]")];
        const spreadOf = (el: Element) => Math.max(0, ...[...getComputedStyle(el).boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)]
            .map((m) => Number(m[4]) + Number(m[3]) + Math.max(Math.abs(Number(m[1])), Math.abs(Number(m[2])))));
        const grown = (el: Element, spread: number) => {
            const b = box(el);
            return { left: b.left - spread, right: b.right + spread, top: b.top - spread, bottom: b.bottom + spread };
        };
        const meets = (a: { left: number; right: number; top: number; bottom: number }, b: DOMRect | { left: number; right: number; top: number; bottom: number }) =>
            a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const dirty = fields.filter((f) => f.hasAttribute("data-dirty"));
        for (const f of dirty) {
            const key = f.getAttribute("data-field");
            if (getComputedStyle(f).backgroundColor !== tint) bad.push(`${key}: changed, and not tinted`);
            const spread = spreadOf(f);
            const t = grown(f, spread);
            if (t.left < P.left - 0.5 || t.right > P.right + 0.5) bad.push(`${key}: its tint runs past the pane`);
            for (const other of fields) {
                if (other === f || other.contains(f) || f.contains(other)) continue;
                if (meets(t, grown(other, spread))) bad.push(`${key}: its tint would meet ${other.getAttribute("data-field")}'s`);
            }
            for (const head of panel.querySelectorAll("[data-field-group] > :first-child")) {
                if (meets(t, box(head))) bad.push(`${key}: its tint reaches the head ${head.textContent}`);
            }
        }
        return bad;
    }, { coarse, line: LINE, touch: TOUCH, between: BETWEEN, inside: INSIDE, panelSel: PANEL, type: TYPE, tagType: TAG_TYPE, chipHeight: CHIP, helpType: HELP_TYPE });
}

/** What of the pane falls outside it, read in the page — for a pane that shows no form: its counts, facts and hints —
 *  and every word broken where the pane has room for it ({@link brokenWords}). */
async function paneFaults(pane: Locator): Promise<string[]> {
    return [...await paneEdgeFaults(pane), ...await pane.evaluate(brokenWords, PANEL)];
}

/** What of the pane falls outside it, read in the page. */
async function paneEdgeFaults(pane: Locator): Promise<string[]> {
    return pane.evaluate((slot, panelSel) => {
        const panel = slot.querySelector(panelSel) ?? slot;
        const P = panel.getBoundingClientRect();
        const bad: string[] = [];
        let shown = 0;
        for (const el of panel.querySelectorAll("*")) {
            const s = getComputedStyle(el);
            const b = el.getBoundingClientRect();
            if (b.width <= 1 || b.height <= 1 || s.visibility === "hidden" || s.clip.startsWith("rect(0")) continue;
            shown++;
            if (b.left < P.left - 0.5 || b.right > P.right + 0.5) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").slice(0, 24)}": past the pane's edge`);
        }
        if (shown === 0) bad.push("the pane shows nothing");
        return bad;
    }, PANEL);
}

/**
 * What a variant's blocks measure wrong (#1549), read in the page — each a line naming the block and what is out of
 * place. A block sits right after its choice, the form's 16px under it, as wide as it and inside the form, its fields
 * set in from the choice's start; its fields and a block of its own each span its column, 16px apart; nothing in it
 * runs past its edges, or is cut off. A pane that shows no block is a fault.
 */
async function blockFaults(pane: Locator): Promise<string[]> {
    return pane.evaluate((slot, { between, panelSel }) => {
        const bad: string[] = [];
        const panel = slot.querySelector(panelSel) ?? slot;
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
        const px = (n: number) => `${Math.round(n * 10) / 10}px`;
        const box = (el: Element) => el.getBoundingClientRect();
        const blocks = [...panel.querySelectorAll("[data-field-block]")];
        if (blocks.length === 0) bad.push("the pane shows no block");
        for (const block of blocks) {
            const of = block.getAttribute("data-field-block")!;
            const name = `${of}'s block`;
            const form = block.closest("[data-field-form]");
            const choice = block.previousElementSibling;
            if (form === null || choice === null || choice.getAttribute("data-field") !== of) {
                bad.push(`${name}: not right after its choice`);
                continue;
            }
            const K = box(block);
            const H = box(choice);
            const F = box(form);
            // ── Under its choice, in the form: the form's rhythm under it, as wide as it, its fields set in.
            const gap = K.top - H.bottom;
            if (!near(gap, between)) bad.push(`${name}: ${px(gap)} under its choice, not ${between}px`);
            if (!near(K.left, H.left) || !near(K.right, H.right)) bad.push(`${name}: spans ${px(K.left - H.left)}–${px(K.right - H.left)} of its choice's ${px(H.width)}`);
            if (K.left < F.left - 0.5 || K.right > F.right + 0.5) bad.push(`${name}: ${px(K.left - F.left)}–${px(K.right - F.left)} past the form's ${px(F.width)}`);
            const s = getComputedStyle(block);
            const left = K.left + Number.parseFloat(s.borderLeftWidth) + Number.parseFloat(s.paddingLeft);
            const right = K.right - Number.parseFloat(s.borderRightWidth) - Number.parseFloat(s.paddingRight);
            if (left <= K.left + 0.5) bad.push(`${name}: its fields are not set in from its choice's start`);
            // ── Its fields, and a block of its own under a choice of its: each across its column, 16px apart.
            const items = [...block.children].filter((el) => box(el).height > 0);
            if (items.length === 0) bad.push(`${name}: holds nothing`);
            items.forEach((item, i) => {
                const part = item.getAttribute("data-field") ?? `${item.getAttribute("data-field-block")}'s block`;
                const I = box(item);
                if (!near(I.left, left) || !near(I.right, right)) bad.push(`${part}: spans ${px(I.left - left)}–${px(I.right - left)} of ${name}'s ${px(right - left)}`);
                if (i === 0) return;
                const apart = I.top - box(items[i - 1]!).bottom;
                if (!near(apart, between)) bad.push(`${part}: ${px(apart)} under the field before it in ${name}, not ${between}px`);
            });
            // ── Nothing in it past its edges, or cut off.
            for (const el of block.querySelectorAll("*")) {
                const t = getComputedStyle(el);
                const b = box(el);
                if (b.width <= 1 || b.height <= 1 || t.visibility === "hidden" || t.clip.startsWith("rect(0")) continue;
                const what = el.closest("[data-field]")?.getAttribute("data-field") ?? el.tagName.toLowerCase();
                if (b.left < K.left - 0.5 || b.right > K.right + 0.5) bad.push(`${what}: ${px(b.left - K.left)}–${px(b.right - K.left)} past ${name}'s ${px(K.width)}`);
                const clips = t.overflowX === "hidden" || t.overflowX === "clip" || el.tagName === "INPUT";
                if (!clips || el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
                const text = el instanceof HTMLInputElement ? el.value : el.textContent ?? "";
                const titled = el.closest("[title]")?.getAttribute("title") === text;
                if (t.textOverflow !== "ellipsis" || !titled) bad.push(`${what}: "${text}" is cut off`);
            }
        }
        return bad;
    }, { between: BETWEEN, panelSel: PANEL });
}

/** Every control's focus ring, stepped through by Tab from the form's first: inside the pane. */
async function ringFaults(page: Page, pane: Locator): Promise<string[]> {
    const first = pane.locator("[data-field-form] input:not([disabled]), [data-field-form] button:not([disabled])").first();
    await first.focus();
    const bad: string[] = [];
    for (let i = 0; i < 40; i++) {
        const at = await pane.evaluate((slot, panelSel) => {
            const panel = slot.querySelector(panelSel) ?? slot;
            const active = document.activeElement;
            if (active === null || !panel.contains(active)) return null;
            const P = panel.getBoundingClientRect();
            // The ring is the focused control's, or its bordered box's (a number, a date, tags: focus within).
            let ringed: Element | null = active;
            while (ringed !== null && panel.contains(ringed) && getComputedStyle(ringed).boxShadow === "none") ringed = ringed.parentElement;
            if (ringed === null || !panel.contains(ringed)) return { name: active.tagName, out: false };
            const b = ringed.getBoundingClientRect();
            const spread = Math.max(0, ...[...getComputedStyle(ringed).boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].map((m) => Number(m[4]) + Number(m[3])));
            return { name: `${active.closest("[data-field]")?.getAttribute("data-field") ?? active.tagName}`, out: b.left - spread < P.left - 0.5 || b.right + spread > P.right + 0.5 };
        }, PANEL);
        if (at === null) break;
        if (at.out) bad.push(`${at.name}: its focus ring runs past the pane`);
        await page.keyboard.press("Tab");
    }
    return bad;
}

// ============================================================================
// The Sheet's inspector
// ============================================================================

/** Open a Sheet example: on a desktop its box 1440px wide, the inspector pinned beside main; on a phone as the page lays it out. */
async function openSheet(page: Page, name: string, theme: "light" | "dark", phone: boolean): Promise<{ box: Locator; pane: Locator }> {
    const hash = `${SHEETS}/${name}`;
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    const box = entry.locator("[data-builder-frame]").first().locator("xpath=..");
    if (!phone) await box.evaluate((el) => { (el as HTMLElement).style.width = "1440px"; });
    await settled(page);
    return { box, pane: box.locator("[data-builder-frame] [data-frame-slot=end]") };
}

/** Closes a phone's inspector view where it is open: Esc, as its back does. */
async function closeView(page: Page, around: Locator): Promise<void> {
    const tab = around.locator("[data-pane-tab='end']");
    if (await tab.getAttribute("aria-selected") === "true") await page.keyboard.press("Escape");
    await expect(tab).toHaveAttribute("aria-selected", "false");
    await settled(page);
}

/** A sheet's row, by its id. */
const sheetRow = (box: Locator, id: string) => box.locator(`[data-frame-slot=main] [data-slot=row][data-row-id="${id}"]`);

/** Select by a click, or a tap on a phone, then open the inspector there from its rail. */
async function select(page: Page, box: Locator, target: Locator, phone: boolean): Promise<void> {
    // A selection sweep reuses the mounted form. Close its overlay before
    // selecting the next canvas item; data-changing workflows stay isolated.
    if (phone) await closeView(page, box);
    if (phone) await target.tap();
    else await target.click();
    await settled(page);
    if (phone) {
        await box.locator("[data-pane-tab='end']").tap();
        await settled(page);
    }
}

// A phone's Sheet draws its own form (`sheet-frame-inspector.dom.test.tsx`).
for (const phone of [false]) {
    test.describe(`The Sheet's inspector form — ${phone ? "on a phone" : "pinned beside main"} (#1220)`, { tag: phone ? "@mobile" : "@desktop" }, () => {
        const coarse = phone;
        const themes = phone ? (["light"] as const) : (["light", "dark"] as const);

        for (const theme of themes) {
            test(`upkeep fields: populated, empty and keyboard focus (${theme})`, async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetUpkeep", theme, phone);
                await test.step(`the upkeep: a machine with every field set — each kind on one column and one line, Set and Clear on its line, one rhythm, nothing past the pane (${theme})`, async () => {
                    await select(page, box, sheetRow(box, "S101").locator("[data-slot=cell][data-key=name]"), phone);
                    await expect(pane.locator("[data-sheet-inspector=row] [data-field]")).toHaveCount(15);
                    await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                });
                await test.step(`the upkeep: a machine with its Options empty — Not set, Set beside a number, a checkbox and a date, empty tags and checklist (${theme})`, async () => {
                    await select(page, box, sheetRow(box, "E201").locator("[data-slot=cell][data-key=name]"), phone);
                    await expect(pane.locator("[data-field='wear'] [data-field-set]")).toBeVisible();
                    await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                });
                if (!phone && theme === "light") {
                    await test.step("the upkeep: every control's focus ring stays inside the pane", async () => {
                        await select(page, box, sheetRow(box, "S101").locator("[data-slot=cell][data-key=name]"), phone);
                        expect(await ringFaults(page, pane)).toEqual([]);
                    });
                }
            });
        }

        // The upkeep adds no machine — a machine's serial is its maker's — so a new row's form is read over the workshop's
        // new line (#1536).
        test("the workshop: a new line, no field given but its notes — its activity required, its Options Not set, its issues listed above them, nothing past the pane", async ({ page }) => {
            const { box, pane } = await openSheet(page, "sheetWorkshop", "light", phone);
            // The first order's blank line: a note typed there is a new operation, `newRow`'s defaults under it.
            const blank = box.locator("[data-frame-slot=main] [data-slot=row][data-blank][data-group-id] [data-slot=cell][data-key=notes]").first();
            if (phone) await blank.tap();
            else await blank.click();
            await page.keyboard.type("Check the hinge cups");
            await page.keyboard.press("Enter");
            await settled(page);
            const row = box.locator("[data-frame-slot=main] [data-slot=row]:not([data-blank])", { has: page.locator("[data-key=notes]", { hasText: "Check the hinge cups" }) });
            await select(page, box, row.locator("[data-slot=cell][data-key=notes]"), phone);
            await expect(pane.locator("[data-sheet-inspector=line]")).toBeVisible();
            await expect(pane.locator("[data-inspector-issues]")).toBeVisible();
            await expect(pane.locator("[data-field='start'] [data-field-set]")).toBeVisible();
            await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            expect(await paneFaults(pane)).toEqual([]);
        });
        if (!phone) {
            test("the upkeep: a field changed in the form is tinted, the tint clear of its neighbours and inside the pane; a row out of service lists its issue", async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetUpkeep", "light", phone);
                await select(page, box, sheetRow(box, "R301").locator("[data-slot=cell][data-key=name]"), phone);
                const crew = pane.locator("[data-field='crew'] input");
                await crew.fill("Day crew");
                await crew.press("Enter");
                await expect(pane.locator("[data-field='crew'][data-dirty]")).toHaveCount(1);
                await expect(pane.locator("[data-inspector-issues]")).toContainText("book its next service");
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });

            for (const theme of ["light", "dark"] as const) {
                test(`workshop selections: line, band, several and none (${theme})`, async ({ page }) => {
                    const { box, pane } = await openSheet(page, "sheetWorkshop", theme, phone);
                    if (theme === "light") {
                        await test.step("the workshop with nothing selected — the ring on the first order's blank line: its counts and hints inside the pane", async () => {
                            // The orders page from the rail's rows source (#1345), landing after the sheet opens, so its ring
                            // opens on the first order's band: set on the order's blank line, it selects nothing.
                            await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row][data-blank][data-group-id] [data-key]").first(), phone);
                            await expect(pane.locator("[data-sheet-inspector=none]")).toBeVisible();
                            expect(await paneFaults(pane)).toEqual([]);
                        });
                    }
                    await test.step(`the workshop: an operation's line — its dates, its quantity with its unit, its work centres, its notes and created_by read only (${theme})`, async () => {
                        await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row]:not(:has([data-slot=groupSummary])) [data-slot=cell][data-key=notes]").first(), phone);
                        await expect(pane.locator("[data-sheet-inspector=line]")).toBeVisible();
                        await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                    });
                    if (theme === "light") {
                        await test.step("the workshop: an order's band — its name, customer, due date and status", async () => {
                            await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row][data-band-row] [data-slot=cell]").first(), phone);
                            await expect(pane.locator("[data-sheet-inspector=band]")).toBeVisible();
                            await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                        });
                        await test.step("the workshop: several operations — the column a bulk edit sets, and its value", async () => {
                            const gutters = box.locator("[data-frame-slot=main] [data-slot=row]:not([data-band-row]):not([data-blank]) [data-slot=gutter]");
                            await gutters.nth(0).click();
                            await gutters.nth(2).click({ modifiers: ["Shift"] });
                            await settled(page);
                            await expect(pane.locator("[data-sheet-inspector=several]")).toBeVisible();
                            await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                        });
                    }
                });
            }

            test("the batches: a step's line and a batch's band", async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetBatches", "light", phone);
                await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row]:not([data-band-row]):not([data-blank]) [data-slot=cell][data-key=task]").first(), phone);
                await expect(pane.locator("[data-sheet-inspector=line]")).toBeVisible();
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row][data-band-row] [data-slot=cell]").first(), phone);
                await expect(pane.locator("[data-sheet-inspector=band]")).toBeVisible();
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            });
        }
    });
}

// ============================================================================
// The Plan's inspector
// ============================================================================

/** Open the print works: on a desktop its box 1440px wide, both panes pinned beside main. */
async function openPrintWorks(page: Page, theme: "light" | "dark", phone: boolean): Promise<{ entry: Locator; frame: Locator; pane: Locator }> {
    const entry = await openExample(page, "planPrintWorks", EVENTS, theme);
    if (!phone) {
        await entry.locator("[data-plan-frame]").first().locator("xpath=..").evaluate((el) => { (el as HTMLElement).style.width = "1440px"; });
        await settled(page);
    }
    const frame = entry.locator("[data-builder-frame]").first();
    return { entry, frame, pane: frame.locator("[data-frame-slot='end']") };
}

/** The spring catalogue's run on Press A1, and the press's other runs. */
const pressA1 = rowSel("presses.span", "Hall A", "a1");

/** Press B2, whose two jobs on the 20th overlap (#1198): the market posters and the loyalty cards. */
const PRESS_B2 = rowId("presses.span", "Hall B", "b2");

for (const phone of [false, true]) {
    test.describe(`The Plan's inspector form — ${phone ? "on a phone" : "pinned beside main"} (#1220)`, { tag: phone ? "@mobile" : "@desktop" }, () => {
        const themes = phone ? (["light"] as const) : (["light", "dark"] as const);
        for (const theme of themes) {
            test(`print works selections: event, row, overlaps and bulk form (${theme})`, async ({ page }) => {
                const { entry, frame, pane } = await openPrintWorks(page, theme, phone);
                if (!phone && theme === "light") {
                    await test.step("a press's row and nothing selected: facts, counts and hints inside the pane", async () => {
                        await expect(pane.locator("[data-plan-inspector='none']")).toBeVisible();
                        expect(await paneFaults(pane)).toEqual([]);
                        await select(page, frame, entry.locator(`${pressA1} [role="rowheader"]`), phone);
                        await expect(pane.locator("[data-plan-inspector='row']")).toBeVisible();
                        expect(await paneFaults(pane)).toEqual([]);
                    });
                }
                await test.step(`one event: its kind's form — a customer, a stock, a due date and time — on one column and one line (${theme})`, async () => {
                    // On a phone the Plan is its narrow list (#570): the press's card, in the Rows tab, draws its runs.
                    if (phone) {
                        await entry.locator("[data-plan-tab='rows']").tap();
                        await settled(page);
                    }
                    const bar = phone ? entry.locator("[data-run]", { hasText: "Spring catalogue" }).first() : entry.locator(`${pressA1} [data-run]`, { hasText: "Spring catalogue" });
                    await select(page, frame, bar, phone);
                    await expect(pane.locator("[data-plan-inspector='event'] [data-field]")).toHaveCount(3);
                    await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                    expect(await paneFaults(pane)).toEqual([]);
                    if (phone) {
                        await closeView(page, frame);
                    }
                });
                await test.step(`a press's row with an overlap, then one of its jobs: the overlaps banner says each overlap's time and its jobs' names in whole words, every line inside the pane (${theme})`, async () => {
                    // On a phone the Plan is its narrow list (#570): Press B2's card, in the Rows tab — the list shows its
                    // first rows and a "more rows" button for the rest, tapped until the press's card is drawn.
                    const holder = entry.locator(phone ? `[data-plan-card=${JSON.stringify(PRESS_B2)}]` : `[data-plan-row=${JSON.stringify(PRESS_B2)}]`);
                    if (phone) {
                        await entry.locator("[data-plan-tab='rows']").tap();
                        await settled(page);
                        const more = entry.getByRole("button", { name: /^\d+ more rows?$/ });
                        for (let i = 0; i < 10 && await holder.count() === 0 && await more.count() > 0; i++) {
                            await more.first().tap();
                            await settled(page);
                        }
                        await holder.scrollIntoViewIfNeeded();
                    }
                    // The press's row: its pair on the 20th — the overlap's time, and both jobs' names.
                    await select(page, frame, phone ? holder.getByText("Press B2", { exact: true }) : holder.locator("[role='rowheader']"), phone);
                    await expect(pane.locator("[data-plan-inspector='row'] [data-inspector-overlap]")).toHaveCount(1);
                    expect(await paneFaults(pane)).toEqual([]);
                    // One of its jobs: the job it overlaps — its time, and its name. The loyalty cards, drawn over the market
                    // posters where they overlap, is the one a pointer reaches whole. A phone's pane lies over the list: a tap
                    // on the scrim beside it closes it first.
                    if (phone) {
                        await closeView(page, frame);
                        await settled(page);
                    }
                    const job = holder.locator("[data-run]", { hasText: "Loyalty cards" });
                    await select(page, frame, job, phone);
                    await expect(pane.locator("[data-plan-inspector='event'] [data-inspector-overlap]")).toHaveCount(1);
                    expect(await paneFaults(pane)).toEqual([]);
                });
                if (!phone && theme === "light") {
                    await test.step("several events: the bulk edit's state and resource", async () => {
                        await select(page, frame, entry.locator(`${pressA1} [data-run]`, { hasText: "Spring catalogue" }), phone);
                        await entry.locator(`${pressA1} [data-run]`, { hasText: "Museum guide" }).click({ modifiers: ["Shift"] });
                        await settled(page);
                        await expect(pane.locator("[data-plan-inspector='events']")).toBeVisible();
                        await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                        expect(await paneFaults(pane)).toEqual([]);
                    });
                }
            });
        }
    });
}

// ============================================================================
// The Flowchart's inspector (#1250, #1504)
// ============================================================================

const FLOWCHARTS = "e3/flowchart/flowchart";

/** Open a Flowchart example: on a desktop its box 1440px wide, both panes pinned beside main; on a phone as the page lays it out. */
async function openFlowchart(page: Page, name: string, theme: "light" | "dark", phone: boolean): Promise<{ box: Locator; pane: Locator }> {
    const hash = `${FLOWCHARTS}/${name}`;
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-flowchart-node]").first()).toBeVisible({ timeout: 20_000 });
    const box = entry.locator("[data-flowchart-root]").first();
    if (!phone) await box.evaluate((el) => { (el as HTMLElement).style.width = "1440px"; });
    await settled(page);
    return { box, pane: box.locator("[data-builder-frame] [data-frame-slot=end]") };
}

/** A state on the canvas, by its key. */
const flowState = (box: Locator, key: string) => box.locator(`[data-flowchart-node="${key}"]`);

/** A transition a state's Details list, by its key in its record: a click selects it. */
async function selectListed(page: Page, pane: Locator, key: string): Promise<void> {
    await pane.locator(`[data-inspector-link="${key}"]`).click();
    await settled(page);
}

/** The fields a view of the inspector shows, by their names, in their order. */
function fieldsOf(pane: Locator, view: string): Promise<(string | null)[]> {
    return pane.locator(`[data-flowchart-inspector='${view}'] [data-field]`).evaluateAll((fields) => fields.map((field) => field.getAttribute("data-field")));
}

for (const phone of [false, true]) {
    test.describe(`The Flowchart's inspector form — ${phone ? "on a phone" : "pinned beside main"} (#1250, #1504)`, { tag: phone ? "@mobile" : "@desktop" }, () => {
        for (const theme of ["light", "dark"] as const) {
            test(`the depot's selections: nothing, a state, a transition, a lane and several (${theme})`, async ({ page }) => {
                const { box, pane } = await openFlowchart(page, "flowchartDepot", theme, phone);
                await test.step(`nothing selected: the flowchart's counts, its transitions' split and its hints, inside the pane (${theme})`, async () => {
                    if (phone) {
                        await box.locator("[data-pane-tab='end']").tap();
                        await settled(page);
                    }
                    await expect(pane.locator("[data-flowchart-inspector='flowchart']")).toBeVisible();
                    expect(await paneFaults(pane)).toEqual([]);
                    // Its counts two to a line: lanes and states, then transitions and decisions.
                    const tops = await pane.locator("[data-inspector-counts] [data-count]").evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().top)));
                    expect([tops.length, tops[0] === tops[1], tops[1]! < tops[2]!, tops[2] === tops[3]]).toEqual([4, true, true, true]);
                });
                await test.step(`a state: its key, label and lane, then the fields no role writes — its slots with their Clear, its flow — on one column and one line; its transitions inside the pane (${theme})`, async () => {
                    await select(page, box, flowState(box, "CH*"), phone);
                    expect(await fieldsOf(pane, "state")).toEqual(["key", "label", "lane", "slots", "flow"]);
                    await expect(pane.locator("[data-field='slots'] [data-field-clear]")).toBeVisible();
                    // Into the chutes from Inducted and from Relabelled, and on to Sorted.
                    await expect(pane.locator("[data-inspector-link]")).toHaveCount(3);
                    await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                    expect(await paneFaults(pane)).toEqual([]);
                    // On a coarse pointer each transition it lists is a 44px tap target.
                    if (phone) {
                        const heights = await pane.locator("[data-inspector-link]").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
                        expect(heights.every((h) => h >= TOUCH - 0.5), `${heights.join(", ")}`).toBe(true);
                    }
                });
                if (!phone) {
                    await test.step(`a transition: its ends and its decision, each a select, then its kind and its flow, on one column and one line; and its evidence — volume, count, when measured — printed (${theme})`, async () => {
                        await select(page, box, flowState(box, "CH*"), phone);
                        await selectListed(page, pane, "l4");
                        expect(await fieldsOf(pane, "transition")).toEqual(["from", "to", "decision", "kind", "flow", "volume", "count", "measured"]);
                        await expect(pane.locator("[data-inspector-evidence] [data-field][data-editor='readonly']")).toHaveCount(3);
                        await expect.poll(() => formFaults(pane, false)).toEqual([]);
                        expect(await paneFaults(pane)).toEqual([]);
                    });
                    if (theme === "light") {
                        await test.step("a lane, a click on its header: its key and label, how many states it holds, and why its Delete is off", async () => {
                            await select(page, box, box.locator("[data-flowchart-lane='sort']"), phone);
                            expect(await fieldsOf(pane, "lane")).toEqual(["key", "label"]);
                            await expect(pane.locator("[data-inspector-why]")).toBeVisible();
                            await expect.poll(() => formFaults(pane, false)).toEqual([]);
                            expect(await paneFaults(pane)).toEqual([]);
                        });
                        await test.step("several states: how many, and the lane every one moves to", async () => {
                            await select(page, box, flowState(box, "ARV"), phone);
                            await flowState(box, "SCN").click({ modifiers: ["Shift"] });
                            await settled(page);
                            await expect(pane.locator("[data-flowchart-inspector='several'] [data-field]")).toHaveCount(1);
                            await expect.poll(() => formFaults(pane, false)).toEqual([]);
                            expect(await paneFaults(pane)).toEqual([]);
                        });
                        await test.step("a state: every control's focus ring stays inside the pane", async () => {
                            await select(page, box, flowState(box, "CH*"), phone);
                            expect(await ringFaults(page, pane)).toEqual([]);
                        });
                    }
                }
            });
        }

        if (!phone) {
            for (const theme of ["light", "dark"] as const) {
                test(`a decision: its key, then its name and its owner, and the transition it governs (${theme})`, async ({ page }) => {
                    const { box, pane } = await openFlowchart(page, "flowchartDepot", theme, phone);
                    await select(page, box, box.locator("[data-flowchart-trigger='route']"), phone);
                    expect(await fieldsOf(pane, "decision")).toEqual(["key", "name", "owner"]);
                    // The route governs the move from Inducted into the chutes.
                    await expect(pane.locator("[data-inspector-link]")).toHaveCount(1);
                    await expect.poll(() => formFaults(pane, false)).toEqual([]);
                    expect(await paneFaults(pane)).toEqual([]);
                });

                test(`read only, through the rail's sources: a transition's every field printed, on one column and one line (${theme})`, async ({ page }) => {
                    const { box, pane } = await openFlowchart(page, "flowchartDepotDimmed", theme, phone);
                    // Held, in the Hold lane the rail keeps in focus, and its move on to Cleared.
                    await select(page, box, flowState(box, "HLD"), phone);
                    await selectListed(page, pane, "l7");
                    // Its ends, then every field no role writes: its kind, the decision it names, what was measured on it and when, and its flow.
                    await expect(pane.locator("[data-flowchart-inspector='transition'] [data-field][data-editor='readonly']")).toHaveCount(8);
                    await expect.poll(() => formFaults(pane, false)).toEqual([]);
                    expect(await paneFaults(pane)).toEqual([]);
                });
            }

            test("an end no state stands for — the depot's unresolved transition's — says so, its chip in the warning's ink, with its transition, inside the pane; and Issues lists it", async ({ page }) => {
                const { box, pane } = await openFlowchart(page, "flowchartDepot", "light", phone);
                await test.step("the end: its chip and its transition, inside the pane", async () => {
                    await select(page, box, flowState(box, "DLV"), phone);
                    await expect(pane.locator("[data-flowchart-inspector='ghost'] [data-inspector-link]")).toHaveCount(1);
                    expect(await pane.locator("[data-inspector-chip]").evaluate((chip) => {
                        const probe = document.createElement("div");
                        probe.style.color = "var(--chakra-colors-fg-warning)";
                        document.body.appendChild(probe);
                        const warning = getComputedStyle(probe).color;
                        probe.remove();
                        return [chip.getAttribute("data-state"), getComputedStyle(chip).color === warning];
                    })).toEqual(["noRow", true]);
                    expect(await paneFaults(pane)).toEqual([]);
                });
                await test.step("Issues: the unresolved transition, inside the pane", async () => {
                    await pane.getByRole("tab", { name: /^Issues/u }).click();
                    await settled(page);
                    await expect(pane.locator("[data-inspector-issue]")).toHaveCount(1);
                    expect(await paneFaults(pane)).toEqual([]);
                });
            });

            test("a field changed in the form is one edit, tinted, the tint clear of its neighbours and inside the pane", async ({ page }) => {
                const { box, pane } = await openFlowchart(page, "flowchartDepot", "light", phone);
                await select(page, box, flowState(box, "CH*"), phone);
                const label = pane.locator("[data-field='label'] input");
                await label.fill("Sort chutes, both halls");
                await label.press("Enter");
                await expect(pane.locator("[data-field='label'][data-dirty]")).toHaveCount(1);
                await expect(pane.locator("[data-inspector-chip]")).toHaveText("Pending");
                await expect.poll(() => formFaults(pane, false)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });
        } else {
            test("Issues: the depot's unresolved transition, inside the pane, a 44px tap target", async ({ page }) => {
                const { box, pane } = await openFlowchart(page, "flowchartDepot", "light", phone);
                await box.locator("[data-pane-tab='end']").tap();
                await settled(page);
                await pane.getByRole("tab", { name: /^Issues/u }).tap();
                await settled(page);
                const issue = pane.locator("[data-inspector-issue]");
                await expect(issue).toHaveCount(1);
                // On a coarse pointer the issue is a 44px tap target.
                expect(await issue.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(TOUCH - 0.5);
                expect(await paneFaults(pane)).toEqual([]);
            });
        }
    });
}

// ============================================================================
// The Schematic's inspector (#1391)
// ============================================================================

/**
 * Open the data centre floor at rest, in the window's middle so each point of its drawing is clicked in view: on a
 * desktop in a page 1600px wide, its box 1440px wide, the library pinned at its start and the inspector at its end,
 * each beside main; on a phone as the page lays it out, the inspector a rail main never moves for.
 */
async function openDataCentre(page: Page, theme: "light" | "dark", phone: boolean): Promise<{ root: Locator; pane: Locator }> {
    if (!phone) await page.setViewportSize({ width: 1600, height: 1000 });
    const root = await openSchematic(page, DATA_CENTRE, theme);
    if (!phone) await sizeTo(page, root, 1440);
    await centred(page, root);
    const pane = root.locator("[data-builder-frame] [data-frame-slot=end]");
    if (!phone) await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
    return { root, pane };
}

/**
 * Fit the floor in view from the toolbar — on a phone from its View popover — as a viewer does after an entity the
 * inspector selected flew the camera to it.
 */
async function fitFloor(page: Page, root: Locator, phone: boolean): Promise<void> {
    const toolbar = root.locator("[data-frame-slot='toolbar']");
    if (phone) {
        await toolbar.locator("[data-phone-view]").tap();
        const fit = page.locator("[data-schematic-view]").getByRole("button", { name: "Fit" });
        await fit.tap();
        await page.keyboard.press("Escape");
        await expect(fit).toHaveCount(0);
    } else {
        await toolbar.getByRole("button", { name: "Fit" }).click();
    }
    await settled(page);
}

/**
 * Select what the floor draws at a point, in metres, the floor fitted in view first — by a click, or a tap on a phone,
 * the open pane's scrim tapped away first and the inspector then opened from its rail. The example's box is narrower
 * than a desktop's 1440px frame and scrolls it sideways, as a click on the inspector at its end does: the frame's
 * start is scrolled back into view, so the point is clicked on the canvas, never on what the box clips it under.
 */
async function selectAt(page: Page, root: Locator, x: number, y: number, phone: boolean): Promise<void> {
    if (phone) await closeView(page, root);
    await fitFloor(page, root, phone);
    await root.evaluate((el) => { el.scrollIntoView({ block: "center", inline: "start" }); });
    await settled(page);
    const at = await screenPoint(root, x, y);
    if (phone) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await settled(page);
    if (phone) {
        await root.locator("[data-pane-tab='end']").tap();
        await settled(page);
    }
}

/** What the selected item is joined to, by its kind and key, as its Details lists it: a click — a tap on a phone — selects it. */
async function selectJoined(page: Page, pane: Locator, kind: string, key: string, phone: boolean): Promise<void> {
    const join = pane.locator(`[data-inspector-join=${JSON.stringify(printedRef(kind, key))}]`);
    if (phone) await join.tap();
    else await join.click();
    await settled(page);
}

/** A03, the third rack of Cage A, by its centre in metres. */
const A03 = [9.6, 2.9] as const;
/** A02, the rack beside it — on Feed A too, and at no end of A03's fibre run, whose handles a selected run draws on its ends. */
const A02 = [6.0, 2.9] as const;

for (const phone of [false, true]) {
    test.describe(`The Schematic's inspector form — ${phone ? "on a phone" : "pinned beside main"} (#1391)`, { tag: phone ? "@mobile" : "@desktop" }, () => {
        const themes = phone ? (["light"] as const) : (["light", "dark"] as const);
        for (const theme of themes) {
            test(`floor selections: nothing, a rack, its fibre run and its power feed (${theme})`, async ({ page }) => {
                const { root, pane } = await openDataCentre(page, theme, phone);
                await test.step(`nothing selected: the floor's counts, two to a line, and its saves, inside the pane (${theme})`, async () => {
                    if (phone) {
                        await root.locator("[data-pane-tab='end']").tap();
                        await settled(page);
                    }
                    await expect(pane.locator("[data-schematic-inspector='drawing']")).toBeVisible();
                    expect(await paneFaults(pane)).toEqual([]);
                    // Seven counts: the four item kinds', then the zones', the links' and the nets'.
                    const tops = await pane.locator("[data-inspector-counts] [data-count]").evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().top)));
                    expect([tops.length, tops[0] === tops[1], tops[1]! < tops[2]!, tops[2] === tops[3], tops[4] === tops[5], tops[5]! < tops[6]!]).toEqual([7, true, true, true, true, true]);
                });
                await test.step(`a rack: its own fields, its load's and its position${phone ? " and its Connect to…" : ""}, each on one column and one line; what it is joined to inside the pane (${theme})`, async () => {
                    await selectAt(page, root, ...A03, phone);
                    // Below 480px of main its Connect to… joins them (#1394): one field, the item a fibre run ends at — the
                    // rack starts runs of one kind, so no kind's field beside it.
                    await expect(pane.locator("[data-schematic-inspector='item'] [data-field]")).toHaveCount(phone ? 9 : 8);
                    await expect(pane.locator("[data-schematic-inspector='item'] [data-inspector-fields='connect'] [data-field]")).toHaveCount(phone ? 1 : 0);
                    await expect(pane.locator("[data-inspector-join]")).toHaveCount(2);
                    await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                    expect(await paneFaults(pane)).toEqual([]);
                    // On a coarse pointer each entity it is joined to is a 44px tap target.
                    if (phone) {
                        const heights = await pane.locator("[data-inspector-join]").evaluateAll((joins) => joins.map((join) => join.getBoundingClientRect().height));
                        expect(heights.every((h) => h >= TOUCH - 0.5), `${heights.join(", ")}`).toBe(true);
                    }
                });
                await test.step(`its fibre run, from what the rack is joined to: its ends, each a Chooser, and its own fields, on one column and one line (${theme})`, async () => {
                    await selectJoined(page, pane, "fibre", "u3", phone);
                    await expect(pane.locator("[data-schematic-inspector='link'] [data-inspector-fields='ends'] [data-field][data-editor='reference']")).toHaveCount(2);
                    await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                    expect(await paneFaults(pane)).toEqual([]);
                });
                await test.step(`a power feed, from a rack it feeds: its sides, each tags of its members' keys, and its own fields, on one column and one line (${theme})`, async () => {
                    await selectAt(page, root, ...A02, phone);
                    await selectJoined(page, pane, "feeds", "feed-a", phone);
                    await expect(pane.locator("[data-schematic-inspector='net'] [data-inspector-fields='sides'] [data-field][data-editor='tags']")).toHaveCount(2);
                    await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                    expect(await paneFaults(pane)).toEqual([]);
                });
                if (!phone && theme === "light") {
                    await test.step("a cooling unit: its own Details in place of its form, and its position, inside the pane", async () => {
                        await selectAt(page, root, 9.0, 11.9, phone);
                        const own = pane.locator("[data-schematic-inspector='item'] [data-inspector-fields='row']");
                        await expect(own.getByRole("button", { name: "Lower the setpoint by 1 °C" })).toBeVisible();
                        await expect(own.locator("[data-field]")).toHaveCount(0);
                        await expect.poll(() => formFaults(pane, false)).toEqual([]);
                        expect(await paneFaults(pane)).toEqual([]);
                    });
                    await test.step("two racks, the second Shift-clicked: how many of each kind, and Delete, inside the pane", async () => {
                        await selectAt(page, root, 2.4, 2.9, phone);
                        const a02 = await screenPoint(root, ...A02);
                        await page.keyboard.down("Shift");
                        await page.mouse.click(a02.x, a02.y);
                        await page.keyboard.up("Shift");
                        await settled(page);
                        await expect(pane.locator("[data-schematic-inspector='several'] [data-inspector-count]")).toHaveText(["2 racks"]);
                        expect(await paneFaults(pane)).toEqual([]);
                    });
                    await test.step("an area, its layer unlocked in the library's Layers tab: its field read only, on one line inside the pane", async () => {
                        await openLibraryTab(page, root, "Layers");
                        await root.locator("[data-frame-slot='start'] [data-schematic-layer='structure'] [data-layer-toggle='lock']").click();
                        await settled(page);
                        // Cage A's clear floor, above its racks.
                        await selectAt(page, root, 12.0, 1.0, phone);
                        await expect(pane.locator("[data-schematic-inspector='zone'] [data-field][data-editor='readonly']")).toHaveCount(1);
                        await expect.poll(() => formFaults(pane, false)).toEqual([]);
                        expect(await paneFaults(pane)).toEqual([]);
                    });
                    await test.step("a rack: every control's focus ring stays inside the pane", async () => {
                        await selectAt(page, root, ...A03, phone);
                        expect(await ringFaults(page, pane)).toEqual([]);
                    });
                }
            });
        }

        test("a field changed in the form is one edit, tinted, the tint clear of its neighbours and inside the pane; a rack typed off the floor is an issue, its row a 44px tap target inside the pane", async ({ page }) => {
            const { root, pane } = await openDataCentre(page, "light", phone);
            await selectAt(page, root, ...A03, phone);
            const owner = pane.locator("[data-inspector-fields='row'] [data-field='owner'] input");
            await owner.fill("Elmway College");
            await owner.press("Enter");
            await expect(pane.locator("[data-field='owner'][data-dirty]")).toHaveCount(1);
            await expect(pane.locator("[data-inspector-marks] > [data-state]")).toHaveText("Pending");
            await expect.poll(() => formFaults(pane, phone)).toEqual([]);
            expect(await paneFaults(pane)).toEqual([]);
            // Its x typed past the floor's east edge, 28 m, a key at a time — the shared input writes back on a frame.
            const x = pane.locator("[data-inspector-fields='position'] [data-field='x'] [role=spinbutton]");
            await x.click();
            await x.press("ControlOrMeta+a");
            await x.press("Backspace");
            await x.pressSequentially("30", { delay: 30 });
            await x.press("Enter");
            await expect(pane.locator("[data-field='x'][data-dirty]")).toHaveCount(1);
            const tab = pane.getByRole("tab", { name: /^Issues/u });
            await expect(tab).toHaveText("Issues 1");
            if (phone) await tab.tap();
            else await tab.click();
            await settled(page);
            const issue = pane.locator("[data-inspector-issue='outside']");
            await expect(issue).toHaveText("Rack · A03Outside the drawing");
            // Its two lines in their padding: a 44px tap target, on any pointer.
            expect(await issue.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(TOUCH - 0.5);
            expect(await paneFaults(pane)).toEqual([]);
        });
    });
}

// ============================================================================
// The Record's inspector: a variant's block (#1549)
// ============================================================================

const RECORDS = "e3/record/record";

/** Open the joinery: on a desktop in a page 1600px wide, the inspector pinned beside main; on a phone as the page lays it out. */
async function openJoinery(page: Page, phone: boolean): Promise<{ frame: Locator; pane: Locator }> {
    if (!phone) await page.setViewportSize({ width: 1600, height: 1000 });
    const entry = await visitBuilder(page, `${RECORDS}/recordFinishes`, "[data-builder-frame]", "light");
    await expect(entry.locator("[data-record] [data-slot=row]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    const frame = entry.locator("[data-builder-frame]").first();
    const pane = frame.locator("[data-frame-slot=end]");
    if (!phone) await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
    return { frame, pane };
}

/** A piece's room, by the piece's key: a click on it — a tap on a phone — selects the piece. */
const roomOf = (frame: Locator, id: string) => frame.locator(`[data-record] [data-slot=row][data-row-id="${id}"] [data-slot=cell][data-key=room]`);

for (const phone of [false, true]) {
    // On a phone at both its widths: the narrow project runs what is tagged `@narrow`.
    test.describe(`The Record's inspector form, a variant's block — ${phone ? "on a phone" : "pinned beside main"} (#1549)`, { tag: phone ? ["@mobile", "@narrow"] : "@desktop" }, () => {
        test("the joinery: a painted piece's block under its choice and a block in it under its gloss; a stain chosen, its shade alone in the block; a bare piece, the choice alone", async ({ page }) => {
            const { frame, pane } = await openJoinery(page, phone);
            await test.step("the hall door, painted with a sheen: its colour, coats and gloss in the block under its finish, its sheen in the block under its gloss", async () => {
                await select(page, frame, roomOf(frame, "J-101"), phone);
                await expect(pane.locator("[data-field-block='finish'] > [data-field]")).toHaveCount(3);
                await expect(pane.locator("[data-field-block='finish.paint.gloss'] > [data-field]")).toHaveCount(1);
                await expect.poll(() => blockFaults(pane)).toEqual([]);
                if (!phone) await expect.poll(() => formFaults(pane, false)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });
            await test.step("a stain chosen in its place: the choice tinted, and the shade alone in its block", async () => {
                const stain = pane.locator("[data-field='finish'] [data-part=item]", { hasText: "Stain" });
                if (phone) await stain.tap();
                else await stain.click();
                await settled(page);
                await expect(pane.locator("[data-field='finish'][data-dirty]")).toHaveCount(1);
                await expect(pane.locator("[data-field-block='finish'] > [data-field]")).toHaveCount(1);
                await expect(pane.locator("[data-field-block='finish'] > [data-field='finish.stain']")).toBeVisible();
                await expect.poll(() => blockFaults(pane)).toEqual([]);
                if (!phone) await expect.poll(() => formFaults(pane, false)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });
            await test.step("the window seat, bare: its choice alone, no block under it", async () => {
                await select(page, frame, roomOf(frame, "J-103"), phone);
                await expect(pane.locator("[data-field='finish']")).toBeVisible();
                await expect(pane.locator("[data-field-block]")).toHaveCount(0);
                if (!phone) await expect.poll(() => formFaults(pane, false)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });
        });
    });
}
