/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Chakra's own parts as a host app draws them under the east-ui `system`
 * (#1091) — no palette and no variant unless one is named — reached at
 * `?host=parts`. A host such as e3-cloud renders these beside the East
 * components, so the responsive suite holds the theme's defaults for them to
 * the design system, in both themes. Each part carries a `data-host-part`
 * hook for the suite to find it by.
 */

import { Box, Button, IconButton, Stack, Switch } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

export function HostParts() {
    return (
        <Box padding="6" bg="bg.canvas" minH="100vh">
            <Stack gap="4" align="flex-start">
                <Button data-host-part="button">Apply</Button>
                <IconButton data-host-part="icon-button" aria-label="Add">
                    <FontAwesomeIcon icon={faPlus} />
                </IconButton>
                <Switch.Root data-host-part="switch" defaultChecked>
                    <Switch.HiddenInput />
                    <Switch.Control>
                        <Switch.Thumb />
                    </Switch.Control>
                    <Switch.Label>Live</Switch.Label>
                </Switch.Root>
                <Button data-host-part="button-red" colorPalette="red">Delete</Button>
                <Button data-host-part="button-danger" colorPalette="danger">Discard</Button>
            </Stack>
        </Box>
    );
}
