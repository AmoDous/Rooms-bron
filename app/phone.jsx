/* global React */
/* =========================================================================
   Bron — shared shell, icons, atoms, data for the booking-aggregator mockups.
   Built on the YumUp design system (Manrope, warm paper palette, red+orange).
   Exports everything to window so the variant files can consume it.
   ========================================================================= */

// ----------------------------------------------------------------- icons --
// Lucide-style stroke icons. 24×24 viewBox, currentColor, 2px stroke.
const ICON_PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  filter: <path d="M3 4.5h18l-7 8.2V19l-4 2v-8.3z" />,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="2.6" /></>,
  star: <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5 6.2 20.5l1.1-6.5-4.7-4.6 6.5-.95z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.2v5l3.2 2" /></>,
  calendar: <><rect x="3" y="4.6" width="18" height="16.8" rx="2.6" /><path d="M3 9.4h18M8 2.6v4M16 2.6v4" /></>,
  calCheck: <><rect x="3" y="4.6" width="18" height="16.8" rx="2.6" /><path d="M3 9.4h18M8 2.6v4M16 2.6v4M8.5 15l2.2 2.2 4-4.4" /></>,
  users: <><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.4 2.7-5.2 6-5.2s6 1.8 6 5.2" /><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M21.5 20c0-2.7-1.5-4.3-3.6-4.9" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
  chevR: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  chevL: <path d="m15 5.5-6.5 6.5L15 18.5" />,
  chevD: <path d="m6 9 6 6 6-6" />,
  check: <path d="m20 6.5-11 11-5-5" />,
  checkCircle: <><circle cx="12" cy="12" r="9.2" /><path d="m8 12 2.8 2.8L16 9.2" /></>,
  heart: <path d="M12 21s-7.8-5.1-7.8-10.6A4.4 4.4 0 0 1 12 6.6a4.4 4.4 0 0 1 7.8 3.8C19.8 15.9 12 21 12 21z" />,
  home: <><path d="M3 11 12 3.2 21 11" /><path d="M5.2 9.6V20h13.6V9.6" /></>,
  bookmark: <path d="M6 3.4h12v17.2l-6-3.8-6 3.8z" />,
  map: <><path d="M9 3 3 5.5v15L9 18l6 2.5 6-2.5v-15L15 5.5 9 3z" /><path d="M9 3v15M15 5.5v15" /></>,
  x: <path d="M6 6 18 18M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  arrowR: <path d="M4 12h15m-6.5-6.5L19 12l-6.5 6.5" />,
  phone: <path d="M5.2 4h3.4l1.7 4.3-2.1 1.3a11.5 11.5 0 0 0 5 5l1.3-2.1L24 16v-.5l-4.3-.7 1.3 3.4v1.6a2 2 0 0 1-2.2 2A16.8 16.8 0 0 1 3 6.2 2 2 0 0 1 5.2 4z" />,
  share: <><circle cx="18" cy="5.5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="18.5" r="2.6" /><path d="m8.3 13.3 7.4 4M15.7 6.7l-7.4 4" /></>,
  bell: <><path d="M6 9.5a6 6 0 0 1 12 0c0 6.5 2.6 6.5 2.6 8.5H3.4C3.4 16 6 16 6 9.5z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7.5 18.3 3.6 19.4l1.1-3.9z" /></>,
  logout: <><path d="M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 16.5 4.5-4.5L16 7.5M20.5 12H9.5" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2.4" /><path d="M3 10h18" /></>,
  help: <><circle cx="12" cy="12" r="9.2" /><path d="M9.4 9.4a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4M12 17.2h.01" /></>,
  utensils: <><path d="M4 3v6.5a2 2 0 0 0 4 0V3M6 9.5V21M16.5 3c-1.8 0-2.8 2-2.8 4.6s1 3.9 2.8 3.9V21" /></>,
  coffee: <><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M17 9h2.2a2.3 2.3 0 0 1 0 4.6H17M7 2.5v2M11 2.5v2" /></>,
  fire: <path d="M12 2.5c1 3 3.5 4.2 3.5 7.5a3.5 3.5 0 0 1-7 0c0-.8.2-1.4.5-2-.6.4-1 1-1.3 1.8A6 6 0 1 0 17.6 12c0-4-3.6-6-5.6-9.5z" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  ticket: <><path d="M4 7.5A2 2 0 0 1 6 5.5h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><path d="M12 6v12" strokeDasharray="2 2.4" /></>,
  navigation: <path d="M3.5 11 21 4l-7 17-2.6-7.4z" />,
};

const Icon = ({ n, size = 20, sw = 1.9, fill = 'none', color, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={fill === 'currentColor' ? 'none' : 'currentColor'}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ color, display: 'block', flexShrink: 0, ...style }}>{ICON_PATHS[n]}</svg>
);

// --------------------------------------------------------------- shell ----
const StatusBar = ({ dark }) => {
  const c = dark ? '#fff' : '#1f1d1b';
  return (
    <div style={{
      height: 30, padding: '13px 24px 0', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', position: 'relative', zIndex: 40, flexShrink: 0,
    }}>
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: 700, color: c, letterSpacing: '-0.02em' }}>9:41</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="2.6" height="4" rx="0.6" fill={c} /><rect x="4" y="4.5" width="2.6" height="6.5" rx="0.6" fill={c} /><rect x="8" y="2" width="2.6" height="9" rx="0.6" fill={c} /><rect x="12" y="0" width="2.6" height="11" rx="0.6" fill={c} /></svg>
        <svg width="24" height="11" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke={c} strokeOpacity="0.4" fill="none" /><rect x="2" y="2" width="16" height="7" rx="1.6" fill={c} /><rect x="21.5" y="3.5" width="1.6" height="4" rx="0.8" fill={c} fillOpacity="0.4" /></svg>
      </span>
    </div>
  );
};

function Phone({ children, bg = 'var(--background)', statusDark = false }) {
  return (
    <div style={{
      width: 322, height: 698, borderRadius: 47, background: '#0b0a09', padding: 5,
      boxShadow: '0 32px 64px rgba(28,22,16,0.26), 0 0 0 1px rgba(0,0,0,0.16)', position: 'relative',
    }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 42, overflow: 'hidden', background: bg, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: 95, height: 26, borderRadius: 16, background: '#0b0a09', zIndex: 50 }} />
        <StatusBar dark={statusDark} />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>{children}</div>
        <div style={{ position: 'absolute', bottom: 7, left: '50%', transform: 'translateX(-50%)', width: 118, height: 5, borderRadius: 99, background: statusDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.26)', zIndex: 60 }} />
      </div>
    </div>
  );
}

// scrollable content body (no visible scrollbar, hides under tab bar)
const Body = ({ children, style, pad = 16 }) => (
  <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: pad, ...style }}>{children}</div>
);

// --------------------------------------------------------------- atoms ----
const Kicker = ({ children, style }) => (
  <p style={{ fontFamily: 'var(--font-heading)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', ...style }}>{children}</p>
);

const Btn = ({ children, variant = 'primary', size = 'lg', icon, style, ...rest }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    fontFamily: 'var(--font-heading)', fontWeight: 700, letterSpacing: '-0.01em', cursor: 'pointer',
    border: '1px solid transparent', whiteSpace: 'nowrap',
    height: size === 'lg' ? 50 : size === 'sm' ? 34 : 42,
    padding: size === 'lg' ? '0 22px' : size === 'sm' ? '0 13px' : '0 16px',
    fontSize: size === 'lg' ? 15 : size === 'sm' ? 12.5 : 14,
    borderRadius: 'var(--ui-radius, 16px)',
  };
  const variants = {
    primary: { background: 'var(--primary)', color: '#fff', boxShadow: '0 6px 18px color-mix(in srgb, var(--primary) 28%, transparent)' },
    dark: { background: 'var(--secondary)', color: '#fff' },
    outline: { background: 'var(--card)', color: 'var(--foreground)', borderColor: 'var(--border)' },
    ghost: { background: 'transparent', color: 'var(--foreground)' },
    soft: { background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' },
  };
  return <button style={{ ...base, ...variants[variant], ...style }} {...rest}>{icon && <Icon n={icon} size={size === 'sm' ? 15 : 18} sw={2.1} />}{children}</button>;
};

const Pill = ({ tone = 'neutral', children, icon, style }) => {
  const tones = {
    success: { bg: 'var(--ramp-success-bg)', fg: 'var(--success)' },
    warn: { bg: 'var(--ramp-warning-bg)', fg: 'var(--accent)' },
    danger: { bg: 'var(--ramp-red-100)', fg: 'var(--primary)' },
    neutral: { bg: 'var(--ramp-paper-400)', fg: 'var(--muted-foreground)' },
    invert: { bg: 'rgba(255,255,255,0.16)', fg: '#fff' },
    brand: { bg: 'color-mix(in srgb, var(--primary) 12%, transparent)', fg: 'var(--primary)' },
  }[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '-0.01em', background: tones.bg, color: tones.fg, ...style }}>
      {icon && <Icon n={icon} size={12} sw={2.4} />}{children}
    </span>
  );
};

// star rating inline
const Rating = ({ value, size = 12, color = 'var(--accent)' }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: size, color: 'var(--foreground)' }}>
    <Icon n="star" size={size + 1} fill={color} color={color} sw={0} /> {value}
  </span>
);

// gradient thumbnail placeholder (design system uses gradient placeholders for food imagery)
const THUMBS = {
  red: 'linear-gradient(135deg,#ffe3d6 0%,#fdc4b0 100%)',
  orange: 'linear-gradient(135deg,#ffeccd 0%,#ffd29a 100%)',
  brown: 'linear-gradient(135deg,#e9d9cf 0%,#c9a88f 100%)',
  green: 'linear-gradient(135deg,#dcefd9 0%,#b6dcae 100%)',
  plum: 'linear-gradient(135deg,#efd9e4 0%,#d6a9bf 100%)',
  sky: 'linear-gradient(135deg,#dde6ea 0%,#b3c4cc 100%)',
};
const Thumb = ({ tone = 'red', radius = 14, children, style }) => (
  <div style={{ background: THUMBS[tone], borderRadius: radius, position: 'relative', overflow: 'hidden', flexShrink: 0, ...style }}>{children}</div>
);

// bottom tab bar — two visual styles
const TABS = [
  { n: 'home', label: 'Главная' },
  { n: 'map', label: 'Карта' },
  { n: 'bookmark', label: 'Брони' },
  { n: 'user', label: 'Профиль' },
];
function TabBar({ active = 0, variant = 'line' }) {
  return (
    <div style={{
      flexShrink: 0, display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      padding: '9px 12px 22px', background: 'var(--card)', borderTop: '1px solid var(--border)',
      position: 'relative', zIndex: 30,
    }}>
      {TABS.map((t, i) => {
        const on = i === active;
        if (variant === 'pill') {
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: on ? '0 14px' : '0 8px', borderRadius: 999, background: on ? 'var(--primary)' : 'transparent', color: on ? '#fff' : 'var(--muted-foreground)' }}>
              <Icon n={t.n} size={20} sw={on ? 2.1 : 1.8} fill={on ? 'currentColor' : 'none'} />
              {on && <span style={{ fontFamily: 'var(--font-heading)', fontSize: 12, fontWeight: 700 }}>{t.label}</span>}
            </div>
          );
        }
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: on ? 'var(--primary)' : 'var(--muted-foreground)' }}>
            <Icon n={t.n} size={21} sw={on ? 2.2 : 1.8} fill={on ? 'currentColor' : 'none'} />
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 9.5, fontWeight: on ? 700 : 600 }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// round icon button (overlay on photos / headers)
const RoundBtn = ({ n, onLight, size = 36, iconSize = 18, style }) => (
  <button style={{
    width: size, height: size, borderRadius: 999, border: 'none', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: onLight ? 'var(--card)' : 'rgba(255,255,255,0.92)', color: 'var(--foreground)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.14)', backdropFilter: 'blur(6px)', ...style,
  }}><Icon n={n} size={iconSize} sw={2} /></button>
);

// guest stepper
const Stepper = ({ value = 2 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    <button style={{ width: 38, height: 38, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="minus" size={18} sw={2.4} /></button>
    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', minWidth: 26, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    <button style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="plus" size={18} sw={2.4} /></button>
  </div>
);

// chip (filter / time slot / date)
const Chip = ({ children, active, disabled, sub, style }) => (
  <div style={{
    display: 'inline-flex', flexDirection: sub ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: sub ? 1 : 5,
    height: sub ? 52 : 32, padding: sub ? '0 14px' : '0 13px', borderRadius: sub ? 14 : 999,
    background: active ? 'var(--primary)' : disabled ? 'transparent' : 'var(--card)',
    color: active ? '#fff' : disabled ? 'var(--subtle-foreground)' : 'var(--foreground)',
    border: active ? '1px solid transparent' : '1px solid var(--border)',
    fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 700, letterSpacing: '-0.01em',
    whiteSpace: 'nowrap', opacity: disabled ? 0.55 : 1, textDecoration: disabled ? 'line-through' : 'none',
    boxShadow: active ? '0 6px 16px color-mix(in srgb, var(--primary) 26%, transparent)' : 'none', flexShrink: 0, ...style,
  }}>{children}</div>
);

// section heading row
const SectionHead = ({ title, action, style }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', ...style }}>
    <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--foreground)' }}>{title}</h3>
    {action && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{action}</span>}
  </div>
);

// ---------------------------------------------------------------- data ----
const RESTOS = [
  { name: 'Кочевник', cuisine: 'Казахская кухня', price: '₸₸', rating: 4.8, reviews: 312, dist: '1.2 км', tone: 'brown', slots: ['18:30', '19:00', '21:00'], tag: 'Свободно сегодня' },
  { name: 'Aurora Rooftop', cuisine: 'Европейская · бар', price: '₸₸₸', rating: 4.9, reviews: 540, dist: '0.4 км', tone: 'plum', slots: ['20:00', '20:30'], tag: 'Осталось 2 стола' },
  { name: 'Del Papa', cuisine: 'Итальянская', price: '₸₸', rating: 4.6, reviews: 188, dist: '0.8 км', tone: 'red', slots: ['18:00', '19:30', '20:00'], tag: 'Свободно сегодня' },
  { name: 'Sandyq', cuisine: 'Современная казахская', price: '₸₸₸', rating: 4.7, reviews: 264, dist: '2.1 км', tone: 'orange', slots: ['19:00', '21:30'], tag: 'Популярно' },
  { name: 'Coffee BOOM', cuisine: 'Кофейня · завтраки', price: '₸', rating: 4.5, reviews: 97, dist: '0.3 км', tone: 'green', slots: ['09:30', '11:00', '13:00'], tag: 'Свободно сейчас' },
  { name: 'Тюбетейка', cuisine: 'Чайхана', price: '₸₸', rating: 4.4, reviews: 121, dist: '1.6 км', tone: 'sky', slots: ['17:30', '19:00'], tag: 'Свободно сегодня' },
];

const CATEGORIES = [
  { label: 'Всё', n: 'sparkle' }, { label: 'Рядом', n: 'pin' }, { label: 'Свободно сейчас', n: 'fire' },
  { label: 'Завтраки', n: 'coffee' }, { label: 'Ужин', n: 'utensils' },
];

const DATES = [
  { d: 'Сегодня', n: '3' }, { d: 'Чт', n: '4' }, { d: 'Пт', n: '5' }, { d: 'Сб', n: '6' }, { d: 'Вс', n: '7' }, { d: 'Пн', n: '8' },
];

Object.assign(window, {
  Icon, Phone, StatusBar, Body, Kicker, Btn, Pill, Rating, Thumb, THUMBS,
  TabBar, RoundBtn, Stepper, Chip, SectionHead, RESTOS, CATEGORIES, DATES,
});
