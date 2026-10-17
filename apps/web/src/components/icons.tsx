import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </svg>
  )
}

export function IconFlip(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8a8 8 0 0 1 13.4-3.4L20 7" />
      <path d="M20 3v4h-4" />
      <path d="M20 16a8 8 0 0 1-13.4 3.4L4 17" />
      <path d="M4 21v-4h4" />
    </svg>
  )
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export function IconImage(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l4.5-4.5 3.5 3.5 3-3L20 18" />
    </svg>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function IconArrowUp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20V4M6 10l6-6 6 6" />
    </svg>
  )
}

export function IconTap(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      <path d="M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" opacity=".55" />
    </svg>
  )
}

export function IconSwipe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12h16" />
      <path d="M7 8l-4 4 4 4M17 8l4 4-4 4" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12.5l5 5L20 6.5" />
    </svg>
  )
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7.5 3v6c0 4.4-3.1 7.6-7.5 9-4.4-1.4-7.5-4.6-7.5-9V6L12 3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export function IconQQ(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3c-2.5 0-4.4 2-4.4 4.6 0 .8.2 1.5.4 2.1-.9 1.1-1.5 2.5-1.5 3.8 0 1 .3 1.7.9 1.7.4 0 .8-.5 1-1.2.4 1 1.1 1.9 2 2.3-.6.3-1 .8-1 1.2 0 .8 1.2 1.4 2.6 1.4s2.6-.6 2.6-1.4c0-.4-.4-.9-1-1.2.9-.4 1.6-1.3 2-2.3.2.7.6 1.2 1 1.2.6 0 .9-.7.9-1.7 0-1.3-.6-2.7-1.5-3.8.2-.6.4-1.3.4-2.1C16.4 5 14.5 3 12 3Z" />
    </svg>
  )
}

export function IconMotion(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="7.5" y="2.5" width="9" height="19" rx="2.2" />
      <path d="M12 8v8M9.5 10.5L12 8l2.5 2.5M9.5 13.5L12 16l2.5-2.5" opacity=".55" />
      <path d="M3 7v10M21 7v10" opacity=".45" />
    </svg>
  )
}

export function IconMore(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconEdit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  )
}

export function IconVault(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 1, ...props })}>
      <rect x="4.9" y="5.2" width="8.4" height="13.6" rx="1.8" transform="rotate(-11 9.1 12)" />
      <rect x="10.7" y="5.2" width="8.4" height="13.6" rx="1.8" transform="rotate(11 14.9 12)" />
    </svg>
  )
}

export function IconCardBack(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 1.15, ...props })}>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.4" />
      <path d="M12 6.9l5.1 5.1-5.1 5.1-5.1-5.1z" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}
