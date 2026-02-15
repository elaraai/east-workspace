/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import { useWorkspaceStatus, TaskPreview } from '@elaraai/e3-ui-components';
import { API_URL, getRequestOptions } from '../api';

export function TaskViewPage() {
  const { repo, workspace, task } = useParams<{ repo: string; workspace: string; task: string }>();

  const { data: status } = useWorkspaceStatus(API_URL, repo!, workspace!, getRequestOptions(), {
    refetchInterval: 1000,
    staleTime: 0,
    structuralSharing: false,
  });

  const taskInfo = useMemo(() => {
    if (!status || !task) return null;
    return status.tasks.find((t) => t.name === task) ?? null;
  }, [status, task]);

  const outputHash = useMemo(() => {
    if (!status || !taskInfo?.output) return null;
    const outputDataset = status.datasets.find((d) => d.path === taskInfo.output);
    return outputDataset?.hash?.type === 'some' ? outputDataset.hash.value : null;
  }, [status, taskInfo?.output]);

  return (
    <Box h="calc(100vh - 120px)" mx={-6} mt={-3} mb={-6}>
      <TaskPreview
        key={`${workspace}:${task}`}
        apiUrl={API_URL}
        repo={repo!}
        workspace={workspace!}
        task={task!}
        taskInfo={taskInfo}
        outputHash={outputHash}
        requestOptions={getRequestOptions()}
      />
    </Box>
  );
}
