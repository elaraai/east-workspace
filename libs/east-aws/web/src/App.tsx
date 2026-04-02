/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { OverlayManagerProvider } from '@elaraai/east-ui-components';
import { AuthGuard } from './components/AuthGuard';
import { RepoGuard } from './components/RepoGuard';
import { PlatformLayout } from './layouts/PlatformLayout';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { RepoListPage } from './pages/RepoListPage';
import { RepoDashboardPage } from './pages/RepoDashboardPage';
import { WorkspaceViewPage } from './pages/WorkspaceViewPage';
import { TaskViewPage } from './pages/TaskViewPage';
import { InputViewPage } from './pages/InputViewPage';
import { AdminPage } from './pages/AdminPage';
import { AdminRepoDetailPage } from './pages/AdminRepoDetailPage';

export function App() {
  return (
    <OverlayManagerProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<AuthGuard />}>
          <Route element={<PlatformLayout />}>
            <Route path="/" element={<Navigate to="/repos" replace />} />
            <Route path="/repos" element={<RepoListPage />} />
            <Route path="/repos/:repo" element={<RepoGuard />}>
              <Route index element={<RepoDashboardPage />} />
              <Route path="workspaces/:workspace" element={<WorkspaceViewPage />} />
              <Route path="workspaces/:workspace/tasks/:task" element={<TaskViewPage />} />
              <Route path="workspaces/:workspace/data/*" element={<InputViewPage />} />
            </Route>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/repos/:repo" element={<AdminRepoDetailPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/repos" replace />} />
      </Routes>
    </OverlayManagerProvider>
  );
}
