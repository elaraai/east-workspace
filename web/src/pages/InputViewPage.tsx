/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import { InputPreview } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';

export function InputViewPage() {
  const { repo, workspace, '*': splat } = useParams<{ repo: string; workspace: string; '*': string }>();

  // Reconstruct dot-path from URL segments: "inputs/sales" → ".inputs.sales"
  const path = useMemo(() => {
    if (!splat) return null;
    return '.' + splat.split('/').join('.');
  }, [splat]);

  if (!path) return null;

  return (
    <Box h="calc(100vh - 120px)" mx={-6} mt={-3} mb={-6}>
      <InputPreview
        key={`${workspace}:${path}`}
        apiUrl={API_URL}
        repo={repo!}
        workspace={workspace!}
        path={path}
        requestOptions={getRequestOptions()}
      />
    </Box>
  );
}
