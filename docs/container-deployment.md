# Контейнерное развёртывание Rooms

Этот комплект собирает одинаковый образ API на компьютере, тестовом сервере и production. Секреты в образ и Git не копируются. PostgreSQL и S3 предполагаются отдельными управляемыми сервисами; это снижает риск потери базы вместе с одним сервером приложения.

## Первый запуск

1. Скопировать `server/.env.production.example` в приватный `server/.env.production` и заполнить настройки. Файл уже исключён из Git.
2. До запуска проверить настройки командой `npm run check:deployment` либо внутри tools-образа.
3. Собрать API и служебный образ:

```powershell
docker compose -f compose.production.yml --profile tools build
```

4. Перед первой миграцией создать резервную копию существующей базы, если она уже содержит данные. Затем применить миграции:

```powershell
docker compose -f compose.production.yml --profile tools run --rm migrate
```

5. Запустить API:

```powershell
docker compose -f compose.production.yml up -d api
docker compose -f compose.production.yml ps
```

Порт доступен только на `127.0.0.1`. Перед ним нужен HTTPS-прокси с публичным доменом. Не публиковать порт `3001` напрямую в интернет.

## Проверка и обновление

`GET /health` показывает общую информацию без секретов. `GET /ready` проверяет живую связь с PostgreSQL и обязательные production-хранилища; при проблеме возвращает `503`, поэтому контейнер и балансировщик перестают направлять ему новые запросы.

Порядок обновления:

```powershell
docker compose -f compose.production.yml --profile tools build
docker compose -f compose.production.yml --profile tools run --rm backup
docker compose -f compose.production.yml --profile tools run --rm migrate
docker compose -f compose.production.yml up -d api
```

После обновления проверить `/ready`, вход с 2FA, поиск, тестовую заявку и журнал уведомлений. Старый образ не удалять до завершения проверки.

## Ограничения

- Compose-файл не создаёт PostgreSQL и S3 внутри одного сервера: для пилота нужны отдельные постоянные хранилища.
- Рабочие платежи нельзя включать до подключения Сбера и онлайн-кассы.
- Каталог `server-data/backups` должен находиться на зашифрованном диске и копироваться во второе независимое хранилище.
- Расписание резервных копий и внешний мониторинг настраиваются средствами выбранной площадки размещения.
