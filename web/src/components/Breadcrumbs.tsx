/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { HStack, Text } from '@chakra-ui/react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { FiChevronRight } from 'react-icons/fi';

interface Crumb {
  label: string;
  to: string;
}

export function Breadcrumbs() {
  const location = useLocation();
  const params = useParams<{ repo?: string; workspace?: string; task?: string; '*'?: string }>();

  const crumbs: Crumb[] = [];

  if (location.pathname.startsWith('/repos')) {
    crumbs.push({ label: 'Repositories', to: '/repos' });
  }

  if (location.pathname.startsWith('/admin')) {
    crumbs.push({ label: 'Admin', to: '/admin' });
    if (location.pathname.startsWith('/admin/repos/') && params.repo) {
      crumbs.push({ label: params.repo, to: `/admin/repos/${params.repo}` });
    }
  }

  if (location.pathname.startsWith('/repos') && params.repo) {
    crumbs.push({ label: params.repo, to: `/repos/${params.repo}` });
  }

  if (params.workspace) {
    crumbs.push({
      label: params.workspace,
      to: `/repos/${params.repo}/workspaces/${params.workspace}`,
    });
  }

  if (params.task) {
    crumbs.push({
      label: params.task,
      to: `/repos/${params.repo}/workspaces/${params.workspace}/tasks/${params.task}`,
    });
  }

  if (location.pathname.includes('/data/') && params['*']) {
    const displayName = params['*'].split('/').pop() ?? params['*'];
    crumbs.push({
      label: displayName,
      to: location.pathname,
    });
  }

  if (crumbs.length <= 1) return null;

  return (
    <HStack px={6} py={2} bg="bg.secondary" borderBottom="1px solid" borderColor="border.primary">
      <HStack gap={1} fontSize="sm">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <HStack key={crumb.to} gap={1}>
              {i > 0 && <FiChevronRight size={14} color="var(--chakra-colors-text-tertiary)" />}
              {isLast ? (
                <Text fontWeight={600} color="text.primary">
                  {crumb.label}
                </Text>
              ) : (
                <Text asChild color="text.secondary" _hover={{ color: 'link.color' }}>
                  <Link to={crumb.to}>{crumb.label}</Link>
                </Text>
              )}
            </HStack>
          );
        })}
      </HStack>
    </HStack>
  );
}
