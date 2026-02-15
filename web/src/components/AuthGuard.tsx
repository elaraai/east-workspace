/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getToken } from '../api';
import { useWhoami } from '../hooks/useAdminApi';
import { UserContext } from '../contexts/UserContext';
import { LoadingState } from './DisplayStates';

export function AuthGuard() {
  const location = useLocation();

  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <AuthenticatedOutlet />;
}

function AuthenticatedOutlet() {
  const { data: user, isLoading } = useWhoami();

  if (isLoading) {
    return <LoadingState message="Loading..." />;
  }

  // If whoami fails, show loading while the global AuthError handler
  // in main.tsx attempts refresh and redirects to login if needed.
  if (!user) {
    return <LoadingState message="Loading..." />;
  }

  return (
    <UserContext.Provider value={user}>
      <Outlet />
    </UserContext.Provider>
  );
}
