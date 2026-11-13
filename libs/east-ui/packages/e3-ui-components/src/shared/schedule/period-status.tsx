/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a period builder's toolbar says of its period's status, the Roster's and the Allocation's alike (#1595): the date
 * picker's marks and their legend, and what the status may say, each laid out unseen in the status's slot so the slot is
 * the widest of them, a status changing neither moving the controls beside it nor folding the row.
 *
 * @packageDocumentation
 */

import { Box } from "@chakra-ui/react";

/** A builder's recipe: the parts these draw with are its `pickerDot`, `pickerLegend`, `legendItem` and `status`. */
type Styles = Record<string, Record<string, unknown>>;

/** The picker's marks, each beside its word in its legend. */
const PICKER_MARKS = [{ mark: "published", word: "Published" }, { mark: "draft", word: "Draft" }, { mark: "empty", word: "Not started" }] as const;

/**
 * A period's mark in the date picker.
 *
 * @param props - The builder's styles, and the mark: `published`, `draft` or `empty`
 * @returns The mark
 */
export function PickerDot({ styles, mark }: { styles: Styles; mark: string }) {
    return <Box as="span" css={styles.pickerDot} data-state={mark} />;
}

/**
 * The picker's legend: each mark beside its word.
 *
 * @param props - The builder's styles, and whose legend it is, which its items name
 * @returns The legend
 */
export function PickerLegend({ styles, scope }: { styles: Styles; scope: "roster" | "allocation" }) {
    return <Box as="span" css={styles.pickerLegend}>{PICKER_MARKS.map(({ mark, word }) =>
        <Box as="span" key={mark} css={styles.legendItem} {...{ [`data-${scope}-picker-legend`]: mark }}><PickerDot styles={styles} mark={mark} />{word}</Box>)}</Box>;
}

/**
 * What the status may say, each word laid out unseen in its slot. The app's own case, known by its name alone, stands
 * once it is said.
 *
 * @param props - The builder's styles, what the status says now, and anything more this builder's status may say
 * @returns The words, for the status's slot
 */
export function StatusWords({ styles, status, more }: { styles: Styles; status: string | undefined; more?: readonly string[] | undefined }) {
    const words = [...new Set(["Draft", "Published", "Not started", "Publishing", ...(more ?? []), ...(status === undefined ? [] : [status])])];
    return <>{words.map(word => <Box as="span" key={word} css={styles.status} data-widest-word={word} aria-hidden="true" />)}</>;
}
