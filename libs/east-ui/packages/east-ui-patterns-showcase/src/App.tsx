import { Box, CodeBlock, Flex, HStack, Stack, Text } from '@chakra-ui/react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  OverlayManagerProvider,
  Toaster,
  UIStore,
  UIStoreProvider,
} from '@elaraai/east-ui-components'
import { codeBlockAdapter } from './components/ExampleCard'

const store = new UIStore()

/** UX/UI Guide §15. The catalogue's primary nav. */
const MODES = [
  { path: '/observe',     label: 'Observe',       question: 'What needs my attention?' },
  { path: '/predict',     label: 'Predict',       question: 'If I act vs do nothing — what changes?' },
  { path: '/diagnose',    label: 'Diagnose',      question: 'Why is the rec what it is?' },
  { path: '/decide',      label: 'Decide',        question: 'Should I accept, modify, or override?' },
  { path: '/compare',     label: 'Compare',       question: 'How does this differ from last time?' },
  { path: '/calibrate',   label: 'Calibrate',     question: 'Was my judgement right?' },
  { path: '/configure',   label: 'Configure',     question: 'What inputs drive this?' },
  { path: '/frame-trust', label: 'Frame & trust', question: 'Should I trust this?' },
]

export default function App() {
  return (
    <UIStoreProvider store={store}>
      <OverlayManagerProvider>
        <CodeBlock.AdapterProvider value={codeBlockAdapter}>
          <Toaster />
          <Flex minH="100vh" bg="bg.canvas">
            <LeftRail />
            <Flex direction="column" flex="1" minW={0}>
              <TopBar />
              <Box flex="1" minW={0}>
                <Outlet />
              </Box>
            </Flex>
          </Flex>
        </CodeBlock.AdapterProvider>
      </OverlayManagerProvider>
    </UIStoreProvider>
  )
}

// ─── Left rail (UX/UI Guide §15: 220 px expanded · 16 px vertical · 12 px horizontal) ───

function LeftRail() {
  return (
    <Box
      as="aside"
      w="220px"
      flexShrink={0}
      bg="bg.surface"
      borderRightWidth="1px"
      borderRightColor="border.subtle"
      position="sticky"
      top={0}
      h="100vh"
      overflowY="auto"
      px={3}
      py={4}
    >
      <Stack gap={1}>
        <WorkspaceSwitcher />
        {MODES.map(m => (
          <NavItem key={m.path} to={m.path} label={m.label} />
        ))}
      </Stack>
    </Box>
  )
}

function WorkspaceSwitcher() {
  return (
    <HStack
      as={Link}
      // @ts-expect-error react-router Link props are flowed through Chakra's polymorphic factory
      to="/"
      gap={2}
      px={2}
      py={2}
      borderRadius="md"
      mb={4}
      _hover={{ bg: 'bg.canvas' }}
    >
      <Box
        w="24px"
        h="24px"
        borderRadius="md"
        bg="brand.500"
        color="white"
        display="flex"
        alignItems="center"
        justifyContent="center"
        fontFamily="heading"
        fontWeight="bold"
        fontSize="xs"
      >
        E
      </Box>
      <Text fontWeight="semibold" textStyle="body.sm">
        East UI
      </Text>
    </HStack>
  )
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <HStack
          gap={2}
          px={2}
          h="32px"
          borderRadius="md"
          bg={isActive ? 'bg.muted' : 'transparent'}
          color={isActive ? 'fg' : 'fg.muted'}
          fontWeight={isActive ? 'semibold' : 'normal'}
          _hover={{ bg: isActive ? 'bg.muted' : 'bg.canvas', color: 'fg' }}
          transition="background {durations.fast} {easings.out}"
        >
          <Text textStyle="body.sm">
            {label}
          </Text>
        </HStack>
      )}
    </NavLink>
  )
}

// ─── Top bar (UX/UI Guide §15: 44 px · breadcrumb left · ⌘K right) ───

function TopBar() {
  const { pathname } = useLocation()
  const current = MODES.find(m => pathname.startsWith(m.path))
  return (
    <HStack
      h="44px"
      bg="bg.surface"
      borderBottomWidth="1px"
      borderBottomColor="border.subtle"
      px={5}
      gap={3}
      flexShrink={0}
      position="sticky"
      top={0}
      zIndex="docked"
    >
      <HStack gap={2} textStyle="body.sm">
        <Text color="fg.muted">Decision-quality patterns</Text>
        <Text color="fg.muted">/</Text>
        <Text color="fg" fontWeight="semibold">
          {current?.label ?? 'Index'}
        </Text>
      </HStack>
      <SearchTrigger />
    </HStack>
  )
}

function SearchTrigger() {
  return (
    <HStack
      ml="auto"
      px={3}
      h="28px"
      gap={2}
      minW="240px"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      color="fg.muted"
      cursor="pointer"
      _hover={{ borderColor: 'border.strong' }}
    >
      <Text textStyle="caption" flex="1">
        Search…
      </Text>
      <Text
        textStyle="caption"
        fontFamily="mono"
        px={1.5}
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="sm"
        lineHeight="1"
      >
        ⌘K
      </Text>
    </HStack>
  )
}

// Re-export so other modules can also consume the canonical mode list.
export { MODES }

// Inline placeholder route for modes not yet built. Useful while the spec
// is rolled out mode-by-mode.
export function PlaceholderRoute({ mode }: { mode: string }) {
  return (
    <Box maxW="800px" mx="auto" p={10}>
      <Stack gap={3}>
        <Text textStyle="eyebrow" color="fg.subtle">
          Mode
        </Text>
        <Text textStyle="display.sm">{mode}</Text>
        <Text textStyle="body.md" color="fg.muted">
          This mode's spec hasn't been migrated yet. The catalogue is being rolled out anchor-first; see /decide
          for the current canonical example.
        </Text>
      </Stack>
    </Box>
  )
}
