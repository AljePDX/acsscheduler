'use client'

/**
 * ParentNav — Navigation for parent-facing pages.
 *
 * Mobile/Tablet (< 1024px): Bottom tab bar with 5 items.
 * Desktop (≥ 1024px): Left sidebar (220px wide, sticky) — bottom bar is hidden.
 *
 * Active tab gets a sage-coloured top border (mobile) or sage background (desktop).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Calendar, LayoutGrid, ArrowLeftRight, PlusCircle, Settings } from 'lucide-react'
import { LogoutButton } from './LogoutButton'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

// All 5 tabs shown in both sidebar and bottom bar
const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/parent/dashboard', icon: <Home size={20} /> },
  { label: 'Availability', href: '/parent/availability', icon: <Calendar size={20} /> },
  { label: 'Schedule', href: '/parent/schedule', icon: <LayoutGrid size={20} /> },
  { label: 'Swaps', href: '/parent/swaps', icon: <ArrowLeftRight size={20} /> },
  { label: 'Drop-ins', href: '/parent/dropins', icon: <PlusCircle size={20} /> },
]

// Settings is sidebar-only (desktop) — mobile uses the TopBar gear icon
const SIDEBAR_EXTRA: NavItem[] = [
  { label: 'Settings', href: '/parent/settings', icon: <Settings size={20} /> },
]

// ── Shared active check ────────────────────────────────────────────────────────

function isActive(pathname: string, href: string): boolean {
  // Dashboard is active only on exact match to avoid matching everything under /parent/
  if (href === '/parent/dashboard') return pathname === href
  return pathname.startsWith(href)
}

// ── Desktop sidebar ────────────────────────────────────────────────────────────

export function ParentSidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="hidden lg:flex"
      style={{
        position: 'sticky',
        top: 'var(--top-bar-height)',
        height: 'calc(100vh - var(--top-bar-height))',
        width: '220px',
        flexShrink: 0,
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
        background: 'var(--warm-white)',
        padding: '1.25rem 0',
        overflowY: 'auto',
      }}
    >
      <nav aria-label="Parent navigation">
        {NAV_ITEMS.map(item => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.65rem 1.25rem',
                margin: '0 0.5rem',
                borderRadius: '0.5rem',
                textDecoration: 'none',
                color: active ? 'var(--sage-dark)' : 'var(--text-muted)',
                background: active ? 'var(--sage-light)' : 'transparent',
                fontWeight: active ? 600 : 400,
                fontSize: '0.9rem',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <span
                style={{
                  color: active ? 'var(--sage)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Settings — sidebar only extra items */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '0.5rem 0', paddingTop: '0.5rem' }}>
        {SIDEBAR_EXTRA.map(item => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.65rem 1.25rem',
                margin: '0 0.5rem',
                borderRadius: '0.5rem',
                textDecoration: 'none',
                color: active ? 'var(--sage-dark)' : 'var(--text-muted)',
                background: active ? 'var(--sage-light)' : 'transparent',
                fontWeight: active ? 600 : 400,
                fontSize: '0.9rem',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <span style={{ color: active ? 'var(--sage)' : 'var(--text-muted)', flexShrink: 0 }}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          )
        })}
      </div>

      {/* Spacer pushes logout to bottom */}
      <div style={{ flex: 1 }} />

      {/* Log out — sidebar only (TopBar handles mobile) */}
      <div style={{ padding: '0 0.5rem 0.5rem' }}>
        <LogoutButton showLabel />
      </div>
    </aside>
  )
}

// ── Mobile / tablet bottom tab bar ─────────────────────────────────────────────

export function ParentBottomTabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Parent navigation"
      className="lg:hidden"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        height: 'var(--bottom-bar-height)',
        background: 'var(--warm-white)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      {NAV_ITEMS.map(item => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.2rem',
              textDecoration: 'none',
              // Sage top border on active tab
              borderTop: active ? '2px solid var(--sage)' : '2px solid transparent',
              color: active ? 'var(--sage-dark)' : 'var(--text-muted)',
              fontSize: '0.65rem',
              fontWeight: active ? 600 : 400,
              paddingTop: '0.1rem',
            }}
          >
            <span style={{ color: active ? 'var(--sage)' : 'var(--text-muted)' }}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
