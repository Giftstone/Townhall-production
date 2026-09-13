/** Townhall icon set — gold accent, matches dark civic theme */
const stroke = 'currentColor';

function baseProps(size, className, extra = {}) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className: className ? `th-icon ${className}` : 'th-icon',
    'aria-hidden': true,
    ...extra,
  };
}

export function IconBuilding({ size = 22, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M3 21h18" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <path d="M5 21V7l7-4 7 4v14" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M9 21v-6h6v6" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" stroke={stroke} strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  );
}

export function IconBell({ size = 20, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M10 21a2 2 0 0 0 4 0" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconPoll({ size = 20, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M8 6h13M8 12h13M8 18h13" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconReport({ size = 20, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M14 2v6h6M8 13h8M8 17h6" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUsers({ size = 20, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" stroke={stroke} strokeWidth="1.75" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconMapPin({ size = 20, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 22s8-4.5 8-11.5a8 8 0 1 0-16 0C4 17.5 12 22 12 22z" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx="12" cy="10.5" r="2.5" stroke={stroke} strokeWidth="1.75" />
    </svg>
  );
}

export function IconShield({ size = 20, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChart({ size = 20, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M4 19h16M7 16V9M12 16V5M17 16v-6" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M20 6L9 17l-5-5" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlus({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 5v14M5 12h14" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconLogout({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <path d="M16 17l5-5-5-5M21 12H9" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLogin({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
      <path d="M10 17l5-5-5-5M15 12H3" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUserPlus({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke={stroke} strokeWidth="1.75" />
      <circle cx="9" cy="7" r="4" stroke={stroke} strokeWidth="1.75" />
      <path d="M19 8v6M22 11h-6" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconSpinner({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className, { className: className ? `th-icon th-spin ${className}` : 'th-icon th-spin' })}>
      <path d="M12 3a9 9 0 1 0 9 9" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconRefresh({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 3v5h-5" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUser({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={stroke} strokeWidth="1.75" />
      <circle cx="12" cy="7" r="4" stroke={stroke} strokeWidth="1.75" />
    </svg>
  );
}

export function IconSpark({ size = 18, className }) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/** Map notification type → icon component */
export function notifIcon(type, size = 16) {
  switch (type) {
    case 'new_report':
      return <IconSpark size={size} />;
    case 'status_update':
      return <IconRefresh size={size} />;
    case 'report_assigned':
      return <IconReport size={size} />;
    case 'role_change':
      return <IconUser size={size} />;
    default:
      return <IconBell size={size} />;
  }
}
