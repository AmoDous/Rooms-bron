/* global React, window */
/* =========================================================================
   Variant A — «Минимализм». Airy, list-led, single-screen booking.
   ========================================================================= */
const { Phone, Body, Kicker, Btn, Pill, Rating, Thumb, TabBar, RoundBtn, Stepper, Chip, SectionHead, Icon, RESTOS, CATEGORIES, DATES } = window;

const muted = 'var(--muted-foreground)';
const cardStyleA = { background: 'var(--card)', borderRadius: 'var(--ui-radius, 18px)', border: '1px solid var(--border)' };

const Dot = () => <span style={{ color: 'var(--subtle-foreground)', margin: '0 5px', fontWeight: 700 }}>·</span>;

// ---------------------------------------------------------------- A1 list --
function A_List() {
  return (
    <Phone>
      <div data-screen-label="A · Листинг" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Body pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '6px 18px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: 11, color: muted, fontWeight: 600 }}>Город</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon n="pin" size={16} color="var(--primary)" />
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: 17, fontWeight: 800, letterSpacing: '-0.03em' }}>Алматы</span>
                  <Icon n="chevD" size={15} sw={2.4} />
                </div>
              </div>
              <RoundBtn n="bell" onLight size={40} />
            </div>

            <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 25, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05, marginTop: 12 }}>
              Найди столик <span style={{ color: 'var(--primary)' }}>на вечер</span>
            </h1>

            <div style={{ display: 'flex', gap: 9, marginTop: 13 }}>
              <div style={{ flex: 1, height: 46, borderRadius: 'var(--ui-radius, 14px)', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px' }}>
                <Icon n="search" size={18} color={muted} />
                <span style={{ fontSize: 13.5, color: muted }}>Заведение или кухня</span>
              </div>
              <button style={{ width: 46, height: 46, borderRadius: 'var(--ui-radius, 14px)', background: 'var(--secondary)', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon n="filter" size={19} /></button>
            </div>

            <div style={{ display: 'flex', gap: 7, marginTop: 14, overflow: 'hidden' }}>
              {CATEGORIES.slice(0, 4).map((c, i) => (
                <Chip key={i} active={i === 0}><Icon n={c.n} size={13} fill={i === 0 ? 'currentColor' : 'none'} sw={2} />{c.label}</Chip>
              ))}
            </div>
          </div>

          <div style={{ padding: '12px 18px 0', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <SectionHead title="Доступно сегодня" />
            <span style={{ fontSize: 11.5, color: muted, fontWeight: 600 }}>24 места</span>
          </div>

          <div style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 'var(--ui-gap, 10px)', overflow: 'hidden' }}>
            {RESTOS.slice(0, 3).map((r, i) => (
              <div key={i} style={{ ...cardStyleA, padding: 10, display: 'flex', gap: 11, alignItems: 'center' }}>
                <Thumb tone={r.tone} radius={13} style={{ width: 56, height: 56 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14.5, fontWeight: 800, letterSpacing: '-0.02em' }}>{r.name}</span>
                    <Rating value={r.rating} size={11} />
                  </div>
                  <p style={{ fontSize: 11, color: muted, marginTop: 2 }}>{r.cuisine}<Dot />{r.dist}</p>
                  <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
                    {r.slots.slice(0, 2).map((s, j) => (
                      <span key={j} style={{ fontFamily: 'var(--font-heading)', fontSize: 11, fontWeight: 700, color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 9%, transparent)', borderRadius: 7, padding: '3px 8px' }}>{s}</span>
                    ))}
                    <span style={{ fontSize: 11, color: muted, alignSelf: 'center', fontWeight: 600 }}>+{r.slots.length - 1}</span>
                  </div>
                </div>
                <Icon n="chevR" size={18} color="var(--subtle-foreground)" />
              </div>
            ))}
          </div>
        </Body>
        <TabBar active={0} variant="line" />
      </div>
    </Phone>
  );
}

// ----------------------------------------------------------- A2 venue ----
function A_Venue() {
  const r = RESTOS[0];
  return (
    <Phone>
      <div data-screen-label="A · Карточка" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Thumb tone={r.tone} radius={0} style={{ height: 158, marginTop: -30 }}>
            <div style={{ position: 'absolute', top: 38, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
              <RoundBtn n="chevL" />
              <div style={{ display: 'flex', gap: 8 }}><RoundBtn n="heart" /><RoundBtn n="share" /></div>
            </div>
          </Thumb>

          <div style={{ flex: 1, padding: '18px 18px 0', marginTop: -22, background: 'var(--background)', borderRadius: '24px 24px 0 0', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.035em' }}>{r.name}</h1>
                <p style={{ fontSize: 12, color: muted, marginTop: 4 }}>{r.cuisine}<Dot />{r.price}</p>
              </div>
              <div style={{ textAlign: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Icon n="star" size={14} fill="var(--accent)" color="var(--accent)" sw={0} /><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15 }}>{r.rating}</span></div>
                <p style={{ fontSize: 9.5, color: muted, marginTop: 1 }}>{r.reviews} отзывов</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 13 }}>
              {[['pin', 'ул. Панфилова 98', '1.2 км от вас'], ['clock', 'Открыто до 23:00', 'Кухня до 22:30'], ['users', 'Столы на 2–8 гостей', 'Веранда · зал']].map(([ic, a, b], i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}><Icon n={ic} size={18} /></div>
                  <div><p style={{ fontSize: 13, fontWeight: 700 }}>{a}</p><p style={{ fontSize: 11, color: muted, marginTop: 1 }}>{b}</p></div>
                </div>
              ))}
            </div>

            <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--foreground)', marginTop: 11 }}>
              Современная казахская кухня в уютном зале с верандой. Авторские блюда из локальных продуктов и сезонное меню.
            </p>
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '12px 18px 26px', background: 'var(--card)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div><p style={{ fontSize: 10.5, color: muted }}>Ближайший стол</p><p style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>сегодня 18:30</p></div>
          <Btn icon="calendar" style={{ flex: 1, maxWidth: 178 }}>Забронировать</Btn>
        </div>
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- A3 booking ----
function A_Book() {
  const r = RESTOS[0];
  const times = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'];
  return (
    <Phone>
      <div data-screen-label="A · Бронирование" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '6px 18px 12px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <RoundBtn n="chevL" onLight size={38} />
          <div><p style={{ fontSize: 10.5, color: muted }}>Бронирование</p><p style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>{r.name}</p></div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', padding: '0 18px' }}>
          <p style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 800, letterSpacing: '-0.01em' }}>Гости</p>
          <div style={{ ...cardStyleA, padding: '13px 16px', marginTop: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Icon n="users" size={19} color="var(--primary)" /><span style={{ fontSize: 13, fontWeight: 700 }}>2 гостя</span></div>
            <Stepper value={2} />
          </div>

          <p style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 800, marginTop: 18 }}>Дата</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 9, overflow: 'hidden' }}>
            {DATES.slice(0, 5).map((d, i) => (
              <Chip key={i} sub active={i === 0}><span style={{ fontSize: 10, fontWeight: 700, opacity: 0.8 }}>{d.d}</span><span style={{ fontSize: 16, fontWeight: 800 }}>{d.n}</span></Chip>
            ))}
          </div>

          <p style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 800, marginTop: 18 }}>Время</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 9 }}>
            {times.map((t, i) => (
              <Chip key={i} active={t === '19:00'} disabled={t === '18:00' || t === '21:30'} style={{ height: 38, padding: 0 }}>{t}</Chip>
            ))}
          </div>

          <p style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 800, marginTop: 18 }}>Пожелания</p>
          <div style={{ ...cardStyleA, padding: '12px 14px', marginTop: 9, fontSize: 12.5, color: muted }}>Например: столик у окна, детский стул…</div>
        </div>

        <div style={{ flexShrink: 0, padding: '12px 18px 26px', background: 'var(--card)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div><p style={{ fontSize: 10.5, color: muted }}>Ваша бронь</p><p style={{ fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 800 }}>2 гостя · Сегодня 19:00</p></div>
          <Btn style={{ flex: 1, maxWidth: 150 }}>Забронировать</Btn>
        </div>
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- A4 confirm ----
function A_Confirm() {
  const r = RESTOS[0];
  return (
    <Phone>
      <div data-screen-label="A · Подтверждение" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', padding: '26px 22px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 78, height: 78, borderRadius: 999, background: 'var(--ramp-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)' }}>
            <Icon n="check" size={40} sw={2.6} />
          </div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 25, fontWeight: 800, letterSpacing: '-0.035em', marginTop: 20 }}>Столик ваш</h1>
          <p style={{ fontSize: 13, color: muted, marginTop: 8, lineHeight: 1.45, maxWidth: 230 }}>Подтверждение отправлено по SMS. Ждём вас в назначенное время.</p>

          <div style={{ ...cardStyleA, width: '100%', marginTop: 20, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 14, borderBottom: '1px dashed var(--border)' }}>
              <Thumb tone={r.tone} radius={12} style={{ width: 48, height: 48 }} />
              <div style={{ textAlign: 'left' }}><p style={{ fontFamily: 'var(--font-heading)', fontSize: 15, fontWeight: 800 }}>{r.name}</p><p style={{ fontSize: 11, color: muted, marginTop: 2 }}>{r.cuisine}</p></div>
            </div>
            <div style={{ padding: '6px 14px' }}>
              {[['calendar', 'Дата и время', 'Сегодня · 19:00'], ['users', 'Гости', '2 гостя'], ['ticket', 'Код брони', 'BR-4820']].map(([ic, a, b], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: muted }}><Icon n={ic} size={16} />{a}</span>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13.5, fontWeight: 800 }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '14px 18px 28px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Btn icon="calendar">Добавить в календарь</Btn>
          <Btn variant="ghost">Мои брони</Btn>
        </div>
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- A5 history ----
function A_History() {
  return (
    <Phone>
      <div data-screen-label="A · История" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Body pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '6px 18px 0' }}>
            <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.035em' }}>Мои брони</h1>
            <div style={{ display: 'flex', gap: 6, marginTop: 14, background: 'var(--muted)', borderRadius: 12, padding: 4 }}>
              {['Предстоящие', 'Прошедшие'].map((t, i) => (
                <div key={i} style={{ flex: 1, textAlign: 'center', height: 34, lineHeight: '34px', borderRadius: 9, fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 700, background: i === 0 ? 'var(--card)' : 'transparent', color: i === 0 ? 'var(--foreground)' : muted, boxShadow: i === 0 ? 'var(--shadow-card)' : 'none' }}>{t}</div>
              ))}
            </div>
          </div>

          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
            {/* upcoming highlighted */}
            <div style={{ ...cardStyleA, borderColor: 'color-mix(in srgb, var(--primary) 35%, var(--border))', overflow: 'hidden' }}>
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                    <Thumb tone={RESTOS[0].tone} radius={12} style={{ width: 46, height: 46 }} />
                    <div><p style={{ fontFamily: 'var(--font-heading)', fontSize: 15, fontWeight: 800 }}>{RESTOS[0].name}</p><p style={{ fontSize: 11, color: muted, marginTop: 2 }}>{RESTOS[0].cuisine}</p></div>
                  </div>
                  <Pill tone="success" icon="check">Подтверждено</Pill>
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 14 }}>
                  {[['calendar', 'Сегодня 19:00'], ['users', '2 гостя']].map(([ic, v], i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}><Icon n={ic} size={15} color="var(--primary)" />{v}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
                <button style={{ flex: 1, height: 42, border: 'none', background: 'transparent', fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)', borderRight: '1px solid var(--border)', cursor: 'pointer' }}>Изменить</button>
                <button style={{ flex: 1, height: 42, border: 'none', background: 'transparent', fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 700, color: 'var(--primary)', cursor: 'pointer' }}>Отменить</button>
              </div>
            </div>

            {/* past, muted */}
            {[RESTOS[2], RESTOS[4]].map((r, i) => (
              <div key={i} style={{ ...cardStyleA, padding: 13, display: 'flex', gap: 11, alignItems: 'center', opacity: 0.92 }}>
                <Thumb tone={r.tone} radius={11} style={{ width: 44, height: 44, filter: 'saturate(0.8)' }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: 'var(--font-heading)', fontSize: 14, fontWeight: 800 }}>{r.name}</p>
                  <p style={{ fontSize: 11, color: muted, marginTop: 2 }}>{i === 0 ? '28 мая · 20:00' : '14 мая · 13:00'}<Dot />Завершено</p>
                </div>
                <Btn variant="outline" size="sm">Повторить</Btn>
              </div>
            ))}
          </div>
        </Body>
        <TabBar active={2} variant="line" />
      </div>
    </Phone>
  );
}

// --------------------------------------------------------- A6 profile ----
function A_Profile() {
  const rows1 = [['user', 'Личные данные'], ['bell', 'Уведомления'], ['card', 'Способы оплаты']];
  const rows2 = [['heart', 'Избранные места'], ['help', 'Помощь и поддержка']];
  const Row = ([ic, label], last) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 14px', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}><Icon n={ic} size={17} /></div>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{label}</span>
      <Icon n="chevR" size={17} color="var(--subtle-foreground)" />
    </div>
  );
  return (
    <Phone>
      <div data-screen-label="A · Профиль" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Body pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '8px 18px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 64, height: 64, borderRadius: 999, background: 'linear-gradient(135deg,var(--accent),var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24 }}>АС</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: 'var(--font-heading)', fontSize: 19, fontWeight: 800, letterSpacing: '-0.03em' }}>Алия Серикова</p>
              <p style={{ fontSize: 12, color: muted, marginTop: 2 }}>+7 701 234 56 78</p>
            </div>
            <RoundBtn n="edit" onLight size={38} iconSize={16} />
          </div>

          <div style={{ padding: '14px 18px 0', display: 'flex', gap: 10 }}>
            {[['12', 'броней'], ['8', 'любимых'], ['5', 'отзывов']].map(([v, l], i) => (
              <div key={i} style={{ ...cardStyleA, flex: 1, padding: '11px 8px', textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--font-heading)', fontSize: 21, fontWeight: 800, letterSpacing: '-0.04em' }}>{v}</p>
                <p style={{ fontSize: 10.5, color: muted, marginTop: 2 }}>{l}</p>
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 18px 0' }}>
            <div style={{ ...cardStyleA, overflow: 'hidden' }}>{rows1.map((r, i) => Row(r, i === rows1.length - 1))}</div>
            <div style={{ ...cardStyleA, overflow: 'hidden', marginTop: 10 }}>{rows2.map((r, i) => Row(r, i === rows2.length - 1))}</div>
            <button style={{ width: '100%', marginTop: 9, height: 44, borderRadius: 'var(--ui-radius, 14px)', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--primary)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}><Icon n="logout" size={17} />Выйти</button>
          </div>
        </Body>
        <TabBar active={3} variant="line" />
      </div>
    </Phone>
  );
}

window.VariantA = { A_List, A_Venue, A_Book, A_Confirm, A_History, A_Profile };
