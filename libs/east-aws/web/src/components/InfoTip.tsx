/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * ToggleTip / InfoTip — Chakra v3 snippet pattern.
 * Looks like a tooltip, works like a popover (accessible, click-triggered).
 * See: https://chakra-ui.com/docs/components/toggle-tip
 */

import { forwardRef } from 'react';
import { Box, Popover, Portal } from '@chakra-ui/react';
import { FiInfo } from 'react-icons/fi';

export interface ToggleTipProps extends Popover.RootProps {
  showArrow?: boolean;
  portalled?: boolean;
  content: React.ReactNode;
  children: React.ReactNode;
}

export const ToggleTip = forwardRef<HTMLDivElement, ToggleTipProps>(
  function ToggleTip({ showArrow, portalled = true, content, children, ...rest }, ref) {
    const body = (
      <Popover.Positioner>
        <Popover.Content ref={ref} w="auto" fontSize="xs" maxW="280px" p={2} whiteSpace="pre-line">
          {showArrow && <Popover.Arrow />}
          {content}
        </Popover.Content>
      </Popover.Positioner>
    );

    return (
      <Popover.Root positioning={{ gutter: 4 }} {...rest}>
        <Popover.Trigger asChild>{children}</Popover.Trigger>
        {portalled ? <Portal>{body}</Portal> : body}
      </Popover.Root>
    );
  }
);

export const InfoTip = forwardRef<HTMLDivElement, Omit<ToggleTipProps, 'children'>>(
  function InfoTip(props, ref) {
    return (
      <ToggleTip ref={ref} showArrow {...props}>
        <Box as="button" color="text.tertiary" cursor="help" display="inline-flex" alignItems="center" lineHeight={1}>
          <FiInfo size={12} />
        </Box>
      </ToggleTip>
    );
  }
);
