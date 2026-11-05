const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export const IconHome = () => (
  <svg {...base}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
  </svg>
)
export const IconFolder = () => (
  <svg {...base}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
  </svg>
)
export const IconList = () => (
  <svg {...base}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1" />
    <circle cx="3.5" cy="12" r="1" />
    <circle cx="3.5" cy="18" r="1" />
  </svg>
)
export const IconCalendar = () => (
  <svg {...base}>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18M8 3v3M16 3v3" />
  </svg>
)
export const IconLogout = () => (
  <svg {...base}>
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </svg>
)
export const IconCheck = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.5 2.5L16 9.5" />
  </svg>
)
