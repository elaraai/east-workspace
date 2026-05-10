export type FeedbackKind = 'comment' | 'reject' | 'change' | 'question' | 'add'
export type FeedbackStatus = 'open' | 'actioned' | 'wontfix'
export type MessageAuthor = 'claude' | 'user'

export interface FeedbackMessage {
  id: number
  feedbackId: number
  author: MessageAuthor
  body: string
  createdAt: string
}

export interface Feedback {
  id: number
  locationId: string
  patternId: string | null
  modeId: string | null
  kind: FeedbackKind
  body: string
  status: FeedbackStatus
  resolution: string | null
  createdAt: string
  actionedAt: string | null
  messages: FeedbackMessage[]
}

export interface FeedbackInput {
  locationId: string
  patternId?: string
  modeId?: string
  kind: FeedbackKind
  body: string
}

export interface FeedbackUpdate {
  status?: FeedbackStatus
  resolution?: string
}

export interface MessageInput {
  author: MessageAuthor
  body: string
}

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string; palette: string }[] = [
  { value: 'comment',  label: 'comment',  palette: 'orange' },
  { value: 'reject',   label: 'reject',   palette: 'red' },
  { value: 'change',   label: 'change',   palette: 'blue' },
  { value: 'question', label: 'question', palette: 'purple' },
  { value: 'add',      label: 'add',      palette: 'green' },
]

export function paletteForKind(kind: FeedbackKind): string {
  return FEEDBACK_KINDS.find(k => k.value === kind)?.palette ?? 'gray'
}
