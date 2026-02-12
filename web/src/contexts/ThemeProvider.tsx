/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useEffect, useMemo, useCallback, useState, type ReactNode } from 'react';
import { ThemeContext, type ThemeMode } from './ThemeContext';

interface ThemeProviderProps {
  children: ReactNode;
  defaultMode?: ThemeMode;
}

const STORAGE_KEY = 'e3_theme_mode';

export const ThemeProvider = ({
  children,
  defaultMode = 'light',
}: ThemeProviderProps) => {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return defaultMode;
  });

  useEffect(() => {
    document.documentElement.className = mode;
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggleTheme = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(
    () => ({
      mode,
      toggleTheme,
      isDark: mode === 'dark',
    }),
    [mode, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
