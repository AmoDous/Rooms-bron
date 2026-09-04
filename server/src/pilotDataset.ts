import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

export const PILOT_DATASET_SCHEMA_VERSION = 1;

const roomColumns = [
  "venue_code",
  "room_code",
  "city",
  "venue_type",
  "room_type",
  "capacity_min",
  "capacity_max",
  "opens_at",
  "closes_at",
  "start_step_minutes",
  "minimum_duration_minutes",
  "buffer_before_minutes",
  "buffer_after_minutes",
  "price_per_hour_rub",
  "can_combine_with_room_codes",
] as const;

const blockColumns = [
  "block_code",
  "venue_code",
  "room_code",
  "event_date",
  "starts_at",
  "duration_minutes",
  "block_type",
  "recorded_at",
  "released_at",
] as const;

const requestColumns = [
  "request_code",
  "venue_code",
  "room_codes",
  "event_date",
  "preferred_start",
  "duration_minutes",
  "guest_count",
  "request_source",
  "created_at",
  "first_response_at",
  "exact_start_available",
  "offered_start",
  "offered_duration_minutes",
  "alternative_accepted",
  "final_status",
  "decline_reason_category",
  "confirmed_at",
  "selected_start",
  "selected_duration_minutes",
  "actual_visit",
] as const;

const forbiddenHeaderTokens = new Set([
  "address", "card", "client", "contact", "email", "fio", "full_name", "inn",
  "login", "mail", "message", "name", "passport", "payment", "phone", "surname",
  "telegram", "user", "whatsapp",
]);
const codePattern = /^[A-Z0-9][A-Z0-9_-]{0,39}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const phonePattern = /^\+?\d[\d\s().-]{8,}\d$/u;
const urlPattern = /(?:https?:\/\/|t\.me\/|wa\.me\/)/iu;
const formulaPattern = /^[=+\-@]/u;

type CsvRow = Record<string, string>;
type BooleanOrUnknown = boolean | "unknown";

export interface PilotValidationIssue {
  file: "rooms" | "blocks" | "requests";
  row: number;
  column?: string;
  message: string;
}

export class PilotDatasetValidationError extends Error {
  readonly issues: PilotValidationIssue[];

  constructor(issues: PilotValidationIssue[]) {
    super(`Pilot dataset validation failed with ${issues.length} issue(s).`);
    this.name = "PilotDatasetValidationError";
    this.issues = issues;
  }
}

export interface PilotRoom {
  venueCode: string;
  roomCode: string;
  city: string;
  venueType: string;
  roomType: string;
  capacityMin: number;
  capacityMax: number;
  opensAt: string;
  closesAt: string;
  startStepMinutes: 15 | 30 | 60;
  minimumDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  pricePerHourRub: number;
  canCombineWithRoomCodes: string[];
}

export interface PilotRoomBlock {
  blockCode: string;
  venueCode: string;
  roomCode: string;
  eventDate: string;
  startsAt: string;
  durationMinutes: number;
  blockType: "confirmed" | "manual" | "technical" | "hold";
  recordedAt: string;
  releasedAt: string | null;
}

export interface PilotRequest {
  requestCode: string;
  venueCode: string;
  roomCodes: string[];
  eventDate: string;
  preferredStart: string;
  durationMinutes: number;
  guestCount: number;
  requestSource: "phone" | "site" | "messenger" | "social" | "walk_in" | "other";
  createdAt: string;
  firstResponseAt: string | null;
  exactStartAvailable: BooleanOrUnknown;
  offeredStart: string | null;
  offeredDurationMinutes: number | null;
  alternativeAccepted: BooleanOrUnknown;
  finalStatus: "new" | "pending" | "confirmed" | "rejected" | "cancelled" | "completed" | "unknown";
  declineReasonCategory: "busy" | "capacity" | "price" | "rules" | "no_response" | "client_changed" | "other" | null;
  confirmedAt: string | null;
  selectedStart: string | null;
  selectedDurationMinutes: number | null;
  actualVisit: BooleanOrUnknown;
}

export interface PilotDatasetSummary {
  venueCount: number;
  roomCount: number;
  blockCount: number;
  requestCount: number;
  cities: string[];
  eventDateFrom: string | null;
  eventDateTo: string | null;
  requestsWithKnownAvailability: number;
  exactStartAvailableCount: number;
  alternativesOffered: number;
  alternativesAccepted: number;
  medianFirstResponseMinutes: number | null;
  privacyFindings: 0;
}

export interface PilotDataset {
  schemaVersion: number;
  dataSource: "pilot_anonymized";
  datasetHash: string;
  rooms: PilotRoom[];
  blocks: PilotRoomBlock[];
  requests: PilotRequest[];
  summary: PilotDatasetSummary;
}

export interface PilotCsvInput {
  rooms: string;
  blocks: string;
  requests: string;
}

function pushIssue(
  issues: PilotValidationIssue[],
  file: PilotValidationIssue["file"],
  row: number,
  message: string,
  column?: string,
): void {
  issues.push(column === undefined ? { file, row, message } : { file, row, column, message });
}

function headerHasForbiddenToken(header: string): boolean {
  const normalized = header.toLowerCase().replace(/[^a-z0-9_]+/gu, "_");
  return [...forbiddenHeaderTokens].some((token) => normalized === token || normalized.split("_").includes(token));
}

function scanValue(
  value: string,
  file: PilotValidationIssue["file"],
  row: number,
  column: string,
  issues: PilotValidationIssue[],
): void {
  if (!value) return;
  if (emailPattern.test(value)) pushIssue(issues, file, row, "Обнаружено значение, похожее на email.", column);
  if (phonePattern.test(value) && value.replace(/\D/gu, "").length >= 10) {
    pushIssue(issues, file, row, "Обнаружено значение, похожее на телефон.", column);
  }
  if (urlPattern.test(value)) pushIssue(issues, file, row, "Ссылки и контакты мессенджеров запрещены.", column);
  if (formulaPattern.test(value)) pushIssue(issues, file, row, "Значение не должно начинаться со знака формулы таблицы.", column);
}

function parseCsv(
  content: string,
  file: PilotValidationIssue["file"],
  expectedColumns: readonly string[],
  issues: PilotValidationIssue[],
): CsvRow[] {
  let matrix: string[][];
  try {
    matrix = parse(content, {
      bom: true,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch (error) {
    pushIssue(issues, file, 1, `CSV не разобран: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const headers = matrix[0] ?? [];
  if (!headers.length) {
    pushIssue(issues, file, 1, "CSV пуст или не содержит строку заголовков.");
    return [];
  }
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  for (const header of new Set(duplicates)) pushIssue(issues, file, 1, `Колонка «${header}» повторяется.`, header);
  for (const header of headers) {
    if (headerHasForbiddenToken(header)) pushIssue(issues, file, 1, "Колонка может содержать персональные данные.", header);
    if (!expectedColumns.includes(header)) pushIssue(issues, file, 1, "Неизвестная колонка.", header);
  }
  for (const expected of expectedColumns) {
    if (!headers.includes(expected)) pushIssue(issues, file, 1, "Обязательная колонка отсутствует.", expected);
  }
  return matrix.slice(1).map((values, index) => {
    const row = Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex] ?? ""]));
    for (const header of headers) scanValue(row[header] ?? "", file, index + 2, header, issues);
    return row;
  });
}

function required(row: CsvRow, column: string, file: PilotValidationIssue["file"], rowNumber: number, issues: PilotValidationIssue[]): string {
  const value = row[column] ?? "";
  if (!value) pushIssue(issues, file, rowNumber, "Обязательное значение отсутствует.", column);
  return value;
}

function code(value: string, column: string, file: PilotValidationIssue["file"], row: number, issues: PilotValidationIssue[]): string {
  if (value && !codePattern.test(value)) pushIssue(issues, file, row, "Код: 1–40 символов A–Z, 0–9, _ или -.", column);
  return value;
}

function numberValue(
  value: string,
  column: string,
  file: PilotValidationIssue["file"],
  row: number,
  issues: PilotValidationIssue[],
  options: { integer?: boolean; minimum?: number } = {},
): number {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed) || (options.integer === true && !Number.isInteger(parsed))) {
    pushIssue(issues, file, row, options.integer === true ? "Нужно целое число." : "Нужно число.", column);
    return 0;
  }
  if (options.minimum !== undefined && parsed < options.minimum) {
    pushIssue(issues, file, row, `Значение должно быть не меньше ${options.minimum}.`, column);
  }
  return parsed;
}

function dateValue(value: string, column: string, file: PilotValidationIssue["file"], row: number, issues: PilotValidationIssue[]): string {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  const valid = datePattern.test(value)
    && !Number.isNaN(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
  if (!valid) pushIssue(issues, file, row, "Нужна дата в формате YYYY-MM-DD.", column);
  return value;
}

function timeValue(value: string, column: string, file: PilotValidationIssue["file"], row: number, issues: PilotValidationIssue[]): string {
  if (!timePattern.test(value)) pushIssue(issues, file, row, "Нужно время в формате HH:MM (00:00–23:59).", column);
  return value;
}

function dateTimeValue(
  value: string,
  column: string,
  file: PilotValidationIssue["file"],
  row: number,
  issues: PilotValidationIssue[],
  optional = false,
): string | null {
  if (!value && optional) return null;
  if (!value || !/^\d{4}-\d{2}-\d{2}T/u.test(value) || Number.isNaN(Date.parse(value))) {
    pushIssue(issues, file, row, "Нужны дата, время и часовой пояс в ISO 8601.", column);
  }
  return value || null;
}

function splitCodes(value: string, column: string, file: PilotValidationIssue["file"], row: number, issues: PilotValidationIssue[], requiredList: boolean): string[] {
  const values = value ? value.split("|").map((item) => item.trim()).filter(Boolean) : [];
  if (requiredList && values.length === 0) pushIssue(issues, file, row, "Укажите хотя бы один код.", column);
  for (const item of values) code(item, column, file, row, issues);
  if (new Set(values).size !== values.length) pushIssue(issues, file, row, "Коды в списке не должны повторяться.", column);
  return values;
}

function enumValue<const T extends string>(
  value: string,
  allowed: readonly T[],
  column: string,
  file: PilotValidationIssue["file"],
  row: number,
  issues: PilotValidationIssue[],
  optional = false,
): T | null {
  if (!value && optional) return null;
  if (!allowed.includes(value as T)) pushIssue(issues, file, row, `Допустимо: ${allowed.join(", ")}${optional ? " или пусто" : ""}.`, column);
  return value ? value as T : null;
}

function booleanOrUnknown(value: string, column: string, file: PilotValidationIssue["file"], row: number, issues: PilotValidationIssue[]): BooleanOrUnknown {
  if (!(["true", "false", "unknown"] as const).includes(value as "true" | "false" | "unknown")) {
    pushIssue(issues, file, row, "Допустимо: true, false или unknown.", column);
  }
  return value === "true" ? true : value === "false" ? false : "unknown";
}

function optionalNumber(value: string, column: string, file: PilotValidationIssue["file"], row: number, issues: PilotValidationIssue[]): number | null {
  return value ? numberValue(value, column, file, row, issues, { integer: true, minimum: 1 }) : null;
}

function clockMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function roomOperatingInterval(room: PilotRoom): [number, number] {
  const opens = clockMinutes(room.opensAt);
  let closes = clockMinutes(room.closesAt);
  if (closes <= opens) closes += 1440;
  return [opens, closes];
}

function relativeStart(room: PilotRoom, startsAt: string): number {
  const [opens, closes] = roomOperatingInterval(room);
  let start = clockMinutes(startsAt);
  if (closes > 1440 && start < opens) start += 1440;
  return start;
}

function validateInsideHours(
  room: PilotRoom,
  startsAt: string,
  durationMinutes: number,
  file: PilotValidationIssue["file"],
  row: number,
  column: string,
  issues: PilotValidationIssue[],
): void {
  if (!timePattern.test(startsAt) || durationMinutes <= 0) return;
  const [opens, closes] = roomOperatingInterval(room);
  const start = relativeStart(room, startsAt);
  if (start < opens || start + durationMinutes > closes) {
    pushIssue(issues, file, row, `Интервал выходит за рабочие часы помещения ${room.roomCode} (${room.opensAt}–${room.closesAt}).`, column);
  }
}

function parseRooms(rows: CsvRow[], issues: PilotValidationIssue[]): PilotRoom[] {
  const seen = new Set<string>();
  const rooms = rows.map((row, index): PilotRoom => {
    const rowNumber = index + 2;
    const venueCode = code(required(row, "venue_code", "rooms", rowNumber, issues), "venue_code", "rooms", rowNumber, issues);
    const roomCode = code(required(row, "room_code", "rooms", rowNumber, issues), "room_code", "rooms", rowNumber, issues);
    const capacityMin = numberValue(row.capacity_min ?? "", "capacity_min", "rooms", rowNumber, issues, { integer: true, minimum: 1 });
    const capacityMax = numberValue(row.capacity_max ?? "", "capacity_max", "rooms", rowNumber, issues, { integer: true, minimum: 1 });
    const opensAt = timeValue(required(row, "opens_at", "rooms", rowNumber, issues), "opens_at", "rooms", rowNumber, issues);
    const closesAt = timeValue(required(row, "closes_at", "rooms", rowNumber, issues), "closes_at", "rooms", rowNumber, issues);
    if (seen.has(roomCode)) pushIssue(issues, "rooms", rowNumber, "Код помещения повторяется.", "room_code");
    seen.add(roomCode);
    if (capacityMax < capacityMin) pushIssue(issues, "rooms", rowNumber, "Максимальная вместимость меньше минимальной.", "capacity_max");
    return {
      venueCode,
      roomCode,
      city: required(row, "city", "rooms", rowNumber, issues),
      venueType: required(row, "venue_type", "rooms", rowNumber, issues),
      roomType: required(row, "room_type", "rooms", rowNumber, issues),
      capacityMin,
      capacityMax,
      opensAt,
      closesAt,
      startStepMinutes: enumValue(required(row, "start_step_minutes", "rooms", rowNumber, issues), ["15", "30", "60"], "start_step_minutes", "rooms", rowNumber, issues) === "15" ? 15
        : row.start_step_minutes === "60" ? 60 : 30,
      minimumDurationMinutes: numberValue(row.minimum_duration_minutes ?? "", "minimum_duration_minutes", "rooms", rowNumber, issues, { integer: true, minimum: 30 }),
      bufferBeforeMinutes: numberValue(row.buffer_before_minutes ?? "", "buffer_before_minutes", "rooms", rowNumber, issues, { integer: true, minimum: 0 }),
      bufferAfterMinutes: numberValue(row.buffer_after_minutes ?? "", "buffer_after_minutes", "rooms", rowNumber, issues, { integer: true, minimum: 0 }),
      pricePerHourRub: numberValue(row.price_per_hour_rub ?? "", "price_per_hour_rub", "rooms", rowNumber, issues, { minimum: 0 }),
      canCombineWithRoomCodes: splitCodes(row.can_combine_with_room_codes ?? "", "can_combine_with_room_codes", "rooms", rowNumber, issues, false),
    };
  });
  const byCode = new Map(rooms.map((room) => [room.roomCode, room]));
  rooms.forEach((room, index) => {
    for (const combinedCode of room.canCombineWithRoomCodes) {
      const combined = byCode.get(combinedCode);
      if (!combined) pushIssue(issues, "rooms", index + 2, `Неизвестное помещение ${combinedCode}.`, "can_combine_with_room_codes");
      else if (combined.venueCode !== room.venueCode) pushIssue(issues, "rooms", index + 2, "Объединяемые помещения должны относиться к одной площадке.", "can_combine_with_room_codes");
      else if (combinedCode === room.roomCode) pushIssue(issues, "rooms", index + 2, "Помещение нельзя объединить само с собой.", "can_combine_with_room_codes");
    }
  });
  return rooms;
}

function parseBlocks(rows: CsvRow[], roomsByCode: Map<string, PilotRoom>, issues: PilotValidationIssue[]): PilotRoomBlock[] {
  const seen = new Set<string>();
  return rows.map((row, index): PilotRoomBlock => {
    const rowNumber = index + 2;
    const blockCode = code(required(row, "block_code", "blocks", rowNumber, issues), "block_code", "blocks", rowNumber, issues);
    const venueCode = code(required(row, "venue_code", "blocks", rowNumber, issues), "venue_code", "blocks", rowNumber, issues);
    const roomCode = code(required(row, "room_code", "blocks", rowNumber, issues), "room_code", "blocks", rowNumber, issues);
    const startsAt = timeValue(required(row, "starts_at", "blocks", rowNumber, issues), "starts_at", "blocks", rowNumber, issues);
    const durationMinutes = numberValue(row.duration_minutes ?? "", "duration_minutes", "blocks", rowNumber, issues, { integer: true, minimum: 1 });
    if (seen.has(blockCode)) pushIssue(issues, "blocks", rowNumber, "Код блока занятости повторяется.", "block_code");
    seen.add(blockCode);
    const room = roomsByCode.get(roomCode);
    if (!room) pushIssue(issues, "blocks", rowNumber, `Неизвестное помещение ${roomCode}.`, "room_code");
    else {
      if (room.venueCode !== venueCode) pushIssue(issues, "blocks", rowNumber, "Площадка не соответствует помещению.", "venue_code");
      validateInsideHours(room, startsAt, durationMinutes, "blocks", rowNumber, "starts_at", issues);
    }
    const recordedAt = dateTimeValue(required(row, "recorded_at", "blocks", rowNumber, issues), "recorded_at", "blocks", rowNumber, issues) ?? "";
    const releasedAt = dateTimeValue(row.released_at ?? "", "released_at", "blocks", rowNumber, issues, true);
    if (releasedAt && recordedAt && Date.parse(releasedAt) <= Date.parse(recordedAt)) {
      pushIssue(issues, "blocks", rowNumber, "Снятие блока должно быть позже его создания.", "released_at");
    }
    return {
      blockCode,
      venueCode,
      roomCode,
      eventDate: dateValue(required(row, "event_date", "blocks", rowNumber, issues), "event_date", "blocks", rowNumber, issues),
      startsAt,
      durationMinutes,
      blockType: enumValue(required(row, "block_type", "blocks", rowNumber, issues), ["confirmed", "manual", "technical", "hold"], "block_type", "blocks", rowNumber, issues) ?? "manual",
      recordedAt,
      releasedAt,
    };
  });
}

function parseRequests(rows: CsvRow[], roomsByCode: Map<string, PilotRoom>, issues: PilotValidationIssue[]): PilotRequest[] {
  const seen = new Set<string>();
  return rows.map((row, index): PilotRequest => {
    const rowNumber = index + 2;
    const requestCode = code(required(row, "request_code", "requests", rowNumber, issues), "request_code", "requests", rowNumber, issues);
    const venueCode = code(required(row, "venue_code", "requests", rowNumber, issues), "venue_code", "requests", rowNumber, issues);
    const roomCodes = splitCodes(row.room_codes ?? "", "room_codes", "requests", rowNumber, issues, true);
    const preferredStart = timeValue(required(row, "preferred_start", "requests", rowNumber, issues), "preferred_start", "requests", rowNumber, issues);
    const durationMinutes = numberValue(row.duration_minutes ?? "", "duration_minutes", "requests", rowNumber, issues, { integer: true, minimum: 1 });
    const offeredStart = row.offered_start ? timeValue(row.offered_start, "offered_start", "requests", rowNumber, issues) : null;
    const offeredDurationMinutes = optionalNumber(row.offered_duration_minutes ?? "", "offered_duration_minutes", "requests", rowNumber, issues);
    const selectedStart = row.selected_start ? timeValue(row.selected_start, "selected_start", "requests", rowNumber, issues) : null;
    const selectedDurationMinutes = optionalNumber(row.selected_duration_minutes ?? "", "selected_duration_minutes", "requests", rowNumber, issues);
    const createdAt = dateTimeValue(required(row, "created_at", "requests", rowNumber, issues), "created_at", "requests", rowNumber, issues) ?? "";
    const firstResponseAt = dateTimeValue(row.first_response_at ?? "", "first_response_at", "requests", rowNumber, issues, true);
    const confirmedAt = dateTimeValue(row.confirmed_at ?? "", "confirmed_at", "requests", rowNumber, issues, true);
    const finalStatus = enumValue(required(row, "final_status", "requests", rowNumber, issues), ["new", "pending", "confirmed", "rejected", "cancelled", "completed", "unknown"], "final_status", "requests", rowNumber, issues) ?? "unknown";
    if (seen.has(requestCode)) pushIssue(issues, "requests", rowNumber, "Код запроса повторяется.", "request_code");
    seen.add(requestCode);
    if ((offeredStart === null) !== (offeredDurationMinutes === null)) pushIssue(issues, "requests", rowNumber, "Время и длительность предложения заполняются вместе.", "offered_start");
    if ((selectedStart === null) !== (selectedDurationMinutes === null)) pushIssue(issues, "requests", rowNumber, "Выбранное время и длительность заполняются вместе.", "selected_start");
    if (["confirmed", "completed"].includes(finalStatus) && (selectedStart === null || selectedDurationMinutes === null || confirmedAt === null)) {
      pushIssue(issues, "requests", rowNumber, "Для подтверждённого или завершённого запроса нужны confirmed_at, selected_start и selected_duration_minutes.", "final_status");
    }
    if (firstResponseAt && createdAt && Date.parse(firstResponseAt) < Date.parse(createdAt)) pushIssue(issues, "requests", rowNumber, "Ответ не может быть раньше создания запроса.", "first_response_at");
    if (confirmedAt && createdAt && Date.parse(confirmedAt) < Date.parse(createdAt)) pushIssue(issues, "requests", rowNumber, "Подтверждение не может быть раньше создания запроса.", "confirmed_at");
    for (const roomCode of roomCodes) {
      const room = roomsByCode.get(roomCode);
      if (!room) pushIssue(issues, "requests", rowNumber, `Неизвестное помещение ${roomCode}.`, "room_codes");
      else {
        if (room.venueCode !== venueCode) pushIssue(issues, "requests", rowNumber, `Помещение ${roomCode} относится к другой площадке.`, "venue_code");
        if (selectedStart && selectedDurationMinutes) validateInsideHours(room, selectedStart, selectedDurationMinutes, "requests", rowNumber, "selected_start", issues);
        if (offeredStart && offeredDurationMinutes) validateInsideHours(room, offeredStart, offeredDurationMinutes, "requests", rowNumber, "offered_start", issues);
      }
    }
    return {
      requestCode,
      venueCode,
      roomCodes,
      eventDate: dateValue(required(row, "event_date", "requests", rowNumber, issues), "event_date", "requests", rowNumber, issues),
      preferredStart,
      durationMinutes,
      guestCount: numberValue(row.guest_count ?? "", "guest_count", "requests", rowNumber, issues, { integer: true, minimum: 1 }),
      requestSource: enumValue(required(row, "request_source", "requests", rowNumber, issues), ["phone", "site", "messenger", "social", "walk_in", "other"], "request_source", "requests", rowNumber, issues) ?? "other",
      createdAt,
      firstResponseAt,
      exactStartAvailable: booleanOrUnknown(required(row, "exact_start_available", "requests", rowNumber, issues), "exact_start_available", "requests", rowNumber, issues),
      offeredStart,
      offeredDurationMinutes,
      alternativeAccepted: booleanOrUnknown(required(row, "alternative_accepted", "requests", rowNumber, issues), "alternative_accepted", "requests", rowNumber, issues),
      finalStatus,
      declineReasonCategory: enumValue(row.decline_reason_category ?? "", ["busy", "capacity", "price", "rules", "no_response", "client_changed", "other"], "decline_reason_category", "requests", rowNumber, issues, true),
      confirmedAt,
      selectedStart,
      selectedDurationMinutes,
      actualVisit: booleanOrUnknown(required(row, "actual_visit", "requests", rowNumber, issues), "actual_visit", "requests", rowNumber, issues),
    };
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function buildSummary(rooms: PilotRoom[], blocks: PilotRoomBlock[], requests: PilotRequest[]): PilotDatasetSummary {
  const dates = [...blocks.map((block) => block.eventDate), ...requests.map((request) => request.eventDate)].sort();
  const responseMinutes = requests.flatMap((request) => request.firstResponseAt
    ? [(Date.parse(request.firstResponseAt) - Date.parse(request.createdAt)) / 60_000]
    : []);
  return {
    venueCount: new Set(rooms.map((room) => room.venueCode)).size,
    roomCount: rooms.length,
    blockCount: blocks.length,
    requestCount: requests.length,
    cities: [...new Set(rooms.map((room) => room.city))].sort((left, right) => left.localeCompare(right)),
    eventDateFrom: dates.at(0) ?? null,
    eventDateTo: dates.at(-1) ?? null,
    requestsWithKnownAvailability: requests.filter((request) => request.exactStartAvailable !== "unknown").length,
    exactStartAvailableCount: requests.filter((request) => request.exactStartAvailable === true).length,
    alternativesOffered: requests.filter((request) => request.offeredStart !== null).length,
    alternativesAccepted: requests.filter((request) => request.alternativeAccepted === true).length,
    medianFirstResponseMinutes: median(responseMinutes),
    privacyFindings: 0,
  };
}

export function importPilotDataset(input: PilotCsvInput): PilotDataset {
  const issues: PilotValidationIssue[] = [];
  const roomRows = parseCsv(input.rooms, "rooms", roomColumns, issues);
  if (!roomRows.length) pushIssue(issues, "rooms", 2, "Нужна хотя бы одна строка помещения.");
  const rooms = parseRooms(roomRows, issues);
  const roomsByCode = new Map(rooms.map((room) => [room.roomCode, room]));
  const blocks = parseBlocks(parseCsv(input.blocks, "blocks", blockColumns, issues), roomsByCode, issues);
  const requestRows = parseCsv(input.requests, "requests", requestColumns, issues);
  if (!requestRows.length) pushIssue(issues, "requests", 2, "Нужна хотя бы одна строка запроса.");
  const requests = parseRequests(requestRows, roomsByCode, issues);
  if (issues.length) throw new PilotDatasetValidationError(issues);
  const normalized = { schemaVersion: PILOT_DATASET_SCHEMA_VERSION, dataSource: "pilot_anonymized" as const, rooms, blocks, requests };
  const datasetHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return { ...normalized, datasetHash, summary: buildSummary(rooms, blocks, requests) };
}

export function pilotDatasetMarkdown(dataset: PilotDataset, generatedAt = new Date().toISOString()): string {
  const summary = dataset.summary;
  const medianResponse = summary.medianFirstResponseMinutes === null ? "нет данных" : `${summary.medianFirstResponseMinutes} мин`;
  return `# Обезличенный пилотный набор Rooms

Дата формирования: ${generatedAt}

> Набор прошёл автоматическую проверку структуры и явных признаков персональных данных. Это не заменяет ручную проверку владельцем данных. Файл подтверждает состав набора, но сам по себе не доказывает улучшение показателей Rooms.

## Состав

- площадок: ${summary.venueCount};
- помещений: ${summary.roomCount};
- блоков занятости: ${summary.blockCount};
- входящих запросов: ${summary.requestCount};
- города: ${summary.cities.join(", ") || "не указаны"};
- период событий: ${summary.eventDateFrom ?? "нет данных"} — ${summary.eventDateTo ?? "нет данных"};
- медиана первого ответа: ${medianResponse};
- запросов с известной доступностью точного времени: ${summary.requestsWithKnownAvailability};
- предложено альтернатив: ${summary.alternativesOffered};
- принято альтернатив: ${summary.alternativesAccepted};
- автоматических находок персональных данных: ${summary.privacyFindings};
- SHA-256 набора: \`${dataset.datasetHash}\`.

## Ограничения

Перед использованием в испытаниях ответственный от площадки должен подтвердить, что в исходных CSV нет клиентских идентификаторов, свободных текстов и коммерчески чувствительной информации, которую площадка не разрешала передавать. Результаты сравнения алгоритмов формируются отдельным отчётом с указанием этого хеша.
`;
}
