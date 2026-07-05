/* global React, window */
/* =========================================================================
   Web · Desktop — pages + interactive app root (Variant A on web).
   ========================================================================= */
const WP = window;
const { Icon, Pill, Rating, Thumb, THUMBS, RESTOS, CATEGORIES, DATES } = WP;
const { wMuted: m, wCard: card, WBtn, WChip, WStepper, Sidebar, TopBar, WSectionHead, WDot } = WP.Web;
const { useState } = React;

// ------------------------------------------------------------- map rail ---
function MapRail() {
  const pins = [
    { x: 70, y: 90, big: true, label: '4.8' }, { x: 190, y: 150, label: '4.9' },
    { x: 120, y: 250, label: '4.6' }, { x: 250, y: 220, label: '4.7' }, { x: 200, y: 340, label: '4.5' },
  ];
  return (
    <div style={{ ...card, width: 348, flexShrink: 0, position: 'sticky', top: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
      <div style={{ height: 470, background: 'linear-gradient(135deg,#efece6 0%,#e6e3dc 100%)', position: 'relative' }}>
        <svg viewBox="0 0 348 470" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d="M0 200 Q 120 160 220 240 T 348 200" stroke="#d6d3cc" strokeWidth="5" fill="none" />
          <path d="M60 0 L 90 470" stroke="#d6d3cc" strokeWidth="4" fill="none" />
          <path d="M240 0 L 270 470" stroke="#d6d3cc" strokeWidth="4" fill="none" />
          <path d="M0 360 Q 180 330 348 380" stroke="#d6d3cc" strokeWidth="3" fill="none" />
        </svg>
        {pins.map((p, i) => (
          <div key={i} style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%,-100%)', background: p.big ? 'var(--primary)' : 'var(--card)', color: p.big ? '#fff' : 'var(--foreground)', height: 30, padding: '0 11px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 800, boxShadow: '0 6px 16px rgba(0,0,0,0.16)', border: p.big ? 'none' : '1px solid var(--border)' }}>
            <Icon n="star" size={12} fill={p.big ? '#fff' : 'var(--accent)'} color={p.big ? '#fff' : 'var(--accent)'} sw={0} />{p.label}
          </div>
        ))}
        <div style={{ position: 'absolute', top: 14, left: 14 }}><Pill tone="invert" style={{ background: 'rgba(28,22,16,0.6)', backdropFilter: 'blur(4px)', height: 28, padding: '0 12px', fontSize: 12 }}>12 мест рядом</Pill></div>
      </div>
      <div style={{ padding: 14 }}><WBtn variant="outline" size="sm" icon="navigation" style={{ width: '100%' }}>Открыть карту целиком</WBtn></div>
    </div>
  );
}

// ------------------------------------------------------------- listing ----
function WListing({ onOpen }) {
  return (
    <div style={{ padding: 32 }}>
      <WSectionHead title="Столики на сегодня" sub="Свободные брони рядом с вами · Алматы, центр"
        action={<div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 42, padding: '0 16px', borderRadius: 'var(--ui-radius,14px)', border: '1px solid var(--border)', background: 'var(--card)', cursor: 'pointer' }}><span style={{ fontSize: 12.5, color: m }}>Сортировка:</span><span style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 700 }}>По рейтингу</span><Icon n="chevD" size={15} sw={2.2} color={m} /></div>} />

      <div style={{ display: 'flex', gap: 9, marginTop: 22, flexWrap: 'wrap' }}>
        {CATEGORIES.map((c, i) => <WChip key={i} active={i === 0} icon={c.n}>{c.label}</WChip>)}
      </div>

      <div style={{ display: 'flex', gap: 24, marginTop: 26, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {RESTOS.map((r, i) => (
            <div key={i} className="resto-card" onClick={() => onOpen(r)} style={{ ...card, overflow: 'hidden', cursor: 'pointer' }}>
              <Thumb tone={r.tone} radius={0} style={{ height: 150 }}>
                <div style={{ position: 'absolute', top: 12, left: 12 }}><Pill tone="success" icon="check" style={{ background: 'rgba(255,255,255,0.94)' }}>{r.tag}</Pill></div>
                <button onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.92)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--foreground)' }}><Icon n="heart" size={17} /></button>
              </Thumb>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 16.5, fontWeight: 800, letterSpacing: '-0.025em' }}>{r.name}</h3>
                  <span style={{ fontSize: 12.5, color: m, fontWeight: 700 }}>{r.price}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 5, fontSize: 12.5, color: m }}>
                  <Rating value={r.rating} size={12.5} /><span style={{ marginLeft: 5 }}>({r.reviews})</span><WDot />{r.cuisine}<WDot />{r.dist}
                </div>
                <div style={{ display: 'flex', gap: 7, marginTop: 13 }}>
                  {r.slots.slice(0, 3).map((s, j) => (
                    <span key={j} style={{ fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 800, color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 9%, transparent)', borderRadius: 9, padding: '6px 11px' }}>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <MapRail />
      </div>
    </div>
  );
}

// ------------------------------------------------------------- venue ------
function WVenue({ onBook, onBack }) {
  const r = RESTOS[0];
  const times = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'];
  return (
    <div style={{ padding: 32 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', color: m, fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 700 }}><Icon n="chevL" size={17} sw={2.2} />Все заведения</button>

      <Thumb tone={r.tone} radius="var(--ui-radius, 20px)" style={{ height: 300, marginTop: 16 }}>
        <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 10 }}>
          <button style={{ width: 42, height: 42, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.92)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="heart" size={19} /></button>
          <button style={{ width: 42, height: 42, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.92)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="share" size={18} /></button>
        </div>
      </Thumb>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        {['orange', 'plum', 'brown', 'green'].map((t, i) => <Thumb key={i} tone={t} radius={13} style={{ width: 132, height: 80, flexShrink: 0, opacity: i === 0 ? 1 : 0.85 }} />)}
      </div>

      <div style={{ display: 'flex', gap: 32, marginTop: 28, alignItems: 'flex-start' }}>
        {/* details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Pill tone="warn" icon="sparkle">Популярно</Pill><Pill tone="neutral">{r.price}</Pill>
          </div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 32, fontWeight: 800, letterSpacing: '-0.04em', marginTop: 12 }}>{r.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 7, fontSize: 14, color: m }}><Rating value={r.rating} size={14} /><span style={{ marginLeft: 6 }}>{r.reviews} отзывов</span><WDot />{r.cuisine}</div>

          <div style={{ display: 'flex', gap: 14, marginTop: 22 }}>
            {[['pin', 'ул. Панфилова 98', '1.2 км от центра'], ['clock', 'Открыто до 23:00', 'Кухня до 22:30'], ['users', 'Столы 2–8 гостей', 'Зал · веранда']].map(([ic, a, b], i) => (
              <div key={i} style={{ ...card, flex: 1, padding: '16px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}><Icon n={ic} size={20} /></div>
                <div><p style={{ fontSize: 13.5, fontWeight: 800 }}>{a}</p><p style={{ fontSize: 11.5, color: m, marginTop: 2 }}>{b}</p></div>
              </div>
            ))}
          </div>

          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 28 }}>О заведении</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--foreground)', marginTop: 10, maxWidth: 620 }}>
            Современная казахская кухня в уютном зале с открытой верандой. Авторские блюда из локальных продуктов, сезонное меню и большая винная карта. Идеально для ужина вдвоём или встречи с друзьями.
          </p>

          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 28 }}>Отзывы гостей</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
            {[['Дамир К.', '«Лучшая веранда в городе, бронь сработала идеально.»'], ['Сауле Т.', '«Уютно и вкусно, столик был готов к нашему приходу.»']].map(([n, t], i) => (
              <div key={i} style={{ ...card, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--ramp-orange-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 13, color: 'var(--primary)' }}>{n[0]}</div>
                  <div style={{ flex: 1 }}><p style={{ fontSize: 13, fontWeight: 800 }}>{n}</p><div style={{ display: 'flex', gap: 1, marginTop: 3 }}>{[0, 1, 2, 3, 4].map(s => <Icon key={s} n="star" size={11} fill="var(--accent)" color="var(--accent)" sw={0} />)}</div></div>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--foreground)', lineHeight: 1.5, marginTop: 11 }}>{t}</p>
              </div>
            ))}
          </div>
        </div>

        {/* booking widget */}
        <div style={{ width: 360, flexShrink: 0, position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <div style={{ ...card, padding: 22, boxShadow: 'var(--shadow-soft)' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.025em' }}>Забронировать стол</h3>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Icon n="users" size={19} color="var(--primary)" /><span style={{ fontSize: 13.5, fontWeight: 700 }}>Гости</span></div>
              <WStepper value={2} />
            </div>

            <p style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 800, marginTop: 20, marginBottom: 9 }}>Дата</p>
            <div style={{ display: 'flex', gap: 7 }}>
              {DATES.slice(0, 5).map((d, i) => (
                <div key={i} style={{ flex: 1, height: 56, borderRadius: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer', background: i === 0 ? 'var(--primary)' : 'var(--card)', color: i === 0 ? '#fff' : 'var(--foreground)', border: i === 0 ? '1px solid transparent' : '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.85 }}>{d.d}</span><span style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800 }}>{d.n}</span>
                </div>
              ))}
            </div>

            <p style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 800, marginTop: 18, marginBottom: 9 }}>Время</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 7 }}>
              {times.map((t, i) => {
                const sel = t === '19:00', dis = t === '18:00' || t === '21:30';
                return <div key={i} style={{ height: 40, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 700, cursor: dis ? 'default' : 'pointer', background: sel ? 'var(--primary)' : dis ? 'transparent' : 'var(--card)', color: sel ? '#fff' : dis ? 'var(--subtle-foreground)' : 'var(--foreground)', border: sel ? '1px solid transparent' : '1px solid var(--border)', opacity: dis ? 0.5 : 1, textDecoration: dis ? 'line-through' : 'none' }}>{t}</div>;
              })}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', margin: '18px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
              <span style={{ fontSize: 12.5, color: m }}>Ваша бронь</span>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: 800 }}>2 гостя · Сегодня 19:00</span>
            </div>
            <WBtn size="lg" icon="calendar" style={{ width: '100%' }} onClick={onBook}>Забронировать</WBtn>
            <p style={{ fontSize: 11.5, color: m, textAlign: 'center', marginTop: 11 }}>Бесплатная отмена за 2 часа до визита</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- bookings ---
function WBookings({ onOpen }) {
  const [tab, setTab] = useState(0);
  const InfoCol = (ic, label, val) => (
    <div style={{ minWidth: 110 }}><p style={{ fontSize: 11, color: m, display: 'flex', alignItems: 'center', gap: 5 }}><Icon n={ic} size={13} />{label}</p><p style={{ fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: 800, marginTop: 4 }}>{val}</p></div>
  );
  return (
    <div style={{ padding: 32, maxWidth: 980 }}>
      <WSectionHead title="Мои брони" sub="Управляйте предстоящими и прошедшими визитами" />
      <div style={{ display: 'flex', gap: 6, marginTop: 20, background: 'var(--muted)', borderRadius: 13, padding: 4, width: 'fit-content' }}>
        {['Предстоящие', 'Прошедшие'].map((t, i) => (
          <button key={i} onClick={() => setTab(i)} style={{ height: 38, padding: '0 22px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 700, background: tab === i ? 'var(--card)' : 'transparent', color: tab === i ? 'var(--foreground)' : m, boxShadow: tab === i ? 'var(--shadow-card)' : 'none' }}>{t}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}>
        {tab === 0 ? (
          <React.Fragment>
            <div style={{ ...card, borderColor: 'color-mix(in srgb, var(--primary) 32%, var(--border))', padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
              <Thumb tone={RESTOS[0].tone} radius={14} style={{ width: 76, height: 76, flexShrink: 0 }} />
              <div style={{ width: 170 }}><p style={{ fontFamily: 'var(--font-heading)', fontSize: 17, fontWeight: 800 }}>{RESTOS[0].name}</p><p style={{ fontSize: 12, color: m, marginTop: 3 }}>{RESTOS[0].cuisine}</p></div>
              {InfoCol('calendar', 'Дата и время', 'Сегодня 19:00')}
              {InfoCol('users', 'Гости', '2 гостя')}
              {InfoCol('ticket', 'Код', 'BR-4820')}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Pill tone="success" icon="check">Подтверждено</Pill>
                <WBtn variant="outline" size="sm">Изменить</WBtn>
                <WBtn variant="soft" size="sm">Отменить</WBtn>
              </div>
            </div>
            <div style={{ ...card, padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
              <Thumb tone={RESTOS[1].tone} radius={14} style={{ width: 76, height: 76, flexShrink: 0 }} />
              <div style={{ width: 170 }}><p style={{ fontFamily: 'var(--font-heading)', fontSize: 17, fontWeight: 800 }}>{RESTOS[1].name}</p><p style={{ fontSize: 12, color: m, marginTop: 3 }}>{RESTOS[1].cuisine}</p></div>
              {InfoCol('calendar', 'Дата и время', '6 июня 20:30')}
              {InfoCol('users', 'Гости', '4 гостя')}
              {InfoCol('ticket', 'Код', 'BR-4920')}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Pill tone="warn" icon="clock">Ожидает</Pill>
                <WBtn variant="outline" size="sm">Изменить</WBtn>
                <WBtn variant="soft" size="sm">Отменить</WBtn>
              </div>
            </div>
          </React.Fragment>
        ) : (
          [RESTOS[2], RESTOS[4], RESTOS[3]].map((r, i) => (
            <div key={i} style={{ ...card, padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
              <Thumb tone={r.tone} radius={14} style={{ width: 70, height: 70, flexShrink: 0, filter: 'saturate(0.85)' }} />
              <div style={{ width: 170 }}><p style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800 }}>{r.name}</p><p style={{ fontSize: 12, color: m, marginTop: 3 }}>{r.cuisine}</p></div>
              {InfoCol('calendar', 'Визит', ['28 мая 20:00', '14 мая 13:00', '2 мая 19:30'][i])}
              {InfoCol('users', 'Гости', ['2 гостя', '3 гостя', '2 гостя'][i])}
              <div style={{ display: 'flex', gap: 1, alignSelf: 'center' }}>{[0, 1, 2, 3, 4].map(s => <Icon key={s} n="star" size={14} fill={s < 5 - i ? 'var(--accent)' : 'none'} color={s < 5 - i ? 'var(--accent)' : 'var(--border)'} sw={s < 5 - i ? 0 : 1.6} />)}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Pill tone="neutral">Завершено</Pill>
                <WBtn variant="soft" size="sm" icon="calendar" onClick={() => onOpen(r)}>Повторить</WBtn>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- profile ----
function WProfile() {
  const rows = [['user', 'Личные данные', 'Имя, телефон, e-mail'], ['bell', 'Уведомления', 'Push, SMS, напоминания о брони'], ['card', 'Способы оплаты', 'Привязанные карты'], ['help', 'Помощь и поддержка', 'FAQ, чат с поддержкой']];
  return (
    <div style={{ padding: 32, maxWidth: 920 }}>
      <WSectionHead title="Профиль" sub="Личные данные и настройки аккаунта" />
      <div style={{ display: 'flex', gap: 24, marginTop: 22, alignItems: 'flex-start' }}>
        <div style={{ ...card, width: 300, flexShrink: 0, padding: 24, textAlign: 'center' }}>
          <div style={{ width: 90, height: 90, borderRadius: 26, margin: '0 auto', background: 'linear-gradient(135deg,var(--accent),var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 34 }}>АС</div>
          <p style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 16 }}>Алия Серикова</p>
          <p style={{ fontSize: 13, color: m, marginTop: 4 }}>+7 701 234 56 78</p>
          <WBtn variant="outline" size="sm" icon="edit" style={{ marginTop: 16, width: '100%' }}>Редактировать</WBtn>
          <div style={{ display: 'flex', marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            {[['12', 'броней'], ['8', 'любимых'], ['5', 'отзывов']].map(([v, l], i) => (
              <div key={i} style={{ flex: 1 }}><p style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--primary)' }}>{v}</p><p style={{ fontSize: 11, color: m, marginTop: 2 }}>{l}</p></div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...card, overflow: 'hidden' }}>
            {rows.map(([ic, a, b], i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '17px 20px', borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}><Icon n={ic} size={20} /></div>
                <div style={{ flex: 1 }}><p style={{ fontSize: 14.5, fontWeight: 800 }}>{a}</p><p style={{ fontSize: 12, color: m, marginTop: 2 }}>{b}</p></div>
                <Icon n="chevR" size={19} color="var(--subtle-foreground)" />
              </div>
            ))}
          </div>
          <button style={{ marginTop: 16, height: 50, width: '100%', borderRadius: 'var(--ui-radius,14px)', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--primary)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, cursor: 'pointer' }}><Icon n="logout" size={19} />Выйти из аккаунта</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- confirm ----
function ConfirmModal({ onClose }) {
  const r = RESTOS[0];
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(28,22,16,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 440, padding: 0, boxShadow: 'var(--shadow-soft)', overflow: 'hidden' }}>
        <div style={{ padding: '34px 32px 0', textAlign: 'center' }}>
          <div style={{ width: 76, height: 76, borderRadius: 999, margin: '0 auto', background: 'var(--ramp-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)' }}><Icon n="check" size={40} sw={2.6} /></div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.035em', marginTop: 18 }}>Столик забронирован</h2>
          <p style={{ fontSize: 13.5, color: m, marginTop: 8, lineHeight: 1.45 }}>Подтверждение отправлено по SMS.<br />Ждём вас в назначенное время.</p>
        </div>
        <div style={{ padding: '22px 32px', margin: '24px 0 0' }}>
          <div style={{ background: 'var(--background)', borderRadius: 16, padding: '6px 18px' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: '1px dashed var(--border)' }}>
              <Thumb tone={r.tone} radius={12} style={{ width: 46, height: 46 }} />
              <div><p style={{ fontFamily: 'var(--font-heading)', fontSize: 15, fontWeight: 800 }}>{r.name}</p><p style={{ fontSize: 11.5, color: m, marginTop: 2 }}>{r.cuisine}</p></div>
            </div>
            {[['Дата и время', 'Сегодня · 19:00'], ['Гости', '2 гостя'], ['Код брони', 'BR-4820']].map(([a, b], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 13, color: m }}>{a}</span><span style={{ fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 800 }}>{b}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <WBtn variant="outline" icon="calendar" style={{ flex: 1 }}>В календарь</WBtn>
            <WBtn style={{ flex: 1 }} onClick={onClose}>Готово</WBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- root -------
function DesktopApp() {
  const [page, setPage] = useState('home');
  const [confirm, setConfirm] = useState(false);
  const scrollRef = React.useRef(null);
  const go = (p) => { setPage(p); if (scrollRef.current) scrollRef.current.scrollTop = 0; };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative', background: 'var(--background)', fontFamily: 'var(--font-sans)', color: 'var(--foreground)' }}>
      <Sidebar page={page} onNav={go} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {(page === 'home' || page === 'fav') && <WListing onOpen={() => go('venue')} />}
          {page === 'venue' && <WVenue onBook={() => setConfirm(true)} onBack={() => go('home')} />}
          {page === 'bookings' && <WBookings onOpen={() => go('venue')} />}
          {page === 'profile' && <WProfile />}
        </div>
      </div>
      {confirm && <ConfirmModal onClose={() => { setConfirm(false); go('bookings'); }} />}
    </div>
  );
}

window.DesktopApp = DesktopApp;
