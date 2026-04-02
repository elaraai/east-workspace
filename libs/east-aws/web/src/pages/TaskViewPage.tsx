/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import { useTaskGet, TaskPreview, StatusDisplay } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';

export function TaskViewPage() {
  const { repo, workspace, task } = useParams<{ repo: string; workspace: string; task: string }>();

  const { data: taskDetails } = useTaskGet(API_URL, repo!, workspace!, task!, getRequestOptions(), {
    staleTime: 0,
  });

  // Convert TreePath to dot-path string (e.g. ".tasks.render_ui")
  const outputPath = useMemo(() => {
    if (!taskDetails) return null;
    return taskDetails.output.map(s => '.' + s.value).join('');
  }, [taskDetails]);

  if (!outputPath) {
    return (
      <Box h="calc(100vh - 120px)" mx={-6} mt={-3} mb={-6}>
        <StatusDisplay variant="loading" title="Loading task..." />
      </Box>
    );
  }

  return (
    <Box h="calc(100vh - 120px)" mx={-6} mt={-3} mb={-6}>
      <TaskPreview
        key={`${workspace}:${task}`}
        apiUrl={API_URL}
        repo={repo!}
        workspace={workspace!}
        task={task!}
        output={outputPath}
        requestOptions={getRequestOptions()}
      />
    </Box>
  );
}
