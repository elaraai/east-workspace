/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The split link cell (B§4.3 — `Sheet Spec.md` §5 row 6): the halves on a
 * `minmax(0,1fr) 16px minmax(0,1fr)` grid inside the cell's padding, the
 * arrow (a minus for an in-place driver) on the first 20 px line, chips
 * mono 10.5 on `bg.muted` with the register's meta only when a half holds a
 * single chip, dashed chips for text / placeholder / a proposal, the faint
 * FROM / TO labels on an empty live half, a lock tag on a locked one — warn
 * when it holds content — and a flagged member's warn treatment with its
 * message as the title.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightLong, faMinus } from "@fortawesome/free-solid-svg-icons";
import { memberIsDashed, memberLabel } from "../model.js";
import { memberMeta, type LinkVocabulary } from "../link/grammar.js";
import { halfWarns, type LinkHalves } from "../link/sides.js";
import type { LinkFlags } from "../link/checks.js";
import type { SheetLinkValue, SheetMemberValue } from "../values.js";

type Styles = Record<string, Record<string, unknown>>;

export interface LinkChipProps {
    styles: Styles;
    member: SheetMemberValue;
    /** The register's line, shown when the half holds a single chip. */
    meta: string;
    /** A proposal or a prediction — dashed. */
    ghost: boolean;
    /** The checks' messages on this member. */
    flags: readonly string[];
}

/** One chip. */
export const LinkChip = memo(function LinkChip({ styles, member, meta, ghost, flags }: LinkChipProps) {
    const dashed = ghost || memberIsDashed(member);
    const flagged = flags.length > 0;
    return (
        <Box
            as="span"
            css={dashed ? styles.chipDashed : styles.chip}
            data-slot="chip"
            data-member={member.type}
            data-flag={flagged ? "" : undefined}
            title={flagged ? flags.join(" · ") : undefined}
            style={flagged ? { color: "var(--chakra-colors-status-warn)", background: "var(--chakra-colors-bg-warning-subtle)", borderColor: "var(--chakra-colors-status-warn)" } : undefined}
        >
            {memberLabel(member)}
            {meta !== "" && <Box as="span" css={styles.chipMeta}>{meta}</Box>}
        </Box>
    );
});

export interface LinkHalfProps {
    styles: Styles;
    half: "from" | "to";
    members: readonly SheetMemberValue[];
    state: LinkHalves["from"];
    vocab: LinkVocabulary | undefined;
    flags: readonly (readonly string[])[];
    ghost: boolean;
    /** The driver's name for the lock tag's title. */
    driverName: string;
}

/** One half: the lock tag or the hint, then the chips. */
export const LinkHalfView = memo(function LinkHalfView({ styles, half, members, state, vocab, flags, ghost, driverName }: LinkHalfProps) {
    const warn = halfWarns(state, members);
    const title = !state.live
        ? `${driverName} has no ${half === "from" ? "source" : "destination"}${state.lock !== "" ? ` · ${state.lock}` : ""}`
        : half === "from" ? "From" : "To";
    return (
        <Box css={styles.half} data-half={half} data-locked={!state.live ? "" : undefined} title={title}>
            {!state.live && state.lock !== "" && (
                <Box as="span" css={warn ? styles.lockWarn : styles.lockTag} data-slot={warn ? "lockWarn" : "lockTag"}>{state.lock}</Box>
            )}
            {state.live && members.length === 0 && <Box as="span" css={styles.halfLabel} data-slot="halfLabel">{half}</Box>}
            {members.map((m, i) => (
                <LinkChip
                    key={i}
                    styles={styles}
                    member={m}
                    meta={members.length === 1 && vocab !== undefined ? memberMeta(m, vocab) : ""}
                    ghost={ghost}
                    flags={flags[i] ?? []}
                />
            ))}
        </Box>
    );
});

export interface LinkCellProps {
    styles: Styles;
    link: SheetLinkValue;
    halves: LinkHalves;
    vocab: LinkVocabulary | undefined;
    flags: LinkFlags;
    /** A proposal — every chip dashed. */
    ghost: boolean;
    driverName: string;
}

/** Renders the split cell. */
export const LinkCell = memo(function LinkCell({ styles, link, halves, vocab, flags, ghost, driverName }: LinkCellProps) {
    return (
        <Box css={styles.linkGrid} data-slot="linkCell" data-sides={halves.sides} data-ghost={ghost ? "" : undefined}>
            <LinkHalfView styles={styles} half="from" members={link.from} state={halves.from} vocab={vocab} flags={flags.from} ghost={ghost} driverName={driverName} />
            <Box as="span" css={styles.arrow} aria-hidden="true" data-slot="arrow">
                <FontAwesomeIcon icon={halves.isIn ? faMinus : faArrowRightLong} />
            </Box>
            <LinkHalfView styles={styles} half="to" members={link.to} state={halves.to} vocab={vocab} flags={flags.to} ghost={ghost} driverName={driverName} />
        </Box>
    );
});
