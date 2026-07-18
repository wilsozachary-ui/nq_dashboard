// Inline SVG icons for the sidebar tabs -- deliberately not an icon font or
// external package: this app has no CDN/network dependency anywhere else
// (see the self-hosted fonts), and a handful of simple line icons doesn't
// justify adding one. Each is a plain functional component so TabsLayout
// can render it as JSX (`<Icon />`) instead of a bare Unicode glyph.

const BASE_PROPS = {
  viewBox: '0 0 18 18',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function IconTrend() {
  return (
    <svg {...BASE_PROPS}>
      <path d="M2.5 13.5l4-4 3 3 5.5-6.5" />
      <path d="M11 5.5h4v4" />
    </svg>
  );
}

export function IconLink() {
  return (
    <svg {...BASE_PROPS}>
      <circle cx="6.5" cy="9" r="3.3" />
      <circle cx="12" cy="9" r="3.3" />
    </svg>
  );
}

export function IconPulse() {
  return (
    <svg {...BASE_PROPS}>
      <path d="M2 9.5h2.8l1.7-5 2.6 9 1.7-6.5 1.3 2.5H16" />
    </svg>
  );
}

export function IconCalendar() {
  return (
    <svg {...BASE_PROPS}>
      <rect x="2.3" y="3.3" width="13.4" height="12.2" rx="1.8" />
      <path d="M2.3 7.3h13.4" />
      <path d="M6 2v2.6" />
      <path d="M12 2v2.6" />
    </svg>
  );
}

export function IconChecklist() {
  return (
    <svg {...BASE_PROPS}>
      <rect x="3.3" y="2.3" width="11.4" height="13.4" rx="1.6" />
      <path d="M6 8l1.4 1.4L10 6.5" />
      <path d="M6 12.3h5.2" />
    </svg>
  );
}

export function IconInsights() {
  return (
    <svg {...BASE_PROPS}>
      <path d="M6.2 10.6a3.3 3.3 0 1 1 5.6 0c-.6.8-1 1.4-1 2.2H7.2c0-.8-.4-1.4-1-2.2z" />
      <path d="M7.2 15.2h3.6" />
      <path d="M9 1.8v1.4" />
      <path d="M3.6 4.3l1 1" />
      <path d="M14.4 4.3l-1 1" />
    </svg>
  );
}

export function IconHelp() {
  return (
    <svg {...BASE_PROPS}>
      <circle cx="9" cy="9" r="6.7" />
      <path d="M6.9 7.1a2.1 2.1 0 1 1 3.2 1.8c-.8.5-1.1.9-1.1 1.8" />
      <circle cx="9" cy="13" r="0.15" fill="currentColor" stroke="currentColor" />
    </svg>
  );
}

export function IconSubscription() {
  return (
    <svg {...BASE_PROPS}>
      <rect x="1.8" y="4.2" width="14.4" height="9.6" rx="1.6" />
      <path d="M1.8 7.4h14.4" />
      <path d="M4.4 11h3" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg {...BASE_PROPS}>
      <circle cx="9" cy="9" r="2.4" />
      <path d="M9 2.6v1.7M9 14.7v1.7M15.4 9h-1.7M4.3 9H2.6M13.5 4.5l-1.2 1.2M6.7 12.3l-1.2 1.2M13.5 13.5l-1.2-1.2M6.7 5.7 5.5 4.5" />
    </svg>
  );
}

export function IconAdmin() {
  return (
    <svg {...BASE_PROPS}>
      <path d="M9 2.2l5.5 2v4.1c0 3.5-2.3 6.2-5.5 7.5-3.2-1.3-5.5-4-5.5-7.5V4.2z" />
      <path d="M6.6 9l1.7 1.7 3.1-3.5" />
    </svg>
  );
}

export function IconLogout() {
  return (
    <svg {...BASE_PROPS}>
      <path d="M7.2 3H4.4a1.8 1.8 0 0 0-1.8 1.8v8.4A1.8 1.8 0 0 0 4.4 15h2.8" />
      <path d="M10.5 5.4 14.1 9l-3.6 3.6M14.1 9H6.8" />
    </svg>
  );
}

export function IconSun() {
  return (
    <svg {...BASE_PROPS}>
      <circle cx="9" cy="9" r="3" />
      <path d="M9 1.8v1.7M9 14.5v1.7M16.2 9h-1.7M3.5 9H1.8M14.1 3.9l-1.2 1.2M5.1 12.9l-1.2 1.2M14.1 14.1l-1.2-1.2M5.1 5.1 3.9 3.9" />
    </svg>
  );
}

export function IconMoon() {
  return (
    <svg {...BASE_PROPS}>
      <path d="M14.8 10.9A6 6 0 1 1 7.1 3.2a6.9 6.9 0 1 0 7.7 7.7z" />
    </svg>
  );
}
