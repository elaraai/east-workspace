/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Box, Text, SimpleGrid, Card } from '@chakra-ui/react';
import { FiDatabase, FiUsers, FiActivity } from 'react-icons/fi';
import type { ReactNode } from 'react';

export function AdminPage() {
  return (
    <Box>
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
        <AdminCard
          icon={<FiDatabase size={20} />}
          title="Repository Management"
          description="Create, delete, and configure repositories."
        />
        <AdminCard
          icon={<FiUsers size={20} />}
          title="User Management"
          description="Manage users and access control."
        />
        <AdminCard
          icon={<FiActivity size={20} />}
          title="Monitoring"
          description="System health, execution logs, and metrics."
        />
      </SimpleGrid>
    </Box>
  );
}

function AdminCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <Card.Root
      variant="outline"
      borderColor="border.primary"
      borderRadius="md"
      bg="card.bg"
      transition="all 0.15s ease"
      _hover={{ borderColor: 'border.hover', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}
    >
      <Card.Body p={5}>
        <Box color="brand.500" mb={3}>
          {icon}
        </Box>
        <Text fontSize="sm" fontWeight={600} color="text.primary" mb={2}>
          {title}
        </Text>
        <Text color="text.secondary" fontSize="sm">
          {description}
        </Text>
      </Card.Body>
    </Card.Root>
  );
}
