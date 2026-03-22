/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Box, Text, VStack, HoverCard, Portal } from '@chakra-ui/react';

const ITEM_LIST_THRESHOLD = 3;

export function ItemListCell({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <Text fontSize="sm" color="text.secondary">—</Text>;
  }

  if (items.length <= ITEM_LIST_THRESHOLD) {
    return (
      <Text fontSize="sm" color="text.secondary">{items.join(', ')}</Text>
    );
  }

  return (
    <HoverCard.Root>
      <HoverCard.Trigger asChild>
        <Text as="span" fontSize="sm" color="link.color" cursor="pointer" _hover={{ textDecoration: 'underline' }}>
          {items.length} items
        </Text>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content maxW="300px" p={3}>
            <HoverCard.Arrow />
            <Box maxH="200px" overflowY="auto">
              <VStack gap={1} align="start">
                {items.map((item) => (
                  <Text key={item} fontSize="xs" color="text.primary" fontFamily="mono">{item}</Text>
                ))}
              </VStack>
            </Box>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}
