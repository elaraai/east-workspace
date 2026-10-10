/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import type { ReactNode } from "react";
import { Box, type BoxProps } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";

/** The shared Plan/Calendar inspector heading, using the inspector's existing recipe slots. */
export function ScheduleInspectorHead({ styles, kind, title, when, status, pending }: {
    styles: Record<string, BoxProps["css"]>;
    kind: { name: string; icon: string }; title: string; when: ReactNode;
    status?: { label: string; tone: { type: string }; ring: boolean } | undefined;
    pending?: "pending" | "new" | undefined;
}) {
    return <Box css={styles.head}>
        <Box css={styles.headRow}>
            <Box as="span" css={styles.kindTile} aria-hidden="true"><FontAwesomeIcon icon={["fas", kind.icon as IconName]} /></Box>
            <Box css={styles.headText}>
                <Box css={styles.eyebrow} data-inspector-kind="">{kind.name}</Box>
                <Box css={styles.name} data-inspector-title="">{title}</Box>
                <Box css={styles.when} data-inspector-when="">{when}</Box>
            </Box>
        </Box>
        {(status !== undefined || pending !== undefined) && <Box css={styles.marks}>
            {pending !== undefined && <Box as="span" css={styles.chip} data-state={pending}>{pending === "new" ? "New" : "Pending"}</Box>}
            {status !== undefined && <Box as="span" css={styles.status} data-tone={status.tone.type} data-ring={status.ring ? "" : undefined} data-inspector-status="">{status.label}</Box>}
        </Box>}
    </Box>;
}
