import { BadRequestException } from '@nestjs/common';
import { WeekDay } from '@prisma/client';

export const DEFAULT_BOOKING_TIMEZONE = 'America/La_Paz';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const weekDayMap: Record<string, WeekDay> = {
  MONDAY: WeekDay.MONDAY,
  TUESDAY: WeekDay.TUESDAY,
  WEDNESDAY: WeekDay.WEDNESDAY,
  THURSDAY: WeekDay.THURSDAY,
  FRIDAY: WeekDay.FRIDAY,
  SATURDAY: WeekDay.SATURDAY,
  SUNDAY: WeekDay.SUNDAY,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function buildDateKey(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function getDateTimeParts(date: Date, timeZone: string) {
  const parts = getFormatter(timeZone).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? NaN);
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? NaN);
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? NaN);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  const second = Number(parts.find((p) => p.type === 'second')?.value ?? NaN);

  return { year, month, day, hour, minute, second };
}

function getOffsetMs(date: Date, timeZone: string): number {
  const parts = getDateTimeParts(date, timeZone);
  const utcFromTz = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return utcFromTz - date.getTime();
}

export function ensureValidTimeZone(timeZone?: string): string {
  const value = (timeZone ?? DEFAULT_BOOKING_TIMEZONE).trim();
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new BadRequestException('timezone invalida');
  }
}

export function assertValidDate(date: string): void {
  const match = DATE_RE.exec(date);
  if (!match) throw new BadRequestException('La fecha debe tener formato YYYY-MM-DD');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new BadRequestException('La fecha no es valida');
  }
}

export function assertValidTime(value: string, fieldName = 'time'): void {
  if (!TIME_RE.test(value)) {
    throw new BadRequestException(`${fieldName} debe tener formato HH:mm`);
  }
}

export function parseTimeToMinutes(value: string): number {
  assertValidTime(value);
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function validateTimeRange(startTime: string, endTime: string): void {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes >= endMinutes) {
    throw new BadRequestException('startTime debe ser menor que endTime');
  }
}

export function intervalsOverlap(
  aStartMinutes: number,
  aEndMinutes: number,
  bStartMinutes: number,
  bEndMinutes: number,
): boolean {
  return aStartMinutes < bEndMinutes && aEndMinutes > bStartMinutes;
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  assertValidDate(date);
  assertValidTime(time);

  const dateMatch = DATE_RE.exec(date)!;
  const [hours, minutes] = time.split(':').map(Number);
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  const firstOffset = getOffsetMs(guess, timeZone);
  const firstPass = new Date(guess.getTime() - firstOffset);

  const secondOffset = getOffsetMs(firstPass, timeZone);
  return new Date(guess.getTime() - secondOffset);
}

export function getLocalDateKey(date: Date, timeZone: string): string {
  const parts = getDateTimeParts(date, timeZone);
  return buildDateKey(parts.year, parts.month, parts.day);
}

export function getLocalMinutes(date: Date, timeZone: string): number {
  const parts = getDateTimeParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function getWeekDayForDate(date: string, timeZone: string): WeekDay {
  const noonUtc = zonedDateTimeToUtc(date, '12:00', timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
  })
    .format(noonUtc)
    .toUpperCase();

  const mapped = weekDayMap[weekday];
  if (!mapped) {
    throw new BadRequestException('No se pudo determinar el dia de la semana');
  }

  return mapped;
}
