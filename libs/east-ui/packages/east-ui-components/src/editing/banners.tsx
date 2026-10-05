/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session's banners (#1184) — what the history bar says under its
 * buttons, for a host that leaves that line to its banners: a builder's
 * frame, whose toolbar keeps one row (`historyToolbarItem({ showError: false
 * })`). In the order a builder lists them: an Apply's conflicts, naming each
 * issue's place; an Apply the source refused, with its reasons; a write with
 * no answer, with Retry; an Apply whose result could not be read back, with
 * Retry; and drafts the source moved under, with Discard. Each follows the
 * session, and leaves when what it reports does.
 *
 * @packageDocumentation
 */
import { useMemo, useSyncExternalStore } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { BannerView } from "../feedback/banner/index.js";
import type { HistoryAction } from "./HistoryBar.js";
import type { EditIssue, EditSession } from "./session.js";
import { sessionErrorText, type EditingWords } from "./messages.js";

type Styles = Record<string, Record<string, unknown>>;

/** How many of an Apply's issues a banner names before it counts the rest. */
const SHOWN_ISSUES = 3;

/**
 * Props of {@link SessionBanners}.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface SessionBannersProps<W> {
    /** The editing session. */
    session: EditSession<W>;
    /** The collection's words. */
    words: EditingWords;
    /**
     * Runs a history action, as the history bar does — the collection first
     * commits what it has open: Retry sends the same request again (`apply`)
     * or reads the result again (`refresh`), and Discard drops the drafts.
     */
    onAction: (action: HistoryAction) => void;
    /**
     * Where an issue is, in the collection's words — its row (`J-0002`,
     * `row 4`); empty for the source as a whole. The issue's entry by default.
     */
    where?: ((issue: EditIssue) => string) | undefined;
    /** An issue's text as the collection shows it — its own issues read back in its words; as written by default. */
    issueText?: ((message: string) => string) | undefined;
}

/**
 * The session's banners — see the module docs. They follow the session
 * itself, so they stay current wherever the host draws them.
 *
 * @typeParam W - The collection's projection of an entry
 * @param props - The session, the collection's words, its history actions, and how it names an issue
 * @returns The banners that apply now, each wrapped in an element naming its kind (`data-session-banner`)
 */
export function SessionBanners<W>({ session, words, onAction, where, issueText }: SessionBannersProps<W>) {
    useSyncExternalStore(session.subscribe, session.getSnapshot);
    const recipe = useSlotRecipe({ key: "editHistory" });
    const styles = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    const { m } = words;
    const { status, error, stale } = session;
    const issues = (list: readonly EditIssue[]) => {
        const shown = list.slice(0, SHOWN_ISSUES);
        const more = list.length - shown.length;
        return (
            <Box as="ul" css={styles.bannerIssues}>
                {shown.map((issue, i) => (
                    <Box as="li" key={i} css={styles.bannerIssue}>
                        {m.bannerIssue({ where: where?.(issue) ?? issue.entry, message: issueText?.(issue.message) ?? issue.message })}
                    </Box>
                ))}
                {more > 0 && <Box as="li" css={styles.bannerIssue}>{m.bannerMore({ n: more, count: words.number(more) })}</Box>}
            </Box>
        );
    };
    const action = (label: string, run: HistoryAction) => (
        <Button size="xs" variant="outline" data-banner-action={run} onClick={() => onAction(run)}>{label}</Button>
    );
    const errorText = error === undefined ? undefined : sessionErrorText(error, words);
    return (
        <>
            {status === "conflict" && (
                <Box data-session-banner="conflict">
                    <BannerView status="warning" title={m.bannerConflict({ n: session.issues.length, count: words.number(session.issues.length) })}
                        description={issues(session.issues)} />
                </Box>
            )}
            {status === "rejected" && (
                <Box data-session-banner="rejected">
                    <BannerView status="error" title={m.bannerRejected()} description={issues(session.issues)} />
                </Box>
            )}
            {status === "unknown" && (
                <Box data-session-banner="unknown">
                    <BannerView status="warning" title={m.bannerUnknown()} description={errorText} actions={action(m.retryRequest(), "apply")} />
                </Box>
            )}
            {status === "reconciling" && errorText !== undefined && (
                <Box data-session-banner="confirm">
                    <BannerView status="warning" title={m.bannerConfirmFailed()} description={errorText} actions={action(m.retryRefresh(), "refresh")} />
                </Box>
            )}
            {stale && (
                <Box data-session-banner="stale">
                    <BannerView status="stale" title={m.bannerStale()} actions={action(m.discard(), "discard")} />
                </Box>
            )}
        </>
    );
}
