'use client'

/**
 * AdminNav — Navigation for admin-facing pages.
 *
 * Mobile/Tablet (< 1024px): Bottom tab bar with 5 items.
 * Desktop (≥ 1024px): Left sidebar (220px wide, sticky) — bottom bar is hidden.
 *
 * Active tab: sage background (sidebar) or sage top border (bottom bar).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  AlertCircle,
  BarChart2,
  Settings,
} from 'lucide-react'
import { LogoutButton } from './LogoutButton'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/admin/dashboard', icon: <LayoutDashboard size={20} /> },
  { label: 'Schedule', href: '/admin/schedule', icon: <CalendarDays size={20} /> },
  { label: 'Families', href: '/admin/families', icon: <Users size={20} /> },
  { label: 'Makeup', href: '/admin/makeup', icon: <AlertCircle size={20} /> },
  { label: 'Reports', href: '/admin/reports', icon: <BarChart2 size={20} /> },
  { label: 'Settings', href: '/admin/settings', icon: <Settings size={20} /> },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin/dashboard') return pathname === href
  return pathname.startsWith(href)
}

// ── Desktop sidebar ────────────────────────────────────────────────────────────

export function AdminSidebar() {
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
      {/* Admin badge */}
      <div
        style={{
          margin: '0 1rem 1rem',
          padding: '0.35rem 0.75rem',
          borderRadius: '6px',
          background: 'var(--sage-light)',
          color: 'var(--sage-dark)',
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        Admin View
      </div>

      <nav aria-label="Admin navigation">
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

export function AdminBottomTabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Admin navigation"
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
