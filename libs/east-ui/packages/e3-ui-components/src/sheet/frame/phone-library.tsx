/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's Library in a phone's view (`Mobile Sheet Spec.md` SH11, R7): no
 * drag there, so each tab says what a tap does and lists a 44px row a card. A
 * tap on an author's card sets it on the selected row or band, as its drop
 * does, its row marked `current` while the target holds it; a tap on a template
 * adds it below the selected row, as its ⏎ does. A tap on a column closes the
 * view and pages the window to it, its eye still hiding it. A tab with nothing
 * to list, whatever its filters, keeps the Library's own empty state.
 *
 * @packageDocumentation
 */

import { useContext, useRef, type ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { FrameDrawer, useSlotStyles } from "@elaraai/east-ui-components/internal";
import { getSomeorUndefined, type LibraryItemValue } from "@elaraai/east-ui-components";
import { closeFramePane } from "../../shared/schedule/open-pane.js";
import { useSheetPhoneLibrary } from "../index.js";
import { useSheetWords } from "../words.js";

/** Props of {@link PhoneCards}. */
export interface PhoneCardsProps {
    /** The tab's library: what its cards drop from. */
    library: string;
    /** What the hint says: a tap sets an author's card, or adds a template. */
    verb: "set" | "add";
    /** Its cards, as the Library lists them. */
    items: readonly LibraryItemValue[];
    /** The Library, drawn on a wider frame and for an empty tab. */
    children: ReactNode;
}

/** An author's tab's or the templates' cards in a phone's view — see the module docs. */
export function PhoneCards({ library, verb, items, children }: PhoneCardsProps) {
    const { m } = useSheetWords();
    const phone = useContext(FrameDrawer);
    const styles = useSlotStyles("sheet");
    const cards = useSheetPhoneLibrary();
    if (!phone || items.length === 0) return <>{children}</>;
    const target = cards.targetOf(library);
    return (
        <Box css={styles.phoneList} data-sheet-phone-list="">
            <Box css={styles.phoneHint} data-sheet-phone-hint="">{verb === "set" ? m.libraryPhoneSet({ target }) : m.libraryPhoneAdd({ target })}</Box>
            {items.map((item) => {
                const meta = getSomeorUndefined(item.sublabel);
                return (
                    <Box key={item.key} css={styles.phoneRow} data-sheet-phone-row={item.key}>
                        <chakra.button type="button" css={styles.phoneRowMain} aria-disabled={target === undefined ? true : undefined}
                            onClick={() => { if (target !== undefined) cards.tap(library, item.key); }}>
                            <Box as="span" css={styles.phoneRowLabel}>{item.label}</Box>
                            {cards.holds(library, item.key) && <Box as="span" css={styles.phoneRowMark} data-sheet-phone-current="">{m.libraryPhoneCurrent()}</Box>}
                            {meta !== undefined && <Box as="span" css={styles.phoneRowMeta}>{meta}</Box>}
                        </chakra.button>
                    </Box>
                );
            })}
        </Box>
    );
}

/** A column of the phone's Columns tab. */
export interface PhoneColumn {
    key: string;
    header: string;
    /** Its kind, in words. */
    kind: string;
    /** The viewer hides it. */
    hidden: boolean;
    /** What its eye says. */
    eye: string;
    /** The last column shown, whose eye stays. */
    last: boolean;
}

/** Props of {@link PhoneColumns}. */
export interface PhoneColumnsProps {
    /** The declared columns, in their order. */
    columns: readonly PhoneColumn[];
    /** The column the sheet pins on a phone, by its key. */
    pin: string | undefined;
    /** Hides a column, or shows it again. */
    onToggle: (key: string) => void;
    /** The Library, drawn on a wider frame. */
    children: ReactNode;
}

/** The Columns tab in a phone's view — see the module docs. */
export function PhoneColumns({ columns, pin, onToggle, children }: PhoneColumnsProps) {
    const { m } = useSheetWords();
    const phone = useContext(FrameDrawer);
    const styles = useSlotStyles("sheet");
    const { goToColumn } = useSheetPhoneLibrary();
    const list = useRef<HTMLDivElement | null>(null);
    if (!phone) return <>{children}</>;
    const pinned = columns.find((col) => col.key === pin)?.header;
    const go = (col: PhoneColumn) => {
        closeFramePane(list.current, m.libraryPane());
        if (col.key === pin) return;
        // A column it hides comes back first, and is gone to once the grid has drawn it.
        if (col.hidden) {
            onToggle(col.key);
            requestAnimationFrame(() => goToColumn(col.key));
        } else goToColumn(col.key);
    };
    return (
        <Box ref={list} css={styles.phoneList} data-sheet-phone-list="">
            <Box css={styles.phoneHint} data-sheet-phone-hint="">{m.libraryPhoneColumns({ pinned })}</Box>
            {columns.map((col) => (
                <Box key={col.key} css={styles.phoneRow} data-sheet-phone-row={col.key} data-off={col.hidden ? "" : undefined}>
                    <chakra.button type="button" css={styles.phoneRowMain} aria-label={m.libraryPhoneGo({ header: col.header })} onClick={() => go(col)}>
                        <Box as="span" css={styles.phoneRowLabel}>{col.header}</Box>
                        <Box as="span" css={styles.phoneRowMeta}>{m.libraryPhoneKind({ kind: col.kind, pinned: col.key === pin })}</Box>
                        <FontAwesomeIcon icon={faArrowRight} aria-hidden />
                    </chakra.button>
                    <chakra.button type="button" css={styles.phoneRowEye} aria-label={col.eye} title={col.eye} aria-disabled={col.last ? true : undefined} data-sheet-phone-eye=""
                        onClick={() => { if (!col.last) onToggle(col.key); }}>
                        <FontAwesomeIcon icon={col.hidden ? faEyeSlash : faEye} aria-hidden />
                    </chakra.button>
                </Box>
            ))}
        </Box>
    );
}
