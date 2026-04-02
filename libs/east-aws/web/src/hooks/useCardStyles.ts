/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo } from 'react';

export const useCardStyles = () => {
  return useMemo(
    () => ({
      bg: 'card.bg',
      borderRadius: '8px',
      border: '1px solid',
      borderColor: 'border.primary',
      transition: 'all 0.15s ease',
      cursor: 'pointer',
      _hover: {
        borderColor: 'border.hover',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
      },
      _active: {
        borderColor: 'brand.600',
      },
      _focus: {
        outline: 'none',
        borderColor: 'brand.500',
      },
    }),
    []
  );
};
