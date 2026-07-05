/* global React, window */
/* =========================================================================
   Web · Desktop — shell + atoms for the booking aggregator (Variant A on web).
   Reuses Icon / Pill / Rating / Thumb / data from app/phone.jsx.
   ========================================================================= */
const WS = window;
const { Icon, Pill, Rating, Thumb, RESTOS, CATEGORIES, DATES } = WS;

const wMuted = 'var(--muted-foreground)';
const wCard = { background: 'var(--card)', borderRadius: 'var(--ui-radius, 18px)', border: '1px solid var(--border)' };

// ---- button --------------------------------------------------------------
const WBtn = ({ children, variant = 'primary', size = 'md', icon, iconR, style, ...rest }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
    fontFamily: 'var(--font-heading)', fontWeight: 700, letterSpacing: '-0.01em', cursor: 'pointer',
    border: '1px solid transparent', whiteSpace: 'nowrap',
    height: size === 'lg' ? 52 : size === 'sm' ? 38 : 46,
    padding: size === 'lg' ? '0 26px' : size === 'sm' ? '0 16px' : '0 20px',
    fontSize: size === 'lg' ? 15.5 : size === 'sm' ? 13 : 14.5,
    borderRadius: 'var(--ui-radius, 14px)', transition: 'transform .12s, background .15s',
  };
  const variants = {
    primary: { background: 'var(--primary)', color: '#fff', boxShadow: '0 8px 22px color-mix(in srgb, var(--primary) 26%, transparent)' },
    dark: { background: 'var(--secondary)', color: '#fff' },
    outline: { background: 'var(--card)', color: 'var(--foreground)', borderColor: 'var(--border)' },
    ghost: { background: 'transparent', color: 'var(--foreground)' },
    soft: { background: 'color-mix(in srgb, var(--primary) 11%, transparent)', color: 'var(--primary)' },
  };
  return (
    <button style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {icon && <Icon n={icon} size={size === 'sm' ? 16 : 19} sw={2.1} />}{children}{iconR && <Icon n={iconR} size={size === 'sm' ? 16 : 19} sw={2.1} />}
    </button>
  );
};

// ---- chip ----------------------------------------------------------------
const WChip = ({ children, active, icon, onClick, style }) => (
  <button onClick={onClick} style={{
    display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 17px',
    borderRadius: 999, cursor: 'pointer', flexShrink: 0,
    background: active ? 'var(--primary)' : 'var(--card)', color: active ? '#fff' : 'var(--foreground)',
    border: active ? '1px solid transparent' : '1px solid var(--border)',
    fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em',
    boxShadow: active ? '0 6px 16px color-mix(in srgb, var(--primary) 24%, transparent)' : 'none', ...style,
  }}>{icon && <Icon n={icon} size={16} fill={active ? 'currentColor' : 'none'} sw={2} />}{children}</button>
);

// ---- stepper -------------------------------------------------------------
const WStepper = ({ value = 2 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <button style={{ width: 42, height: 42, borderRadius: 13, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="minus" size={20} sw={2.4} /></button>
    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', minWidth: 30, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    <button style={{ width: 42, height: 42, borderRadius: 13, border: 'none', background: 'var(--primary)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="plus" size={20} sw={2.4} /></button>
  </div>
);

// ---- logo wordmark -------------------------------------------------------
const Logo = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <div style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <Icon n="pin" size={19} sw={2.2} />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 19, fontWeight: 800, letterSpacing: '-0.04em' }}>Бронь</span>
      <span style={{ fontSize: 9, color: wMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>заведения · Алматы</span>
    </div>
  </div>
);

// ---- sidebar -------------------------------------------------------------
const NAV = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'fav', label: 'Избранное', icon: 'heart' },
  { id: 'bookings', label: 'Мои брони', icon: 'calCheck' },
  { id: 'profile', label: 'Профиль', icon: 'user' },
];
function Sidebar({ page, onNav }) {
  const cur = page === 'venue' ? 'home' : page;
  return (
    <div style={{ width: 244, flexShrink: 0, background: 'var(--card)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '26px 18px' }}>
      <div style={{ paddingLeft: 6 }}><Logo /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 34 }}>
        {NAV.map(n => {
          const on = cur === n.id;
          return (
            <button key={n.id} onClick={() => onNav(n.id)} style={{
              display: 'flex', alignItems: 'center', gap: 13, height: 46, padding: '0 14px', borderRadius: 13, cursor: 'pointer',
              border: 'none', background: on ? 'color-mix(in srgb, var(--primary) 11%, transparent)' : 'transparent',
              color: on ? 'var(--primary)' : 'var(--foreground)', fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: on ? 800 : 600, letterSpacing: '-0.01em', textAlign: 'left',
            }}>
              <Icon n={n.icon} size={20} sw={on ? 2.2 : 1.9} fill={on && (n.icon === 'heart') ? 'currentColor' : 'none'} />{n.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 'auto' }}>
        <div style={{ ...wCard, padding: 16, background: 'var(--secondary)', border: 'none', color: '#fff' }}>
          <Icon n="sparkle" size={20} color="var(--accent)" />
          <p style={{ fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: 800, marginTop: 10, letterSpacing: '-0.02em' }}>Брось бизнес сюда</p>
          <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: 4, lineHeight: 1.4 }}>Подключите своё заведение к платформе бронирования.</p>
          <button style={{ marginTop: 12, width: '100%', height: 38, borderRadius: 11, border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Узнать больше</button>
        </div>
      </div>
    </div>
  );
}

// ---- topbar --------------------------------------------------------------
function TopBar() {
  return (
    <div style={{ height: 76, flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--card)', display: 'flex', alignItems: 'center', gap: 18, padding: '0 32px' }}>
      <div style={{ flex: 1, maxWidth: 440, height: 46, borderRadius: 'var(--ui-radius, 14px)', background: 'var(--background)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 11, padding: '0 16px' }}>
        <Icon n="search" size={19} color={wMuted} />
        <span style={{ fontSize: 14, color: wMuted }}>Заведение, кухня или район…</span>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 16px', borderRadius: 'var(--ui-radius, 14px)', border: '1px solid var(--border)', background: 'var(--card)' }}>
          <Icon n="calendar" size={17} color="var(--primary)" /><span style={{ fontSize: 13.5, fontWeight: 700 }}>Сегодня</span><span style={{ color: 'var(--border)' }}>·</span><Icon n="users" size={17} color="var(--primary)" /><span style={{ fontSize: 13.5, fontWeight: 700 }}>2</span><Icon n="chevD" size={15} sw={2.2} color={wMuted} />
        </div>
        <button style={{ width: 46, height: 46, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
          <Icon n="bell" size={19} /><span style={{ position: 'absolute', top: 11, right: 12, width: 7, height: 7, borderRadius: 99, background: 'var(--primary)', border: '1.5px solid var(--card)' }} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 42, height: 42, borderRadius: 999, background: 'linear-gradient(135deg,var(--accent),var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15 }}>АС</div>
          <div style={{ lineHeight: 1.2 }}><p style={{ fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 800 }}>Алия</p><p style={{ fontSize: 11, color: wMuted }}>Алматы</p></div>
        </div>
      </div>
    </div>
  );
}

const WSectionHead = ({ title, sub, action, style }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', ...style }}>
    <div>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</h2>
      {sub && <p style={{ fontSize: 13, color: wMuted, marginTop: 4 }}>{sub}</p>}
    </div>
    {action}
  </div>
);

const WDot = () => <span style={{ color: 'var(--subtle-foreground)', margin: '0 6px', fontWeight: 700 }}>·</span>;

window.Web = { wMuted, wCard, WBtn, WChip, WStepper, Logo, Sidebar, TopBar, WSectionHead, WDot };
