/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HStack,
  VStack,
  Text,
  IconButton,
  Spacer,
  Menu,
  Avatar,
  Button,
  Badge,
  Portal,
} from '@chakra-ui/react';
import { FiLogOut, FiMoon, FiSun } from 'react-icons/fi';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useUser } from '../contexts/UserContext';
import { Breadcrumbs } from './Breadcrumbs';

interface NavHeaderProps {
  title: string;
}

export function NavHeader({ title }: NavHeaderProps) {
  const { mode, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const user = useUser();

  const avatarBgColor = useMemo(
    () => (mode === 'light' ? 'gray.300' : 'gray.600'),
    [mode]
  );

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  return (
    <VStack gap={0} align="stretch" w="100%">
      {/* Main header bar */}
      <HStack
        gap={4}
        px={6}
        py={4}
        w="100%"
        bg="bg.primary"
        borderBottom="1px solid"
        borderColor="border.primary"
        minH="72px"
      >
        <Text fontSize="2xl" fontWeight={600} color="text.primary" letterSpacing="-0.025em">
          {title}
        </Text>

        <Spacer />

        {/* Theme toggle */}
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Toggle theme"
          color="text.secondary"
          _hover={{ bg: 'bg.hover', color: 'text.primary' }}
          onClick={toggleTheme}
        >
          {mode === 'light' ? <FiMoon /> : <FiSun />}
        </IconButton>

        {/* User menu */}
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              p={2}
              borderRadius="full"
              _hover={{ bg: 'bg.hover' }}
              _active={{ bg: 'bg.tertiary' }}
            >
              <Avatar.Root size="sm" bg={avatarBgColor} border="2px solid" borderColor="border.primary">
                <Avatar.Fallback name={user.name.type === 'some' ? user.name.value : user.email.type === 'some' ? user.email.value : 'User'} />
                <Badge
                  position="absolute"
                  bottom="-2px"
                  right="-2px"
                  bg="brand.500"
                  w="1em"
                  h="1em"
                  borderRadius="full"
                  border="2px solid"
                  borderColor="bg.primary"
                />
              </Avatar.Root>
            </Button>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content
                shadow="lg"
                border="1px solid"
                borderColor="border.primary"
                borderRadius="md"
              >
                <Menu.ItemGroup>
                  <Menu.ItemGroupLabel>Preferences</Menu.ItemGroupLabel>
                  <Menu.Item value="theme-toggle" onClick={toggleTheme} _hover={{ bg: 'bg.hover' }}>
                    {mode === 'light' ? <FiMoon /> : <FiSun />}
                    {mode === 'light' ? 'Dark' : 'Light'} Theme
                  </Menu.Item>
                </Menu.ItemGroup>
                <Menu.ItemGroup>
                  <Menu.ItemGroupLabel>Account</Menu.ItemGroupLabel>
                  <Menu.Item value="logout" onClick={handleLogout} _hover={{ bg: 'bg.hover' }}>
                    <FiLogOut />
                    Logout
                  </Menu.Item>
                </Menu.ItemGroup>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </HStack>

      {/* Breadcrumbs */}
      <Breadcrumbs />
    </VStack>
  );
}
