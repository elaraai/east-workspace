/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Card, Stat } from '@chakra-ui/react';

interface StatCardProps {
  label: string;
  value: number | string;
  helpText?: string;
}

export function StatCard({ label, value, helpText }: StatCardProps) {
  return (
    <Card.Root variant="outline" borderColor="border.primary" borderRadius="md" bg="card.bg">
      <Card.Body p={5}>
        <Stat.Root>
          <Stat.Label color="text.secondary" fontSize="sm">{label}</Stat.Label>
          <Stat.ValueText color="text.primary" fontSize="2xl" fontWeight={700} lineHeight="1.2">
            {value}
          </Stat.ValueText>
          {helpText && (
            <Stat.HelpText color="text.tertiary" fontSize="xs">{helpText}</Stat.HelpText>
          )}
        </Stat.Root>
      </Card.Body>
    </Card.Root>
  );
}
