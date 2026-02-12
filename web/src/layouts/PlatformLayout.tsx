/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Outlet, useLocation } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import { Sidebar, SIDEBAR_WIDTH_COLLAPSED } from '../components/Sidebar';
import { NavHeader } from '../components/NavHeader';

const pageTitles: Record<string, string> = {
  '/repos': 'Repositories',
  '/admin': 'Administration',
};

function getPageTitle(pathname: string): string {
  for (const [prefix, title] of Object.entries(pageTitles)) {
    if (pathname === prefix) return title;
  }
  if (pathname.startsWith('/repos/') && pathname.includes('/workspaces/')) {
    return 'Workspace';
  }
  if (pathname.startsWith('/repos/')) {
    return 'Repository';
  }
  return 'e3 Platform';
}

export function PlatformLayout() {
  const location = useLocation();
  const title = getPageTitle(location.pathname);

  return (
    <Box position="relative" minH="100vh">
      <Sidebar />
      <Box ml={SIDEBAR_WIDTH_COLLAPSED} display="flex" flexDirection="column" minH="100vh">
        <NavHeader title={title} />
        <Box flex={1} overflow="auto" bg="bg.secondary" p={6}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
