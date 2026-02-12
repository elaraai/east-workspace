/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { PlatformLayout } from './layouts/PlatformLayout';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { RepoListPage } from './pages/RepoListPage';
import { RepoDashboardPage } from './pages/RepoDashboardPage';
import { WorkspaceViewPage } from './pages/WorkspaceViewPage';
import { AdminPage } from './pages/AdminPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<PlatformLayout />}>
          <Route path="/" element={<Navigate to="/repos" replace />} />
          <Route path="/repos" element={<RepoListPage />} />
          <Route path="/repos/:repo" element={<RepoDashboardPage />} />
          <Route path="/repos/:repo/workspaces/:workspace" element={<WorkspaceViewPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/repos" replace />} />
    </Routes>
  );
}
