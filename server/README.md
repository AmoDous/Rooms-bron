# Rooms API

Первый работающий серверный модуль Rooms. Он отделён от статического сайта, чтобы GitHub Pages продолжал работать во время поэтапного переноса сценариев на backend.

## Что реализовано

- `GET /health` — состояние процесса и активного хранилища;
- `GET /v1/cities` — поддерживаемые города;
- `GET /v1/rooms` — каталог с фильтрами по городу, гостям, типу, возможностям и цене;
- `GET /v1/rooms/{roomId}` — карточка по UUID или старому slug;
- `POST /v1/availability/search` — общие свободные окна одного или нескольких помещений;
- единый формат ошибок с `requestId`;
- CORS только для локального запуска и GitHub Pages Rooms;
- автоматические API-тесты через `fastify.inject`.

## Запуск

Требуется Node.js 24 LTS или новее.

```powershell
npm install
npm run dev
```

API откроется на `http://127.0.0.1:3000`.

```powershell
npm test
npm run typecheck
npm run build
npm start
```

Для локальных настроек можно создать `.env` по образцу `.env.example`. Файл `.env` исключён из Git.

## Примеры

```text
GET http://127.0.0.1:3000/v1/rooms?city=Воронеж&guests=8&type=kids
GET http://127.0.0.1:3000/v1/rooms/kosmos?date=2026-07-18
```

```json
POST /v1/availability/search
{
  "roomIds": [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002"
  ],
  "date": "2026-07-18",
  "durationMinutes": 120,
  "preferredTime": "20:00",
  "guests": 8
}
```

## Граница текущего этапа

Сейчас `MemoryCatalogRepository` возвращает типизированные демо-данные. Интерфейс `CatalogRepository` уже отделяет HTTP-маршруты от хранения, поэтому следующим шагом можно подключить PostgreSQL без изменения публичного API.

Сервер пока не обрабатывает регистрацию, бронирования и платежи. Эти маршруты зафиксированы в `../docs/openapi.yaml`, но будут реализовываться после подключения PostgreSQL.
