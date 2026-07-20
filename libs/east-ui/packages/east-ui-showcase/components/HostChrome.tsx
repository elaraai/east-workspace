/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Demo *host-injected* app-bar / rail chrome for the `<App>` examples (#367).
 *
 * These are plain showcase React components — NOT east-ui IR. `main.tsx` wraps
 * the app in `<AppProvider barEnd railFooter>` with them, so the east-ui `<App>`
 * examples (appBasic / appCompact / appCondensed) render this host chrome in their
 * bar / rail via `useAppSlots()`. This dogfoods `AppProvider` end-to-end: a real
 * React tree injected into an East-authored shell.
 */

import { Fragment } from "react";
import { Box, Flex, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";

/**
 * Trailing app-bar chrome a host app would inject: notifications + an avatar.
 *
 * Returned as a **Fragment of individual items** (not a `<Flex gap>` wrapper) so
 * each becomes a direct child of the app bar's `barEnd` flex and shares its single
 * gap with the built-in theme toggle — one rhythm, not a nested one. A wrapping
 * element with its own `gap` would create a second, independent spacing system.
 */
export function HostBarEnd() {
    return (
        <Fragment>
            <chakra.button
                type="button"
                aria-label="Notifications"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                w="24px"
                h="24px"
                border="0"
                borderRadius="md"
                background="transparent"
                color="fg.muted"
                cursor="pointer"
                _hover={{ color: "brand.fg", background: "bg.muted" }}
            >
                <FontAwesomeIcon icon={faBell} style={{ fontSize: "13px" }} />
            </chakra.button>
            <Box
                w="24px"
                h="24px"
                borderRadius="full"
                background="brand.600"
                color="white"
                display="flex"
                alignItems="center"
                justifyContent="center"
                fontSize="9px"
                fontWeight="bold"
                letterSpacing="0.02em"
                title="Signed in as Operator"
            >
                OP
            </Box>
        </Fragment>
    );
}

/** Pinned rail footer a host app would inject: an account card. */
export function HostRailFooter() {
    return (
        <Flex align="center" gap="2.5" px="2" py="1">
            <Box
                w="24px"
                h="24px"
                borderRadius="full"
                background="brand.600"
                color="white"
                display="flex"
                alignItems="center"
                justifyContent="center"
                fontSize="9px"
                fontWeight="bold"
                flexShrink={0}
            >
                OP
            </Box>
            <Box minW="0">
                <Box fontSize="11px" fontWeight="semibold" color="fg" lineHeight="1.2">Operator</Box>
                <Box fontSize="9.5px" color="fg.muted" lineHeight="1.2">acme.ops</Box>
            </Box>
        </Flex>
    );
}
