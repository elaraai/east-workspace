/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo } from 'react';
import { useToken } from '@chakra-ui/react';

export const useScrollbarStyles = () => {
  const [scrollbarThumb, scrollbarThumbHover] = useToken('colors', [
    'scrollbar.thumb',
    'scrollbar.thumb.hover',
  ]);

  return useMemo(
    () => ({
      '&::-webkit-scrollbar': {
        width: '6px',
        height: '6px',
      },
      '&::-webkit-scrollbar-track': {
        background: 'transparent',
      },
      '&::-webkit-scrollbar-thumb': {
        background: scrollbarThumb,
        borderRadius: '3px',
      },
      '&::-webkit-scrollbar-thumb:hover': {
        background: scrollbarThumbHover,
      },
      '&::-webkit-scrollbar-corner': {
        background: 'transparent',
      },
    }),
    [scrollbarThumb, scrollbarThumbHover]
  );
};
