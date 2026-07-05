/* global React, window */
/* =========================================================================
   Variant B — «Насыщенный». Photo-forward, hero cards, stepped booking wizard.
   ========================================================================= */
const VB = window;
const { Phone, Body, Btn, Pill, Rating, Thumb, TabBar, RoundBtn, Stepper, Chip, SectionHead, Icon, RESTOS, CATEGORIES, DATES } = VB;

const mutedB = 'var(--muted-foreground)';
const cardB = { background: 'var(--card)', borderRadius: 'var(--ui-radius, 22px)', boxShadow: 'var(--shadow-card)' };
const DotB = () => <span style={{ color: 'var(--subtle-foreground)', margin: '0 5px', fontWeight: 700 }}>·</span>;

// photo with dark gradient + content overlay
const PhotoOverlay = ({ children }) => (
  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(28,22,16,0.72) 0%, rgba(28,22,16,0.12) 48%, transparent 75%)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>{children}</div>
);

// ---------------------------------------------------------------- B1 list --
function B_List() {
  return (
    <Phone bg="var(--background)">
      <div data-screen-label="B · Листинг" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 18px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 12.5, color: mutedB }}>Привет, Алия 👋</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Icon n="pin" size={15} color="var(--primary)" />
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Алматы, центр</span>
                <Icon n="chevD" size={14} sw={2.4} />
              </div>
            </div>
            <div style={{ width: 42, height: 42, borderRadius: 999, background: 'linear-gradient(135deg,var(--accent),var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15 }}>АС</div>
          </div>

          <div style={{ padding: '10px 18px 0' }}>
            <div style={{ height: 46, borderRadius: 999, background: 'var(--card)', boxShadow: 'var(--shadow-card)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 16px' }}>
              <Icon n="search" size={18} color={mutedB} />
              <span style={{ flex: 1, fontSize: 13.5, color: mutedB }}>Поиск ресторана</span>
              <button style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--primary)', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="filter" size={16} /></button>
            </div>
          </div>

          {/* featured hero */}
          <div style={{ padding: '12px 18px 0' }}>
            <Thumb tone={RESTOS[1].tone} radius="var(--ui-radius, 24px)" style={{ height: 128 }}>
              <div style={{ position: 'absolute', top: 12, left: 12 }}><Pill tone="invert" icon="fire" style={{ background: 'rgba(28,22,16,0.5)', backdropFilter: 'blur(4px)' }}>Выбор недели</Pill></div>
              <div style={{ position: 'absolute', top: 12, right: 12 }}><RoundBtn n="heart" size={32} iconSize={15} /></div>
              <PhotoOverlay>
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 21, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em' }}>{RESTOS[1].name}</h2>
                    <Pill tone="invert" icon="star" style={{ background: 'rgba(255,255,255,0.22)' }}>{RESTOS[1].rating}</Pill>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>{RESTOS[1].cuisine}<DotB />{RESTOS[1].dist}</span>
                    <Btn size="sm" style={{ background: '#fff', color: 'var(--foreground)', boxShadow: 'none' }}>19:00 · Бронь</Btn>
                  </div>
                </div>
              </PhotoOverlay>
            </Thumb>
          </div>

          {/* categories */}
          <div style={{ padding: '10px 0 0 18px', display: 'flex', gap: 16, overflow: 'hidden' }}>
            {CATEGORIES.map((c, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: i === 0 ? 'var(--primary)' : 'var(--card)', boxShadow: 'var(--shadow-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: i === 0 ? '#fff' : 'var(--primary)' }}><Icon n={c.n} size={20} /></div>
                <span style={{ fontSize: 10, fontWeight: 700, color: i === 0 ? 'var(--foreground)' : mutedB, maxWidth: 56, textAlign: 'center', lineHeight: 1.1 }}>{c.label}</span>
              </div>
            ))}
          </div>

          {/* popular nearby */}
          <div style={{ padding: '10px 18px 5px' }}><SectionHead title="Популярно рядом" action="всё" /></div>
          <div style={{ padding: '0 0 0 18px', display: 'flex', gap: 13, overflow: 'hidden' }}>
            {[RESTOS[0], RESTOS[3], RESTOS[5]].map((r, i) => (
              <div key={i} style={{ ...cardB, width: 158, flexShrink: 0, overflow: 'hidden' }}>
                <Thumb tone={r.tone} radius={0} style={{ height: 76 }}>
                  <div style={{ position: 'absolute', top: 8, right: 8 }}><Pill tone="invert" icon="star" style={{ background: 'rgba(28,22,16,0.5)' }}>{r.rating}</Pill></div>
                </Thumb>
                <div style={{ padding: '8px 11px 9px' }}>
                  <p style={{ fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.02em' }}>{r.name}</p>
                  <p style={{ fontSize: 10.5, color: mutedB, marginTop: 2 }}>{r.cuisine}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, color: 'var(--primary)' }}><Icon n="clock" size={13} /><span style={{ fontSize: 11, fontWeight: 700 }}>от {r.slots[0]}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <TabBar active={0} variant="pill" />
      </div>
    </Phone>
  );
}

// ----------------------------------------------------------- B2 venue ----
function B_Venue() {
  const r = RESTOS[1];
  return (
    <Phone>
      <div data-screen-label="B · Карточка" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Thumb tone={r.tone} radius={0} style={{ height: 188, marginTop: -30 }}>
            <div style={{ position: 'absolute', top: 38, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
              <RoundBtn n="chevL" />
              <div style={{ display: 'flex', gap: 8 }}><RoundBtn n="heart" /><RoundBtn n="share" /></div>
            </div>
            <div style={{ position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
              {[0, 1, 2, 3].map(i => <span key={i} style={{ width: i === 0 ? 18 : 6, height: 6, borderRadius: 99, background: i === 0 ? '#fff' : 'rgba(255,255,255,0.55)' }} />)}
            </div>
          </Thumb>

          <div style={{ flex: 1, overflow: 'hidden', marginTop: -26, background: 'var(--background)', borderRadius: '26px 26px 0 0', padding: '15px 18px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Pill tone="warn" icon="fire">Выбор недели</Pill>
              <Pill tone="neutral">{r.price}</Pill>
            </div>
            <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.035em', marginTop: 8 }}>{r.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Rating value={r.rating} size={13} />
              <span style={{ fontSize: 12, color: mutedB }}>({r.reviews})<DotB />{r.cuisine}</span>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 13 }}>
              {[['clock', 'до 23:00'], ['pin', r.dist], ['users', '2–8 гостей']].map(([ic, v], i) => (
                <div key={i} style={{ ...cardB, flex: 1, padding: '10px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <Icon n={ic} size={18} color="var(--primary)" /><span style={{ fontSize: 11, fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 9, marginTop: 14, overflow: 'hidden' }}>
              {['plum', 'orange', 'brown', 'red'].map((t, i) => <Thumb key={i} tone={t} radius={13} style={{ width: 78, height: 56, flexShrink: 0 }} />)}
            </div>

            <div style={{ ...cardB, marginTop: 14, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--ramp-orange-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 13, color: 'var(--primary)' }}>Д</div>
                <div style={{ flex: 1 }}><p style={{ fontSize: 12.5, fontWeight: 800 }}>Дамир К.</p><div style={{ display: 'flex', gap: 1, marginTop: 2 }}>{[0, 1, 2, 3, 4].map(i => <Icon key={i} n="star" size={11} fill="var(--accent)" color="var(--accent)" sw={0} />)}</div></div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--foreground)', lineHeight: 1.4, marginTop: 8 }}>«Лучшая веранда в городе, бронь сработала идеально.»</p>
            </div>
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '12px 18px 26px', background: 'var(--card)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div><p style={{ fontSize: 10.5, color: mutedB }}>Сегодня свободно</p><p style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>20:00 · 20:30</p></div>
          <Btn icon="calendar" style={{ flex: 1, maxWidth: 168 }}>Забронировать</Btn>
        </div>
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- B3 booking ----
function B_Book() {
  const r = RESTOS[1];
  const steps = ['Гости', 'Дата', 'Время'];
  const cal = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const days = Array.from({ length: 30 }, (_, i) => i + 1);
  const times = [['18:30', 'много'], ['19:00', 'мало'], ['19:30', 'много'], ['20:00', 'мало'], ['20:30', 'много'], ['21:00', 'нет']];
  return (
    <Phone>
      <div data-screen-label="B · Бронирование" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '6px 18px 0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <RoundBtn n="chevL" onLight size={38} />
          <p style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>{r.name}</p>
        </div>

        {/* numbered stepper */}
        <div style={{ padding: '16px 18px 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {steps.map((s, i) => {
            const done = i === 0, active = i === 1;
            return (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 999, background: done || active ? 'var(--primary)' : 'var(--muted)', color: done || active ? '#fff' : mutedB, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 13 }}>{done ? <Icon n="check" size={15} sw={2.6} /> : i + 1}</div>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: active ? 'var(--foreground)' : mutedB }}>{s}</span>
                </div>
                {i < 2 && <div style={{ flex: 1, height: 2, background: i === 0 ? 'var(--primary)' : 'var(--border)', margin: '0 6px', marginBottom: 16 }} />}
              </React.Fragment>
            );
          })}
        </div>

        <div style={{ flex: 1, overflow: 'hidden', padding: '18px 18px 0' }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 19, fontWeight: 800, letterSpacing: '-0.03em' }}>Выберите дату</h2>
          {/* calendar */}
          <div style={{ ...cardB, padding: 14, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 800 }}>Июнь 2026</span>
              <div style={{ display: 'flex', gap: 6 }}><Icon n="chevL" size={16} color={mutedB} /><Icon n="chevR" size={16} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
              {cal.map((d, i) => <span key={'h' + i} style={{ fontSize: 9.5, color: mutedB, fontWeight: 700, paddingBottom: 4 }}>{d}</span>)}
              {days.slice(0, 21).map(d => {
                const sel = d === 3;
                const dim = d < 3;
                return <div key={d} style={{ height: 28, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontSize: 12, fontWeight: 700, background: sel ? 'var(--primary)' : 'transparent', color: sel ? '#fff' : dim ? 'var(--subtle-foreground)' : 'var(--foreground)' }}>{d}</div>;
              })}
            </div>
          </div>

          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 18 }}>Время · 2 гостя</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, marginTop: 11 }}>
            {times.map(([t, av], i) => {
              const sel = t === '19:00', none = av === 'нет';
              const avColor = av === 'много' ? 'var(--success)' : av === 'мало' ? 'var(--accent)' : 'var(--subtle-foreground)';
              return (
                <div key={i} style={{ height: 52, borderRadius: 14, border: sel ? '1px solid transparent' : '1px solid var(--border)', background: sel ? 'var(--primary)' : none ? 'transparent' : 'var(--card)', color: sel ? '#fff' : none ? 'var(--subtle-foreground)' : 'var(--foreground)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, opacity: none ? 0.5 : 1 }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: 800 }}>{t}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, color: sel ? 'rgba(255,255,255,0.85)' : avColor }}>
                    {!none && <span style={{ width: 5, height: 5, borderRadius: 99, background: sel ? '#fff' : avColor }} />}{av}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '12px 18px 26px', background: 'var(--card)', borderTop: '1px solid var(--border)' }}>
          <Btn icon="arrowR" style={{ width: '100%' }}>Далее · подтверждение</Btn>
        </div>
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- B4 confirm ----
function B_Confirm() {
  const r = RESTOS[1];
  return (
    <Phone>
      <div data-screen-label="B · Подтверждение" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -50, width: 180, height: 180, borderRadius: 999, background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }} />
        <div style={{ position: 'absolute', top: 60, left: -60, width: 150, height: 150, borderRadius: 999, background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }} />

        <div style={{ flex: 1, overflow: 'hidden', padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{ width: 72, height: 72, borderRadius: 999, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 10px 26px color-mix(in srgb, var(--primary) 38%, transparent)' }}><Icon n="check" size={38} sw={2.8} /></div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.035em', marginTop: 16 }}>Бронь подтверждена</h1>
          <p style={{ fontSize: 12.5, color: mutedB, marginTop: 6 }}>Покажите код на входе</p>

          {/* ticket card */}
          <div style={{ ...cardB, width: '100%', marginTop: 20, overflow: 'hidden', textAlign: 'left' }}>
            <Thumb tone={r.tone} radius={0} style={{ height: 86 }}>
              <PhotoOverlay><div style={{ padding: 12 }}><h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 800, color: '#fff' }}>{r.name}</h2><span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>{r.cuisine}</span></div></PhotoOverlay>
            </Thumb>
            <div style={{ position: 'relative', padding: '14px 16px' }}>
              <div style={{ position: 'absolute', top: -8, left: -8, width: 16, height: 16, borderRadius: 999, background: 'var(--background)' }} />
              <div style={{ position: 'absolute', top: -8, right: -8, width: 16, height: 16, borderRadius: 999, background: 'var(--background)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                {[['Дата', 'Сегодня'], ['Время', '19:00'], ['Гости', '2']].map(([a, b], i) => (
                  <div key={i}><p style={{ fontSize: 10, color: mutedB }}>{a}</p><p style={{ fontFamily: 'var(--font-heading)', fontSize: 14.5, fontWeight: 800, marginTop: 2 }}>{b}</p></div>
                ))}
              </div>
              <div style={{ borderTop: '1px dashed var(--border)', margin: '14px 0', position: 'relative' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* faux barcode */}
                <div style={{ flex: 1, height: 44, display: 'flex', gap: 2, alignItems: 'stretch', overflow: 'hidden' }}>
                  {Array.from({ length: 34 }).map((_, i) => <span key={i} style={{ flex: (i * 7 % 3) + 1, background: i % 4 === 0 ? 'transparent' : 'var(--foreground)', borderRadius: 1 }} />)}
                </div>
                <div style={{ textAlign: 'right' }}><p style={{ fontSize: 10, color: mutedB }}>Код</p><p style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14 }}>BR-4820</p></div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '14px 18px 28px', display: 'flex', flexDirection: 'column', gap: 9, position: 'relative', zIndex: 1 }}>
          <Btn icon="calendar">Добавить в календарь</Btn>
          <Btn variant="ghost">К моим броням</Btn>
        </div>
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- B5 history ----
function B_History() {
  return (
    <Phone>
      <div data-screen-label="B · История" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 18px 0' }}>
            <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.035em' }}>Мои брони</h1>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              {['Предстоящие', 'Прошедшие'].map((t, i) => (
                <div key={i} style={{ height: 32, padding: '0 16px', lineHeight: '32px', borderRadius: 999, fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 700, background: i === 0 ? 'var(--primary)' : 'var(--card)', color: i === 0 ? '#fff' : mutedB, boxShadow: 'var(--shadow-card)' }}>{t}</div>
              ))}
            </div>
          </div>

          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11, overflow: 'hidden' }}>
            {/* upcoming with photo */}
            <div style={{ ...cardB, overflow: 'hidden' }}>
              <Thumb tone={RESTOS[1].tone} radius={0} style={{ height: 84 }}>
                <div style={{ position: 'absolute', top: 10, left: 10 }}><Pill tone="success" icon="check" style={{ background: 'rgba(255,255,255,0.92)' }}>Подтверждено</Pill></div>
                <PhotoOverlay><div style={{ padding: 12 }}><h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 17, fontWeight: 800, color: '#fff' }}>{RESTOS[1].name}</h2></div></PhotoOverlay>
              </Thumb>
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  {[['calendar', 'Сегодня 19:00'], ['users', '2 гостя'], ['ticket', 'BR-4820']].map(([ic, v], i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700 }}><Icon n={ic} size={14} color="var(--primary)" />{v}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
                  <Btn variant="outline" size="sm" style={{ flex: 1 }}>Изменить</Btn>
                  <Btn variant="soft" size="sm" style={{ flex: 1 }}>Маршрут</Btn>
                </div>
              </div>
            </div>

            {/* past */}
            {[RESTOS[0], RESTOS[4]].map((r, i) => (
              <div key={i} style={{ ...cardB, padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <Thumb tone={r.tone} radius={14} style={{ width: 52, height: 52, filter: 'saturate(0.85)' }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: 800 }}>{r.name}</p>
                  <p style={{ fontSize: 11, color: mutedB, marginTop: 2 }}>{i === 0 ? '28 мая · 20:00' : '14 мая · 13:00'}<DotB />Завершено</p>
                  <div style={{ display: 'flex', gap: 1, marginTop: 5 }}>{[0, 1, 2, 3, 4].map(s => <Icon key={s} n="star" size={12} fill={s < 5 - i ? 'var(--accent)' : 'none'} color={s < 5 - i ? 'var(--accent)' : 'var(--border)'} sw={s < 5 - i ? 0 : 1.6} />)}</div>
                </div>
                <Btn variant="soft" size="sm">Повторить</Btn>
              </div>
            ))}
          </div>
        </div>
        <TabBar active={2} variant="pill" />
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- B6 profile ----
function B_Profile() {
  const groups = [
    { label: 'Аккаунт', rows: [['user', 'Личные данные', 'var(--primary)', 'var(--ramp-red-100)'], ['bell', 'Уведомления', 'var(--accent)', 'var(--ramp-orange-200)'], ['card', 'Способы оплаты', 'var(--success)', 'var(--ramp-success-bg)']] },
    { label: 'Ещё', rows: [['heart', 'Избранные места', 'var(--primary)', 'var(--ramp-red-100)'], ['help', 'Помощь', 'var(--info)', 'var(--muted)']] },
  ];
  return (
    <Phone>
      <div data-screen-label="B · Профиль" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* cover */}
          <div style={{ height: 86, marginTop: -30, background: 'linear-gradient(135deg,var(--accent),var(--primary))', position: 'relative' }} />
          <div style={{ padding: '0 18px', marginTop: -38 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 13 }}>
              <div style={{ width: 72, height: 72, borderRadius: 22, background: 'var(--card)', border: '3px solid var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26, boxShadow: 'var(--shadow-card)' }}>АС</div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <p style={{ fontFamily: 'var(--font-heading)', fontSize: 19, fontWeight: 800, letterSpacing: '-0.03em' }}>Алия Серикова</p>
                <Pill tone="warn" icon="sparkle" style={{ marginTop: 4 }}>Постоянный гость</Pill>
              </div>
              <RoundBtn n="edit" onLight size={36} iconSize={15} style={{ marginBottom: 4 }} />
            </div>
          </div>

          <div style={{ padding: '12px 18px 0', display: 'flex', gap: 10 }}>
            {[['12', 'броней'], ['8', 'любимых'], ['5', 'отзывов']].map(([v, l], i) => (
              <div key={i} style={{ ...cardB, flex: 1, padding: '10px 8px', textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--primary)' }}>{v}</p>
                <p style={{ fontSize: 10.5, color: mutedB, marginTop: 2 }}>{l}</p>
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 18px 0', overflow: 'hidden' }}>
            {groups.map((g, gi) => (
              <div key={gi} style={{ marginTop: gi ? 12 : 0 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: mutedB, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7, paddingLeft: 4 }}>{g.label}</p>
                <div style={{ ...cardB, overflow: 'hidden' }}>
                  {g.rows.map(([ic, label, fg, bg], i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '10px 13px', borderBottom: i < g.rows.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: fg }}><Icon n={ic} size={17} /></div>
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{label}</span>
                      <Icon n="chevR" size={17} color="var(--subtle-foreground)" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <TabBar active={3} variant="pill" />
      </div>
    </Phone>
  );
}

window.VariantB = { B_List, B_Venue, B_Book, B_Confirm, B_History, B_Profile };
