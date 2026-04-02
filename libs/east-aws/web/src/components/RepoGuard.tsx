/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Outlet, useParams } from 'react-router-dom';
import { useWorkspaceList } from '@elaraai/e3-ui-components';
import { ApiError } from '@elaraai/e3-api-client';
import { API_URL, getRequestOptions } from '../api';
import { LoadingState, ErrorState } from './DisplayStates';

/**
 * Layout guard for /repos/:repo/* routes.
 * Verifies the user has access to the repo before rendering child routes.
 * Shows an access denied error on 403 instead of an infinite loading spinner.
 */
export function RepoGuard() {
  const { repo } = useParams<{ repo: string }>();
  const { isLoading, error } = useWorkspaceList(API_URL, repo!, getRequestOptions());

  if (isLoading) {
    return <LoadingState message="Loading repository..." />;
  }

  if (error) {
    const isForbidden = error instanceof ApiError && error.code === 'forbidden';
    return (
      <ErrorState
        title={isForbidden ? 'Access Denied' : 'Failed to load repository'}
        description={isForbidden ? 'You do not have permission to access this repository.' : undefined}
        error={isForbidden ? undefined : error}
      />
    );
  }

  return <Outlet />;
}
