/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// Discriminated union for selection state
export type Selection =
    | { type: 'none' }
    | { type: 'workspace'; workspace: string }
    | { type: 'task'; workspace: string; task: string }
    | { type: 'input'; workspace: string; path: string };

interface E3ContextValue {
    apiUrl: string;
    repoPath: string;
    selection: Selection;
    setSelection: (selection: Selection) => void;
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
}

const E3Context = createContext<E3ContextValue | null>(null);

interface E3ProviderProps {
    apiUrl: string;
    repoPath: string;
    children: ReactNode;
}

/** bsys Sidebar recipe: collapse state persists to localStorage per user. */
const SIDEBAR_KEY = 'east-ui-extension.sidebar-collapsed';

export function E3Provider({ apiUrl, repoPath, children }: E3ProviderProps) {
    const [selection, setSelection] = useState<Selection>({ type: 'none' });
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
        try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
    });

    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed(prev => {
            const next = !prev;
            try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);

    /* bsys Sidebar recipe: `[` toggles collapse globally, except while typing. */
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key !== '[') return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            toggleSidebar();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggleSidebar]);

    return (
        <E3Context.Provider
            value={{ apiUrl, repoPath, selection, setSelection, sidebarCollapsed, toggleSidebar }}
        >
            {children}
        </E3Context.Provider>
    );
}

export function useE3Context(): E3ContextValue {
    const context = useContext(E3Context);
    if (!context) {
        throw new Error('useE3Context must be used within an E3Provider');
    }
    return context;
}

// Helper to extract workspace from any selection that has one
export function getSelectedWorkspace(selection: Selection): string | null {
    return selection.type === 'none' ? null : selection.workspace;
}
