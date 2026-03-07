'use client'

/**
 * ThemeToggle — sun/moon button that lives in the top bar.
 *
 * On click: toggles between light and dark mode, persists to localStorage.
 * Icon: shows Sun when currently dark (click → go light),
 *       shows Moon when currently light (click → go dark).
 *
 * initTheme() is also called here to attach the OS change event listener
 * after hydration (the anti-flash inline script in layout.tsx handles the
 * initial theme set before JS loads).
 */

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { initTheme, toggleTheme, getTheme } from '@/lib/theme'

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    // Attach OS change listener and sync component state with current theme
    initTheme()
    setIsDark(getTheme() === 'dark')

    // Stay in sync if the theme changes via another mechanism
    const observer = new MutationObserver(() => {
      setIsDark(getTheme() === 'dark')
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => observer.disconnect()
  }, [])

  function handleToggle() {
    toggleTheme()
    setIsDark(prev => !prev)
  }

  return (
    <button
      onClick={handleToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '2.25rem',
        height: '2.25rem',
        borderRadius: '0.5rem',
        color: 'var(--text-muted)',
        transition: 'color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'
        ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--sage-light)'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
        ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
      }}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
