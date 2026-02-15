/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { createContext, useContext } from 'react';
import type { WhoamiResponse } from '@elaraai/e3-admin-client';

export const UserContext = createContext<WhoamiResponse | undefined>(undefined);

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within AuthGuard');
  }
  return context;
};
