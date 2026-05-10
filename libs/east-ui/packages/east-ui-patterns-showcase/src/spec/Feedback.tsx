/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Feedback dock — the per-block annotation surface.
 *
 * Visual rules (UX/UI Guide):
 *  - §05: no coloured left-borders on cards.
 *  - §02: no tinted-background status (chrome stays neutral; status carried
 *         by a single dot or a one-word label).
 *  - §07: solid + outline + ghost only; no red/orange/green button palettes.
 *  - §09: no emoji; mathematical Unicode only.
 *  - §03: every text-size choice goes through `textStyle="…"`, never inline
 *         `fontSize="10px"`.
 */

import { useState } from 'react'
import {
  Box,
  Button,
  Flex,
  HStack,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { Markdown } from '@elaraai/east-ui-components'
import { useFeedback } from './useFeedback'
import {
  FEEDBACK_KINDS,
  type Feedback,
  type FeedbackKind,
  type FeedbackMessage,
} from './types'

interface FeedbackAnchorProps {
  locationId: string
  patternId?: string
  modeId?: string
}

export function FeedbackAnchor({ locationId, patternId, modeId }: FeedbackAnchorProps) {
  const { items, create, update, remove, reply } = useFeedback({ locationId, pollMs: 5000 })
  const [composing, setComposing] = useState(false)
  const [kind, setKind] = useState<FeedbackKind>('comment')
  const [body, setBody] = useState('')
  const open = items.filter(i => i.status === 'open')

  return (
    <Stack
      gap={2}
      mt={2}
      pt={2}
      borderTopWidth="1px"
      borderTopStyle="dashed"
      borderTopColor="border.subtle"
      data-feedback-anchor={locationId}
    >
      {/* Existing feedback rows — recessed onto bg.muted so they read as
          a distinct annotation surface against the white block above. */}
      {items.length > 0 && (
        <Stack gap={2}>
          {items.map(item => (
            <FeedbackCard
              key={item.id}
              item={item}
              onMarkActioned={(resolution) => update(item.id, { status: 'actioned', resolution })}
              onReopen={() => update(item.id, { status: 'open' })}
              onRemove={() => remove(item.id)}
              onReply={(text) => reply(item.id, text, 'user')}
            />
          ))}
        </Stack>
      )}

      {/* Compact add-bar — neutral chrome, hover reveals the locationId. */}
      {!composing && (
        <HStack gap={2} role="group">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setComposing(true)}
          >
            + feedback
          </Button>
          {open.length > 0 && (
            <HStack gap={1}>
              <StatusDot tone="warning" />
              <Text textStyle="caption" color="fg.muted">
                {open.length} open
              </Text>
            </HStack>
          )}
          <Text
            textStyle="caption"
            fontFamily="mono"
            color="fg.subtle"
            ml="auto"
            opacity={0}
            _groupHover={{ opacity: 1 }}
            transition="opacity {durations.fast} {easings.out}"
          >
            {locationId}
          </Text>
        </HStack>
      )}

      {/* Composer */}
      {composing && (
        <Stack
          gap={3}
          layerStyle="card.flat"
        >
          <HStack gap={1} flexWrap="wrap">
            {FEEDBACK_KINDS.map(k => (
              <Button
                key={k.value}
                size="xs"
                variant={kind === k.value ? 'solid' : 'ghost'}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </Button>
            ))}
            <Text textStyle="caption" fontFamily="mono" color="fg.subtle" ml="auto">
              {locationId}
            </Text>
          </HStack>
          <Textarea
            placeholder={`Your ${kind}…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            size="sm"
            autoFocus
          />
          <HStack justify="flex-end" gap={2}>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => { setComposing(false); setBody(''); setKind('comment') }}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              variant="solid"
              disabled={!body.trim()}
              onClick={async () => {
                await create({ kind, body: body.trim(), patternId, modeId })
                setBody('')
                setKind('comment')
                setComposing(false)
              }}
            >
              Save
            </Button>
          </HStack>
        </Stack>
      )}
    </Stack>
  )
}

interface FeedbackCardProps {
  item: Feedback
  onMarkActioned: (resolution?: string) => void
  onReopen: () => void
  onRemove: () => void
  onReply: (body: string) => Promise<void>
}

/**
 * Single feedback entry. Neutral chrome — open vs actioned status carried
 * by a leading dot + one-word label, not by a tinted surface or a coloured
 * left rail (§02 / §05).
 */
function FeedbackCard({ item, onMarkActioned, onReopen, onRemove, onReply }: FeedbackCardProps) {
  const isActioned = item.status === 'actioned'
  const [editingResolution, setEditingResolution] = useState(false)
  const [resolution, setResolution] = useState(item.resolution ?? '')

  const hasUnseenClaudeReply =
    item.status === 'open' && item.messages.some(m => m.author === 'claude')
  const [expanded, setExpanded] = useState(hasUnseenClaudeReply || item.messages.length > 0)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)

  const claudeReplyCount = item.messages.filter(m => m.author === 'claude').length
  const userReplyCount = item.messages.filter(m => m.author === 'user').length

  return (
    <Box
      bg="bg.muted"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      p={3}
      opacity={isActioned ? 0.7 : 1}
      transition="opacity {durations.fast} {easings.out}"
    >
      <Flex justify="space-between" align="flex-start" gap={3}>
        <Stack gap={2} flex="1" minW={0}>
          {/* Header row: status dot + kind + id/time */}
          <HStack gap={2} flexWrap="wrap">
            <StatusDot tone={isActioned ? 'success' : 'open'} />
            <Text
              textStyle="caption"
              textTransform="uppercase"
              letterSpacing="wider"
              fontWeight="semibold"
              color="fg.muted"
            >
              {item.kind}{isActioned && ' · actioned'}
            </Text>
            <Text textStyle="caption" fontFamily="mono" color="fg.subtle" ml="auto">
              #{item.id} · {formatTime(item.createdAt)}
            </Text>
          </HStack>

          {/* Body — full GFM markdown via the canonical primitive. */}
          <Box textStyle="body.sm" color={isActioned ? 'fg.muted' : 'fg'}>
            <Markdown>{item.body}</Markdown>
          </Box>

          {/* Resolution: a single ink line — green ink only on the leading
              "Resolved —" prefix. No tinted background (§02). */}
          {item.resolution && !editingResolution && (
            <Box textStyle="body.sm" color="fg.muted">
              <Text as="span" color="ink.success" fontWeight="semibold">Resolved —</Text>{' '}
              <Box as="span" fontStyle="italic">
                <Markdown inline>{item.resolution}</Markdown>
              </Box>
            </Box>
          )}

          {/* Resolution editor */}
          {editingResolution && (
            <Stack gap={2}>
              <Textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="How was this addressed?"
                size="xs"
                rows={2}
              />
              <HStack gap={2} justify="flex-end">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => { setEditingResolution(false); setResolution(item.resolution ?? '') }}
                >
                  Cancel
                </Button>
                <Button
                  size="xs"
                  variant="solid"
                  onClick={() => { onMarkActioned(resolution.trim() || undefined); setEditingResolution(false) }}
                >
                  Mark actioned
                </Button>
              </HStack>
            </Stack>
          )}

          {/* Replies thread */}
          <Box>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              px={1}
            >
              <Text as="span" textStyle="caption" fontFamily="mono" color={hasUnseenClaudeReply ? 'brand.700' : 'fg.muted'}>
                {expanded ? '▾' : '▸'}{' '}
                {item.messages.length === 0
                  ? 'reply'
                  : `${item.messages.length} ${item.messages.length === 1 ? 'reply' : 'replies'}` +
                    (claudeReplyCount > 0 ? ` · ${claudeReplyCount} claude` : '') +
                    (userReplyCount > 0 ? ` · ${userReplyCount} you` : '')}
                {hasUnseenClaudeReply && (
                  <Text as="span" ml={2} color="brand.500" fontWeight="bold">
                    · new
                  </Text>
                )}
              </Text>
            </Button>

            {expanded && (
              <Stack gap={2} mt={2} pl={3}>
                {item.messages.map(m => (
                  <MessageRow key={m.id} message={m} />
                ))}
                {!replying ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    alignSelf="flex-start"
                    onClick={() => setReplying(true)}
                  >
                    + reply
                  </Button>
                ) : (
                  <Stack gap={2}>
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Reply…"
                      size="xs"
                      rows={2}
                      autoFocus
                    />
                    <HStack gap={2} justify="flex-end">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => { setReplying(false); setReplyText('') }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        variant="solid"
                        disabled={!replyText.trim()}
                        onClick={async () => {
                          await onReply(replyText.trim())
                          setReplyText('')
                          setReplying(false)
                        }}
                      >
                        Reply
                      </Button>
                    </HStack>
                  </Stack>
                )}
              </Stack>
            )}
          </Box>
        </Stack>

        <HStack gap={1} flexShrink={0}>
          {!isActioned && !editingResolution && (
            <Button size="xs" variant="ghost" onClick={() => setEditingResolution(true)}>
              Mark actioned
            </Button>
          )}
          {isActioned && (
            <Button size="xs" variant="ghost" onClick={onReopen}>
              Reopen
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={onRemove} aria-label="Remove">
            ×
          </Button>
        </HStack>
      </Flex>
    </Box>
  )
}

/**
 * Reply row — neutral surface for both authors. Author identification
 * lives in the caption-tone label, not the surface colour (§02).
 */
function MessageRow({ message }: { message: FeedbackMessage }) {
  const isClaude = message.author === 'claude'
  return (
    <Box
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      px={3}
      py={2}
    >
      <HStack gap={2} mb={1}>
        <Text
          textStyle="caption"
          textTransform="uppercase"
          letterSpacing="wider"
          fontWeight="semibold"
          color={isClaude ? 'brand.700' : 'fg.muted'}
        >
          {isClaude ? 'Claude' : 'You'}
        </Text>
        <Text textStyle="caption" fontFamily="mono" color="fg.subtle">
          {formatTime(message.createdAt)}
        </Text>
      </HStack>
      <Box textStyle="body.sm" color="fg">
        <Markdown>{message.body}</Markdown>
      </Box>
    </Box>
  )
}

/**
 * Status dot — small filled circle with WCAG-friendly tone encoding.
 * Used everywhere we'd otherwise rely on background tint (§02).
 */
function StatusDot({ tone }: { tone: 'open' | 'success' | 'warning' }) {
  const bg =
    tone === 'success' ? 'ink.success'
    : tone === 'warning' ? 'ink.warning'
    : 'brand.500'
  return (
    <Box
      as="span"
      display="inline-block"
      w="6px"
      h="6px"
      borderRadius="full"
      bg={bg}
      flexShrink={0}
    />
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}
