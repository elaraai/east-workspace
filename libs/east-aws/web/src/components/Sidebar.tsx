/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, VStack, Text, IconButton } from '@chakra-ui/react';
import { FiDatabase, FiSettings, FiMenu, FiChevronRight } from 'react-icons/fi';
import { LogoFull, LogoCollapsed } from './Logo';
import { UserContext } from '../contexts/UserContext';

export const SIDEBAR_WIDTH = 72;
export const SIDEBAR_WIDTH_COLLAPSED = 20;

interface NavItemConfig {
  icon: React.ElementType;
  label: string;
  to: string;
  adminOnly?: boolean;
}

const navItems: NavItemConfig[] = [
  { icon: FiDatabase, label: 'Repositories', to: '/repos' },
  { icon: FiSettings, label: 'Admin', to: '/admin', adminOnly: true },
];

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useContext(UserContext);

  const visibleItems = useMemo(
    () => navItems.filter((item) => !item.adminOnly || user?.isAdmin),
    [user?.isAdmin]
  );

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleNav = useCallback(
    (to: string) => {
      navigate(to);
      setIsCollapsed(true);
    },
    [navigate]
  );

  return (
    <Box
      as="nav"
      position="fixed"
      left={0}
      top={0}
      h="100vh"
      w={isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH}
      bg="bg.primary"
      borderRight="1px solid"
      borderRightColor="border.primary"
      transition="all 0.3s ease"
      overflowY="auto"
      overflowX="hidden"
      zIndex="overlay"
      boxShadow={isCollapsed ? 'sm' : 'xl'}
    >
      <VStack gap={0} align="stretch" h="full">
        {/* Logo */}
        <Box p={4} borderBottom="1px solid" borderBottomColor="border.secondary">
          <Box display="flex" justifyContent={isCollapsed ? 'center' : 'flex-start'}>
            {isCollapsed ? (
              <LogoCollapsed height={12} width={12} />
            ) : (
              <LogoFull height={12} />
            )}
          </Box>
        </Box>

        {/* Collapse toggle */}
        <Box px={4} py={3} borderBottom="1px solid" borderBottomColor="border.secondary">
          {isCollapsed ? (
            <Box display="flex" justifyContent="center">
              <IconButton
                aria-label="Expand sidebar"
                variant="outline"
                size="md"
                w="10"
                color="text.secondary"
                borderColor="border.primary"
                _hover={{ bg: 'bg.hover', borderColor: 'border.hover' }}
                onClick={toggleCollapse}
              >
                <FiChevronRight />
              </IconButton>
            </Box>
          ) : (
            <IconButton
              aria-label="Collapse sidebar"
              variant="outline"
              size="md"
              w="full"
              color="text.secondary"
              borderColor="border.primary"
              _hover={{ bg: 'bg.hover', borderColor: 'border.hover' }}
              onClick={toggleCollapse}
            >
              <FiMenu />
            </IconButton>
          )}
        </Box>

        {/* Nav items */}
        <VStack gap={2} align="stretch" flex={1} py={2} px={4}>
          {visibleItems.map((item) => {
            const isActive = location.pathname.startsWith(item.to);
            const Icon = item.icon;

            return (
              <Box
                key={item.to}
                as="button"
                display="flex"
                alignItems="center"
                justifyContent={isCollapsed ? 'center' : 'flex-start'}
                gap={3}
                h="10"
                px={isCollapsed ? 0 : 4}
                borderRadius="6px"
                bg={isActive ? 'nav.active.bg' : 'transparent'}
                color={isActive ? 'nav.active.color' : 'text.secondary'}
                fontWeight={isActive ? 600 : 500}
                fontSize="sm"
                transition="all 0.15s ease"
                cursor="pointer"
                w="full"
                _hover={{
                  bg: 'bg.hover',
                  color: 'text.primary',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                }}
                onClick={() => handleNav(item.to)}
              >
                <Icon size={18} />
                {!isCollapsed && <Text fontSize="sm">{item.label}</Text>}
              </Box>
            );
          })}
        </VStack>
      </VStack>
    </Box>
  );
}
