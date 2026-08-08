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
import { faBell, faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { useColorMode } from "@elaraai/east-ui-components";

/**
 * Trailing app-bar chrome a host app would inject: notifications, a **theme
 * toggle**, and an avatar. This is the recommended way to put a dark/light toggle
 * in the bar — the host owns colour mode and injects the control (the east-ui
 * `<App>`'s built-in `themeToggle` prop is just a fallback for pure-East surfaces
 * that have no host, and is off by default).
 *
 * Returned as a **Fragment of individual items** (not a `<Flex gap>` wrapper) so
 * each becomes a direct child of the app bar's `barEnd` flex and shares its single
 * gap. A wrapping element with its own `gap` would create a second, independent
 * spacing system.
 */
export function HostBarEnd() {
    const [mode, toggleMode] = useColorMode();
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
            <chakra.button
                type="button"
                aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                onClick={toggleMode}
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
                <FontAwesomeIcon icon={mode === "dark" ? faSun : faMoon} style={{ fontSize: "13px" }} />
            </chakra.button>
            <Box
                w="24px"
                h="24px"
                borderRadius="full"
                background="brand.600"
                color="fg.inverse"
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
                color="fg.inverse"
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
