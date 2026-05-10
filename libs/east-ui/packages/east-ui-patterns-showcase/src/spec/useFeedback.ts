import { useCallback, useEffect, useState } from 'react'
import type { Feedback, FeedbackInput, FeedbackUpdate, MessageInput } from './types'

interface UseFeedbackOptions {
  locationId?: string
  patternId?: string
  modeId?: string
  status?: 'open' | 'actioned' | 'wontfix'
  pollMs?: number
}

export function useFeedback(opts: UseFeedbackOptions = {}) {
  const [items, setItems] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const url = new URL('/api/feedback', window.location.origin)
      if (opts.locationId) url.searchParams.set('locationId', opts.locationId)
      if (opts.patternId)  url.searchParams.set('patternId', opts.patternId)
      if (opts.modeId)     url.searchParams.set('modeId', opts.modeId)
      if (opts.status)     url.searchParams.set('status', opts.status)
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Feedback[] = await res.json()
      setItems(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [opts.locationId, opts.patternId, opts.modeId, opts.status])

  useEffect(() => { refresh() }, [refresh])

  // Light polling so claude-side replies / status changes show up
  useEffect(() => {
    if (!opts.pollMs) return
    const id = window.setInterval(() => refresh(), opts.pollMs)
    return () => window.clearInterval(id)
  }, [opts.pollMs, refresh])

  const create = useCallback(async (input: Omit<FeedbackInput, 'locationId'> & { locationId?: string }) => {
    const locationId = input.locationId ?? opts.locationId
    if (!locationId) throw new Error('locationId required')
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, locationId }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await refresh()
  }, [opts.locationId, refresh])

  const update = useCallback(async (id: number, patch: FeedbackUpdate) => {
    const res = await fetch(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await refresh()
  }, [refresh])

  const remove = useCallback(async (id: number) => {
    const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await refresh()
  }, [refresh])

  const reply = useCallback(async (feedbackId: number, body: string, author: MessageInput['author'] = 'user') => {
    const res = await fetch(`/api/feedback/${feedbackId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, body }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await refresh()
  }, [refresh])

  return { items, loading, error, refresh, create, update, remove, reply }
}
