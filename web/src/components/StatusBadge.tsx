/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Badge } from '@chakra-ui/react';

const statusColors: Record<string, string> = {
  'up-to-date': 'green',
  'ready': 'blue',
  'waiting': 'gray',
  'in-progress': 'cyan',
  'failed': 'red',
  'error': 'red',
  'stale-running': 'yellow',
  'stale': 'yellow',
  'unset': 'gray',
  'deployed': 'blue',
  'success': 'green',
  'running': 'cyan',
  'cached': 'green',
  'skipped': 'gray',
};

export function StatusBadge({ status }: { status: string }) {
  const colorPalette = statusColors[status] ?? 'gray';
  return (
    <Badge colorPalette={colorPalette} variant="subtle" size="sm">
      {status}
    </Badge>
  );
}
