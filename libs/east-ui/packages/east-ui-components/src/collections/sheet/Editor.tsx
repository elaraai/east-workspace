/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The overlay editor (B§4.4 / B§6): one mono input over the cell at inset −1
 * with the 2 px brand ring, the inline ghost drawn in a mirror behind the
 * caret, a `→ replacement` preview and a `k/n` badge on the right, and the
 * neg ring when the last commit was unrecognised.
 *
 * A link cell's editor draws BOTH halves on the cell's own grid: the active
 * half carries a 1.5 px brand underline and the only input; the other half's
 * chips are clickable to move the caret. Existing content is chips; the
 * buffer resolves to chips on `,` / ⏎ / a hop; ⇧← / ⇧→ select whole chips.
 * Focus moving between the two halves is not leaving the cell.
 *
 * The editor stops keyboard propagation: the sheet owns every other key.
 */

import { memo, useLayoutEffect, useRef, type KeyboardEvent, type ChangeEvent, type FocusEvent, type MouseEvent } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightLong, faMinus } from "@fortawesome/free-solid-svg-icons";
import { memberIsDashed, memberLabel } from "./model.js";
import type { LinkVocabulary } from "./link/grammar.js";
import type { LinkHalves } from "./link/sides.js";
import type { LinkGroups } from "./sheet-state.js";
import type { SheetMemberValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;

/** A focus request — bumped by the machine's `focus.editor` effect. */
export interface EditorFocusRequest {
    seq: number;
    selectAll: boolean;
}

/** The link editor's view. */
export interface LinkEditorView {
    side: 0 | 1;
    halves: LinkHalves;
    groups: LinkGroups;
    /** The flat chip range under the selection. */
    chipSel: { lo: number; hi: number } | null;
    /** The predicted members per half (P4). */
    predicted: [readonly SheetMemberValue[], readonly SheetMemberValue[]];
    vocab: LinkVocabulary | undefined;
    /** Bumps on a hop — the new half's input takes focus. */
    hop: number;
    /** A `set` column — one half, no arrow. */
    single: boolean;
}

export interface SheetEditorProps {
    styles: Styles;
    value: string;
    /** The inline ghost (the top prefix candidate's suffix). */
    ghost: string;
    /** A non-prefix match, previewed as a replacement. */
    resolve: string;
    /** `k/n` over the candidates. */
    badge: string;
    /** The neg ring. */
    error: boolean;
    focus: EditorFocusRequest;
    ariaLabel: string;
    /** The link editor, on a link / set column. */
    link: LinkEditorView | undefined;
    onChange: (val: string) => void;
    onKey: (e: { key: string; shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }) => boolean;
    onBlur: () => void;
    onHalfDown: (side: 0 | 1) => void;
}

/** The window after a hop in which a blur is the OLD input going away, not the planner leaving. */
const HOP_GRACE_MS = 300;

/** Renders the overlay editor. */
export const SheetEditor = memo(function SheetEditor({ styles, value, ghost, resolve, badge, error, focus, ariaLabel, link, onChange, onKey, onBlur, onHalfDown }: SheetEditorProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const lastFocus = useRef("");
    const hopAt = useRef(0);
    const focusKey = `${focus.seq}:${link?.hop ?? 0}:${link?.side ?? -1}`;
    useLayoutEffect(() => {
        const el = inputRef.current;
        if (el === null || lastFocus.current === focusKey) return;
        lastFocus.current = focusKey;
        hopAt.current = Date.now();
        el.focus({ preventScroll: true });
        if (focus.selectAll && link === undefined) el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
    }, [focusKey, focus.selectAll, link]);

    const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        const el = e.currentTarget;
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
        const handled = onKey({ key: e.key, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, alt: e.altKey, atEnd });
        if (handled) e.preventDefault();
    };
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value);
    const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
        // Focus moving between the two halves is not leaving the cell; an input
        // unmounting under a hop is not the planner leaving either.
        const to = e.relatedTarget as HTMLElement | null;
        if (to !== null && typeof to.getAttribute === "function" && to.getAttribute("data-side") !== null) return;
        if (!e.currentTarget.isConnected) return;
        if (Date.now() - hopAt.current < HOP_GRACE_MS) return;
        onBlur();
    };

    const input = (side: 0 | 1 | undefined) => (
        <Box css={styles.editorField} style={link !== undefined ? { flex: "1", minWidth: "24px", height: "22px" } : undefined}>
            <Box css={styles.editorMirror} aria-hidden="true">
                <span style={{ visibility: "hidden" }}>{value}</span>
                <Box as="span" css={styles.editorGhost} data-slot="editorGhost">{ghost}</Box>
            </Box>
            <chakra.input
                ref={inputRef}
                css={styles.editorInput}
                value={value}
                aria-label={ariaLabel}
                aria-autocomplete="inline"
                data-slot="editorInput"
                data-side={side}
                onChange={handleChange}
                onKeyDown={handleKey}
                onBlur={handleBlur}
                onCopy={(e) => e.stopPropagation()}
                onPaste={(e) => e.stopPropagation()}
            />
        </Box>
    );

    const half = (side: 0 | 1) => {
        if (link === undefined) return null;
        const key: "from" | "to" = side === 0 ? "from" : "to";
        const state = link.halves[key];
        const members = link.groups[side];
        const active = link.side === side;
        const offset = side === 0 ? 0 : link.groups[0].length;
        const warn = !state.live && (members.length > 0 || active);
        const onDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement).tagName === "INPUT") { e.stopPropagation(); return; }
            e.preventDefault();
            e.stopPropagation();
            onHalfDown(side);
        };
        return (
            <Box
                css={styles.half}
                data-half={key}
                data-active={active ? "" : undefined}
                data-locked={!state.live ? "" : undefined}
                style={{ position: "relative", minHeight: "34px", alignItems: "center", padding: side === 0 ? "7px 3px 7px 0" : "7px 0 7px 3px", justifyContent: "flex-start" }}
                onMouseDown={onDown}
            >
                {active && <Box aria-hidden="true" style={{ position: "absolute", left: side === 0 ? 0 : 3, right: side === 0 ? 3 : 0, bottom: 4, height: "1.5px", background: "var(--chakra-colors-brand-solid)", pointerEvents: "none" }} />}
                {!state.live && state.lock !== "" && (
                    <Box as="span" css={warn ? styles.lockWarn : styles.lockTag} data-slot={warn ? "lockWarn" : "lockTag"}
                        title={warn ? `This ${key === "from" ? "source" : "destination"} is locked — anything here is kept but flagged` : undefined}>
                        {state.lock}
                    </Box>
                )}
                {state.live && members.length === 0 && <Box as="span" css={styles.halfLabel} data-slot="halfLabel">{key}</Box>}
                {members.map((m, i) => {
                    const n = offset + i;
                    const picked = link.chipSel !== null && n >= link.chipSel.lo && n <= link.chipSel.hi;
                    return (
                        <Box key={i} as="span" css={picked ? styles.chipPicked : memberIsDashed(m) ? styles.chipDashed : styles.chip}
                            data-slot="chip" data-member={m.type} data-picked={picked ? "" : undefined}>
                            {memberLabel(m)}
                        </Box>
                    );
                })}
                {active && input(side)}
                {link.predicted[side].map((m, i) => (
                    <Box key={`p${i}`} as="span" css={styles.chipDashed} data-slot="chip" data-predicted="" style={{ paddingLeft: 6, paddingRight: 6 }}>
                        {memberLabel(m)}
                    </Box>
                ))}
            </Box>
        );
    };

    return (
        <>
            <Box css={styles.editor} data-slot="editor" data-error={error ? "" : undefined} data-link={link !== undefined ? "" : undefined} onMouseDown={(e) => e.stopPropagation()}>
                {link === undefined ? input(undefined) : link.single ? (
                    <Box css={styles.linkGrid} style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
                        {half(1)}
                    </Box>
                ) : (
                    <Box css={styles.linkGrid}>
                        {half(0)}
                        <Box as="span" css={styles.arrow} aria-hidden="true" style={{ height: "34px" }}>
                            <FontAwesomeIcon icon={link.halves.isIn ? faMinus : faArrowRightLong} />
                        </Box>
                        {half(1)}
                    </Box>
                )}
                {link === undefined && (resolve !== "" || badge !== "") && (
                    <Box display="flex" alignItems="center" gap="8px" paddingLeft="8px" flex="none">
                        {resolve !== "" && (
                            <Box as="span" css={styles.editorResolve} data-slot="editorResolve">
                                <FontAwesomeIcon icon={faArrowRightLong} style={{ fontSize: "9px" }} />
                                {resolve}
                            </Box>
                        )}
                        {badge !== "" && <Box as="span" css={styles.editorBadge}>{badge}</Box>}
                    </Box>
                )}
            </Box>
            {error && <Box css={styles.editorError} data-slot="editorError" />}
        </>
    );
});
