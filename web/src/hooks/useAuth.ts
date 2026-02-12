/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken } from '../api';

export function useAuth() {
  const navigate = useNavigate();

  const token = getToken();
  const isAuthenticated = token !== null;

  const logout = useCallback(() => {
    localStorage.removeItem('e3_token');
    navigate('/login');
  }, [navigate]);

  return { token, isAuthenticated, logout };
}
