'use client'

/**
 * SwapActions — Accept / Decline buttons for an incoming swap coverage request.
 *
 * Calls server actions and refreshes the page on success so the
 * parent server component re-fetches the updated swap list.
 */

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptSwapCoverageAction, declineSwapCoverageAction } from './actions'

interface Props {
  swapId: string
}

export function SwapActions({ swapId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleAccept() {
    setError(null)
    startTransition(async () => {
      const res = await acceptSwapCoverageAction(swapId)
      if (res.error) {
        setError(res.error)
      } else {
        router.refresh()
      }
    })
  }

  function handleDecline() {
    setError(null)
    startTransition(async () => {
      const res = await declineSwapCoverageAction(swapId)
      if (res.error) {
        setError(res.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
      {error && (
        <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.78rem', textAlign: 'right' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={handleDecline}
          disabled={isPending}
          style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.45rem 1rem',
            cursor: isPending ? 'default' : 'pointer',
            fontSize: '0.85rem',
            fontWeight: 500,
            opacity: isPending ? 0.6 : 1,
          }}
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          disabled={isPending}
          style={{
            background: 'var(--sage)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '0.45rem 1.1rem',
            cursor: isPending ? 'default' : 'pointer',
            fontSize: '0.85rem',
            fontWeight: 500,
            opacity: isPending ? 0.6 : 1,
          }}
        >
          Accept
        </button>
      </div>
    </div>
  )
}
