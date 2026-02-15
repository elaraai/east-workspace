/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import { useWorkspaceStatus, InputPreview } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';

export function InputViewPage() {
  const { repo, workspace, '*': splat } = useParams<{ repo: string; workspace: string; '*': string }>();

  // Reconstruct dot-path from URL segments: "inputs/sales" → ".inputs.sales"
  const path = useMemo(() => {
    if (!splat) return null;
    return '.' + splat.split('/').join('.');
  }, [splat]);

  const { data: status } = useWorkspaceStatus(API_URL, repo!, workspace!, getRequestOptions(), {
    refetchInterval: 1000,
    staleTime: 0,
    structuralSharing: false,
  });

  const inputInfo = useMemo(() => {
    if (!status || !path) return null;
    return status.datasets.find((d) => d.path === path) ?? null;
  }, [status, path]);

  if (!path) return null;

  return (
    <Box h="calc(100vh - 120px)" mx={-6} mt={-3} mb={-6}>
      <InputPreview
        key={`${workspace}:${path}`}
        apiUrl={API_URL}
        repo={repo!}
        workspace={workspace!}
        path={path}
        inputInfo={inputInfo}
        requestOptions={getRequestOptions()}
      />
    </Box>
  );
}
