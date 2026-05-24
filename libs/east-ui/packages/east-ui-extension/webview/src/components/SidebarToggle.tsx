/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Box } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

interface SidebarToggleProps {
    icon: IconDefinition;
    onClick: () => void;
    'aria-label': string;
}

/** 22×22 chevron toggle — bsys Sidebar header button dims. Lives in the
 *  section-eyebrow row when expanded, beneath the app-mark when collapsed. */
export function SidebarToggle({ icon, onClick, ...aria }: SidebarToggleProps) {
    return (
        <Box
            as="button"
            onClick={onClick}
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
            {...aria}
        >
            <FontAwesomeIcon icon={icon} style={{ fontSize: '10px' }} />
        </Box>
    );
}
