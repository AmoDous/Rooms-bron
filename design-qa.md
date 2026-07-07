# Rooms Design QA

Дата: 06.07.2026

## Проверенная цель

Перенести направление "Airbnb для помещений" в текущий сайт Rooms:

- первый экран с живыми фото и легким поиском;
- карточки каталога в формате площадка -> комнаты внутри;
- карточка помещения с крупной галереей и расчетом;
- модалки входа, регистрации, брони и партнера.

## Проверенные состояния

- Desktop first screen: `rooms-preview/01-home-desktop.png`
- Desktop catalog: `rooms-preview/02-catalog-desktop.png`
- Desktop room detail: `rooms-preview/03-room-detail-desktop.png`
- Desktop booking modal: `rooms-preview/04-booking-modal-desktop.png`
- Desktop login/register modal: `rooms-preview/05-login-register-desktop.png`
- Mobile first screen: `rooms-preview/06-home-mobile.png`
- Mobile catalog: `rooms-preview/07-catalog-mobile.png`
- Mobile room detail: `rooms-preview/08-room-detail-mobile.png`

## Проверки

- Desktop: страница открылась без `pageerror` и console errors.
- Mobile: страница открылась без `pageerror` и console errors.
- Локальные изображения в `assets/` загрузились, битых картинок нет.
- На старте показываются 3 площадки в Воронеже, дефолтное время `12:00`.
- Выбор Москвы через кнопку города работает и переводит hero в демо-режим.
- Сценарий "Караоке" показывает площадку по формату в выбранном городе.
- Карточка площадки открывает карточку помещения.
- Из карточки помещения открывается форма брони.
- Вход открывает личный кабинет, регистрация переключается в той же модалке.
- Вход для партнеров открывает отдельную модалку кабинета площадки.
- В `index.html` не найдены старые публичные тексты про `30%`, комиссию, публичную админку и "найдите комнату".

## Результат

Final result: passed
