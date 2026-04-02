/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useState } from 'react';
import { Button, HStack, Popover, Portal, Text } from '@chakra-ui/react';

export interface ConfirmPopoverProps {
  /** The trigger element (rendered via asChild) */
  trigger: React.ReactNode;
  /** Confirmation message shown in the popover body */
  message: string;
  /** Label for the confirm button */
  confirmLabel?: string;
  /** Color palette for the confirm button */
  confirmColorPalette?: string;
  /** Whether the confirm action is in progress */
  loading?: boolean;
  /** Called when the user confirms */
  onConfirm: () => void;
}

export function ConfirmPopover({
  trigger,
  message,
  confirmLabel = 'Confirm',
  confirmColorPalette = 'red',
  loading = false,
  onConfirm,
}: ConfirmPopoverProps) {
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Popover.Trigger asChild>
        {trigger}
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content>
            <Popover.Arrow />
            <Popover.Body>
              <Text fontSize="sm" mb={3}>{message}</Text>
              <HStack gap={2} justify="flex-end">
                <Button size="xs" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  colorPalette={confirmColorPalette}
                  variant="solid"
                  onClick={handleConfirm}
                  disabled={loading}
                >
                  {loading ? 'Working...' : confirmLabel}
                </Button>
              </HStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
