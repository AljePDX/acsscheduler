/**
 * LogoutButton — submits a server action form to sign out.
 *
 * Intentionally NOT a client component: no 'use client', no useState,
 * no browser-side Supabase. Using a plain <form action={serverAction}>
 * avoids the hydration issue that broke ThemeToggle when the previous
 * version imported createBrowserClient from @supabase/ssr during SSR.
 *
 * showLabel=false  → icon-only (used in TopBar)
 * showLabel=true   → icon + "Log out" text (used in sidebars)
 */

import { LogOut } from 'lucide-react'
import { logoutAction } from '@/app/actions/auth'

interface LogoutButtonProps {
  /** Show a text label next to the icon (sidebar usage). Default: false */
  showLabel?: boolean
}

export function LogoutButton({ showLabel = false }: LogoutButtonProps) {
  return (
    <form action={logoutAction} style={{ margin: 0, lineHeight: 0 }}>
      <button
        type="submit"
        aria-label="Log out"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: showLabel ? 'flex-start' : 'center',
          gap: '0.65rem',
          width: showLabel ? '100%' : '2.25rem',
          height: showLabel ? 'auto' : '2.25rem',
          padding: showLabel ? '0.65rem 1.25rem' : '0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
          fontWeight: 400,
          borderRadius: '0.5rem',
        }}
      >
        <LogOut size={showLabel ? 20 : 18} style={{ flexShrink: 0 }} />
        {showLabel && 'Log out'}
      </button>
    </form>
  )
}
