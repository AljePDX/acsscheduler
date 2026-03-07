'use client'

/**
 * TopBar — appears at the top of every authenticated page.
 *
 * Mobile/Tablet (< 1024px):
 *   [App name / logo]  [notification bell + unread count]  [theme toggle]
 *
 * Desktop (≥ 1024px):
 *   [App name]  [role badge: Parent / Admin]  [notification bell]  [theme toggle]
 *
 * The notification bell badge and unread count are wired up in Step 12.
 * The role switcher is relevant for admin users who can view both dashboards.
 */

import Link from 'next/link'
import { Bell, Settings } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'

interface TopBarProps {
  role?: 'parent' | 'admin'
  unreadCount?: number
}

export function TopBar({ role = 'parent', unreadCount = 0 }: TopBarProps) {
  const dashboardHref = role === 'admin' ? '/admin/dashboard' : '/parent/dashboard'
  const notificationsHref = role === 'admin' ? '/admin/notifications' : '/parent/notifications'

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 'var(--top-bar-height)',
        background: 'var(--warm-white)',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--shadow)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 1rem',
        gap: '0.5rem',
      }}
    >
      {/* App name / logo */}
      <Link
        href={dashboardHref}
        style={{
          fontFamily: 'var(--font-playfair), "Playfair Display", serif',
          fontSize: '0.95rem',
          fontWeight: 600,
          color: 'var(--sage-dark)',
          textDecoration: 'none',
          flexShrink: 0,
          letterSpacing: '-0.01em',
        }}
      >
        Ashcreek Playschool
      </Link>

      {/* Role badge — desktop only */}
      {role && (
        <span
          className="hidden lg:inline-flex"
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            color: role === 'admin' ? 'var(--warning)' : 'var(--sage-dark)',
            background: role === 'admin' ? 'var(--warning-light)' : 'var(--sage-light)',
            padding: '0.2rem 0.5rem',
            borderRadius: '999px',
          }}
        >
          {role === 'admin' ? 'Admin' : 'Parent'}
        </span>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Notification bell */}
      <Link
        href={notificationsHref}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
            : 'Notifications'
        }
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '2.25rem',
          height: '2.25rem',
          borderRadius: '0.5rem',
          color: 'var(--text-muted)',
          textDecoration: 'none',
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              background: 'var(--warning)',
              color: '#fff',
              fontSize: '0.6rem',
              fontWeight: 700,
              lineHeight: 1,
              minWidth: '1rem',
              height: '1rem',
              borderRadius: '999px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 0.2rem',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Link>

      {/* Settings — parent only, icon in top bar */}
      {role === 'parent' && (
        <Link
          href="/parent/settings"
          aria-label="Settings"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.25rem',
            height: '2.25rem',
            borderRadius: '0.5rem',
            color: 'var(--text-muted)',
            textDecoration: 'none',
          }}
        >
          <Settings size={18} />
        </Link>
      )}

      {/* Theme toggle */}
      <ThemeToggle />

      {/* Logout — icon only in top bar */}
      <LogoutButton />
    </header>
  )
}
