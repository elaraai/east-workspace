/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Box } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';
import { useThemeMode } from '../theme-mode';

/** Light/dark switch for the preview. Sits in the toolbar's right cluster; shows
 *  the mode you'd switch TO (moon in light, sun in dark). Defaults to VS Code's
 *  theme and follows it live until first used. */
export function ThemeToggle() {
    const [mode, toggle] = useThemeMode();
    const dark = mode === 'dark';
    const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    return (
        <Box
            as="button"
            onClick={toggle}
            aria-label={label}
            title={label}
            width="22px"
            height="22px"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            border="0"
            background="transparent"
            color="fg.muted"
            cursor="pointer"
            borderRadius="{radii.sm}"
            _hover={{ color: 'brand.700', background: 'bg.muted' }}
        >
            <FontAwesomeIcon icon={dark ? faSun : faMoon} style={{ fontSize: '12px' }} />
        </Box>
    );
}
