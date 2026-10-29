import { useSyncExternalStore } from 'react'

const query = '(prefers-reduced-motion: reduce)'

function subscribe(cb: () => void) {
  const m = window.matchMedia(query)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
