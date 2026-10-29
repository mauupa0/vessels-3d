import type { SVGProps } from 'react'

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none" />
  </svg>
)
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M8 5.5v13M16 5.5v13" strokeWidth={2.4} />
  </svg>
)
export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 11.5 12 5l8 6.5M6.5 10v8.5h11V10" />
  </svg>
)
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
export const IconSection = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 15.5h16M7 9.5l-3 6M20 9.5l-3-4H9" />
    <path d="M9 5.5v4" strokeDasharray="1.5 2.5" />
  </svg>
)
export const IconGrow = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 20v-7M12 13c0-3 2-5 5-5M12 15c0-2-1.5-3.5-4-3.5M17 8v-3M8 11.5V8" />
  </svg>
)
export const IconArrow = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 12h12M13 7l5 5-5 5" />
  </svg>
)
export const IconDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
)
