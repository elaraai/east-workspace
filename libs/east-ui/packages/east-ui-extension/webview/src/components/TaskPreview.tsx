/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useE3Context } from '../context/E3Context';
import {
    TaskPreview as TaskPreviewInner,
    StatusDisplay,
    ReactiveDatasetProvider,
} from '@elaraai/e3-ui-components';
import { InputPreview } from './InputPreview';

/**
 * Outer component that handles context. Wraps the renderer in
 * ReactiveDatasetProvider so Data.bind reads/writes inside UI tasks have a
 * cache to dispatch to. The key on the provider rebuilds the cache when
 * workspace changes, so per-workspace pollers don't leak across selections.
 */
export function TaskPreview() {
    const { apiUrl, selection } = useE3Context();
    const selectedWorkspace = selection.type !== 'none' ? selection.workspace : null;
    const selectedTask = selection.type === 'task' ? selection.task : null;

    if (selection.type === 'input') {
        return <InputPreview />;
    }

    if (!selectedWorkspace || !selectedTask) {
        return (
            <StatusDisplay
                variant="info"
                title="Select a task to preview"
                message="Choose a workspace and task from the tree on the left"
            />
        );
    }

    return (
        <ReactiveDatasetProvider
            key={selectedWorkspace}
            config={{ apiUrl, repo: 'default', workspace: selectedWorkspace }}
        >
            <TaskPreviewInner
                key={`${selectedWorkspace}:${selectedTask}`}
                apiUrl={apiUrl}
                repo="default"
                workspace={selectedWorkspace}
                task={selectedTask}
            />
        </ReactiveDatasetProvider>
    );
}
