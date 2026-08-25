import * as React from 'react';
import { DEFAULT_TIMEZONE } from '@kaif/shared';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const QUICK_TIMES = ['09:00', '12:00', '18:00'] as const;
const DEFAULT_TIME = '09:00';
const PROBE_HOURS = [-48, -24, -12, 0, 12, 24, 48] as const;

const monthFormatter = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayAriaFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const zonedPartsFormatters = new Map<string, Intl.DateTimeFormat>();
const triggerFormatters = new Map<string, Intl.DateTimeFormat>();

export interface DateTimePickerProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** IANA-зона пользователя, например Europe/Moscow. */
  timeZone?: string;
  'aria-label'?: string;
}

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export type ZonedDateTimeConversion = { ok: true; iso: string } | { ok: false; error: string };

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface DraftValue {
  date: CalendarDate | null;
  time: string;
  month: CalendarDate;
  focusedDate: CalendarDate;
}

interface TimeZoneResolution {
  timeZone: string;
  error: string | null;
}

function getZonedPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedPartsFormatters.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  zonedPartsFormatters.set(timeZone, formatter);
  return formatter;
}

function getTriggerFormatter(timeZone: string, withYear: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}:${withYear ? 'full' : 'short'}`;
  const cached = triggerFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
  triggerFormatters.set(key, formatter);
  return formatter;
}

function resolveTimeZone(timeZone: string | undefined): TimeZoneResolution {
  const requested = timeZone ?? DEFAULT_TIMEZONE;
  try {
    getZonedPartsFormatter(requested);
    return { timeZone: requested, error: null };
  } catch {
    return {
      timeZone: DEFAULT_TIMEZONE,
      error: `Часовой пояс «${requested}» не поддерживается. Проверьте настройки профиля.`,
    };
  }
}

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  return value === undefined ? Number.NaN : Number(value);
}

/** Возвращает календарные части конкретного момента строго в указанной IANA-зоне. */
export function getZonedDateTimeParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const parts = getZonedPartsFormatter(timeZone).formatToParts(date);
  return {
    year: numericPart(parts, 'year'),
    month: numericPart(parts, 'month'),
    day: numericPart(parts, 'day'),
    hour: numericPart(parts, 'hour'),
    minute: numericPart(parts, 'minute'),
    second: numericPart(parts, 'second'),
  };
}

function calendarDateFromParts(parts: ZonedDateTimeParts): CalendarDate {
  return { year: parts.year, month: parts.month, day: parts.day };
}

function parseValue(value: string | null | undefined, timeZone: string): Date | null {
  if (!value) return null;

  // Строка со смещением уже описывает конкретный момент и не зависит от зоны устройства.
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Значения без смещения считаем местным временем выбранной IANA-зоны.
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(value);
  if (!local) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = local;
  if (!year || !month || !day) return null;
  const result = zonedDateTimeToIso(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    },
    timeZone,
  );
  return result.ok ? new Date(result.iso) : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toUtcMilliseconds({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
}: CalendarDate & Partial<Pick<ZonedDateTimeParts, 'hour' | 'minute' | 'second'>>): number {
  // setUTCFullYear корректно работает и для годов 0–99, в отличие от Date.UTC.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function calendarDateFromUtcMilliseconds(milliseconds: number): CalendarDate {
  const date = new Date(milliseconds);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function sameCalendarDate(left: CalendarDate | null, right: CalendarDate | null): boolean {
  return Boolean(
    left &&
    right &&
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day,
  );
}

function sameDateTimeParts(left: ZonedDateTimeParts, right: ZonedDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function isValidCalendarDate(date: CalendarDate): boolean {
  return sameCalendarDate(date, calendarDateFromUtcMilliseconds(toUtcMilliseconds(date)));
}

function monthStart(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: 1 };
}

function addCalendarDays(date: CalendarDate, amount: number): CalendarDate {
  return calendarDateFromUtcMilliseconds(toUtcMilliseconds(date) + amount * 86_400_000);
}

function daysInMonth(year: number, month: number): number {
  return addCalendarDays({ year, month: month + 1, day: 1 }, -1).day;
}

function shiftCalendarMonths(date: CalendarDate, amount: number): CalendarDate {
  const shiftedMonth = new Date(toUtcMilliseconds({ year: date.year, month: date.month, day: 1 }));
  shiftedMonth.setUTCMonth(shiftedMonth.getUTCMonth() + amount);
  const year = shiftedMonth.getUTCFullYear();
  const month = shiftedMonth.getUTCMonth() + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

function mondayIndex(date: CalendarDate): number {
  return (new Date(toUtcMilliseconds(date)).getUTCDay() + 6) % 7;
}

function calendarDays(month: CalendarDate): CalendarDate[] {
  const firstDay = monthStart(month);
  const gridStart = addCalendarDays(firstDay, -mondayIndex(firstDay));
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}

function dateKey(date: CalendarDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

function todayInTimeZone(timeZone: string, now = new Date()): CalendarDate {
  return calendarDateFromParts(getZonedDateTimeParts(now, timeZone));
}

/**
 * Превращает календарную дату и время в ISO без зависимости от зоны устройства.
 * Обратная проверка не даёт Date молча сдвинуть несуществующее время в DST-разрыве.
 */
export function zonedDateTimeToIso(
  parts: Omit<ZonedDateTimeParts, 'second'> & { second?: number },
  timeZone: string,
): ZonedDateTimeConversion {
  const target: ZonedDateTimeParts = { ...parts, second: parts.second ?? 0 };

  try {
    getZonedPartsFormatter(timeZone);
  } catch {
    return { ok: false, error: `Часовой пояс «${timeZone}» не поддерживается.` };
  }

  if (
    !isValidCalendarDate(target) ||
    target.hour < 0 ||
    target.hour > 23 ||
    target.minute < 0 ||
    target.minute > 59 ||
    target.second < 0 ||
    target.second > 59
  ) {
    return { ok: false, error: 'Указаны некорректные дата или время.' };
  }

  const naiveUtc = toUtcMilliseconds(target);
  const candidates = new Set<number>();

  // Берём возможные смещения зоны до и после даты: это покрывает обе стороны DST-перехода.
  for (const probeHours of PROBE_HOURS) {
    const probe = naiveUtc + probeHours * 3_600_000;
    const observed = getZonedDateTimeParts(new Date(probe), timeZone);
    const offset = toUtcMilliseconds(observed) - probe;
    candidates.add(naiveUtc - offset);
  }

  const matching = [...candidates]
    .filter((candidate) =>
      sameDateTimeParts(getZonedDateTimeParts(new Date(candidate), timeZone), target),
    )
    .sort((left, right) => left - right);

  if (matching[0] === undefined) {
    return {
      ok: false,
      error: `Такого времени нет в часовом поясе ${timeZone} из-за перевода часов. Выберите другое время.`,
    };
  }

  return { ok: true, iso: new Date(matching[0]).toISOString() };
}

function createDraft(
  value: string | null | undefined,
  timeZone: string,
  now = new Date(),
): DraftValue {
  const parsed = parseValue(value, timeZone);
  const today = todayInTimeZone(timeZone, now);

  if (!parsed) {
    return {
      date: null,
      time: DEFAULT_TIME,
      month: monthStart(today),
      focusedDate: today,
    };
  }

  const parts = getZonedDateTimeParts(parsed, timeZone);
  const date = calendarDateFromParts(parts);
  return {
    date,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
    month: monthStart(date),
    focusedDate: date,
  };
}

function formatTriggerValue(
  value: string | null | undefined,
  timeZone: string,
  today: CalendarDate,
): string | null {
  const date = parseValue(value, timeZone);
  if (!date) return null;
  const parts = getZonedDateTimeParts(date, timeZone);
  return getTriggerFormatter(timeZone, parts.year !== today.year).format(date);
}

function formatMonth(month: CalendarDate): string {
  return capitalized(monthFormatter.format(new Date(toUtcMilliseconds(month))));
}

function formatDayAria(date: CalendarDate): string {
  return capitalized(dayAriaFormatter.format(new Date(toUtcMilliseconds(date))));
}

function capitalized(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function DateTimePicker({
  value,
  onChange,
  disabled = false,
  placeholder = 'Не задано',
  timeZone,
  'aria-label': ariaLabel = 'Выбрать дату и время',
}: DateTimePickerProps): React.ReactElement {
  const zone = React.useMemo(() => resolveTimeZone(timeZone), [timeZone]);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftValue>(() => createDraft(value, zone.timeZone));
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const timeInputId = React.useId();
  const monthLabelId = React.useId();
  const errorId = React.useId();
  const dayButtons = React.useRef(new Map<string, HTMLButtonElement>());
  const shouldFocusDay = React.useRef(false);
  const today = todayInTimeZone(zone.timeZone);
  const days = calendarDays(draft.month);
  const triggerValue = formatTriggerValue(value, zone.timeZone, today);
  const visibleError = zone.error ?? applyError;

  React.useEffect(() => {
    if (!shouldFocusDay.current) return;
    shouldFocusDay.current = false;
    dayButtons.current.get(dateKey(draft.focusedDate))?.focus();
  }, [draft.focusedDate]);

  React.useEffect(() => {
    if (!open) return;
    setDraft(createDraft(value, zone.timeZone));
    setApplyError(null);
  }, [zone.timeZone]); // Намеренно не сбрасываем пользовательский черновик при обычном ререндере.

  const handleOpenChange = (nextOpen: boolean): void => {
    // При каждом открытии берём актуальное внешнее значение, а не старый черновик.
    if (nextOpen) {
      setDraft(createDraft(value, zone.timeZone));
      setApplyError(null);
    }
    setOpen(nextOpen);
  };

  const selectDate = (date: CalendarDate, focusDay = false): void => {
    shouldFocusDay.current = focusDay;
    setApplyError(null);
    setDraft((current) => ({
      ...current,
      date,
      month: monthStart(date),
      focusedDate: date,
    }));
  };

  const moveCalendarFocus = (date: CalendarDate): void => {
    shouldFocusDay.current = true;
    setDraft((current) => ({
      ...current,
      month: monthStart(date),
      focusedDate: date,
    }));
  };

  const handleDayKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    date: CalendarDate,
  ): void => {
    let nextDate: CalendarDate | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        nextDate = addCalendarDays(date, -1);
        break;
      case 'ArrowRight':
        nextDate = addCalendarDays(date, 1);
        break;
      case 'ArrowUp':
        nextDate = addCalendarDays(date, -7);
        break;
      case 'ArrowDown':
        nextDate = addCalendarDays(date, 7);
        break;
      case 'Home':
        nextDate = addCalendarDays(date, -mondayIndex(date));
        break;
      case 'End':
        nextDate = addCalendarDays(date, 6 - mondayIndex(date));
        break;
      case 'PageUp':
        nextDate = shiftCalendarMonths(date, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        nextDate = shiftCalendarMonths(date, event.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }

    event.preventDefault();
    moveCalendarFocus(nextDate);
  };

  const changeVisibleMonth = (amount: number): void => {
    setDraft((current) => {
      const focusedDate = shiftCalendarMonths(current.focusedDate, amount);
      return { ...current, month: monthStart(focusedDate), focusedDate };
    });
  };

  const apply = (): void => {
    if (!draft.date) {
      setApplyError('Выберите дату.');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(draft.time)) {
      setApplyError('Укажите время.');
      return;
    }

    const [hour, minute] = draft.time.split(':').map(Number);
    if (hour === undefined || minute === undefined) {
      setApplyError('Укажите время.');
      return;
    }
    const result = zonedDateTimeToIso({ ...draft.date, hour, minute }, zone.timeZone);
    if (!result.ok) {
      setApplyError(result.error);
      return;
    }

    onChange(result.iso);
    setOpen(false);
  };

  const clear = (): void => {
    onChange(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${ariaLabel}: ${triggerValue ?? placeholder}`}
          className={cn(
            'flex h-11 w-full touch-manipulation items-center gap-3 rounded-lg border border-input bg-surface px-3 text-left text-sm shadow-none',
            'transition-[border-color,box-shadow,background-color] hover:bg-secondary/60',
            'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <CalendarDays className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', !triggerValue && 'text-muted-foreground')}>
            {triggerValue ?? placeholder}
          </span>
          <ChevronDown className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        collisionPadding={8}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-80 overflow-y-auto overscroll-contain p-2"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-10 items-center justify-between gap-2 [@media(pointer:coarse)]:min-h-11">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 [@media(pointer:coarse)]:size-11"
              aria-label="Предыдущий месяц"
              onClick={() => changeVisibleMonth(-1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <div
              id={monthLabelId}
              aria-live="polite"
              aria-atomic="true"
              className="min-w-0 flex-1 truncate text-center text-sm font-semibold"
            >
              {formatMonth(draft.month)}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 [@media(pointer:coarse)]:size-11"
              aria-label="Следующий месяц"
              onClick={() => changeVisibleMonth(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>

          <div role="grid" aria-labelledby={monthLabelId}>
            <div role="row" className="grid grid-cols-7 gap-0.5">
              {WEEK_DAYS.map((weekDay) => (
                <div
                  key={weekDay}
                  role="columnheader"
                  aria-label={weekDay}
                  className="flex h-6 items-center justify-center text-[11px] font-medium text-muted-foreground"
                >
                  {weekDay}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, rowIndex) => (
              <div key={rowIndex} role="row" className="grid grid-cols-7 gap-0.5">
                {days.slice(rowIndex * 7, rowIndex * 7 + 7).map((day) => {
                  const selected = sameCalendarDate(day, draft.date);
                  const isToday = sameCalendarDate(day, today);
                  const focused = sameCalendarDate(day, draft.focusedDate);
                  const outsideMonth = day.month !== draft.month.month;
                  const key = dateKey(day);

                  return (
                    <div key={key} role="gridcell" aria-selected={selected} className="min-w-0">
                      <button
                        ref={(node) => {
                          if (node) dayButtons.current.set(key, node);
                          else dayButtons.current.delete(key);
                        }}
                        type="button"
                        tabIndex={focused ? 0 : -1}
                        aria-label={formatDayAria(day)}
                        aria-current={isToday ? 'date' : undefined}
                        onFocus={() => {
                          if (!focused) {
                            setDraft((current) => ({ ...current, focusedDate: day }));
                          }
                        }}
                        onKeyDown={(event) => handleDayKeyDown(event, day)}
                        onClick={() => selectDate(day, true)}
                        className={cn(
                          'flex h-10 w-full min-w-0 touch-manipulation items-center justify-center rounded-md text-sm tabular-nums transition-colors',
                          'hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
                          outsideMonth && 'text-muted-foreground/55',
                          isToday &&
                            !selected &&
                            'font-semibold text-primary ring-1 ring-primary/45',
                          selected &&
                            'bg-primary font-semibold text-primary-foreground hover:bg-primary-hover',
                        )}
                      >
                        {day.day}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-1" aria-label="Быстрый выбор даты">
            {[
              { label: 'Сегодня', offset: 0 },
              { label: 'Завтра', offset: 1 },
              { label: 'Через неделю', offset: 7 },
            ].map(({ label, offset }) => (
              <Button
                key={label}
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 min-w-0 px-1.5 text-[11px] xs:text-xs [@media(pointer:coarse)]:min-h-11"
                onClick={() => selectDate(addCalendarDays(today, offset))}
              >
                <span className="truncate">{label}</span>
              </Button>
            ))}
          </div>

          <div className="border-t border-border pt-3">
            <label
              htmlFor={timeInputId}
              className="mb-1.5 flex items-center gap-2 text-sm font-medium"
            >
              <Clock className="size-[18px] text-muted-foreground" aria-hidden />
              Время
            </label>
            <input
              id={timeInputId}
              type="time"
              step={60}
              value={draft.time}
              aria-describedby={visibleError ? errorId : undefined}
              onChange={(event) => {
                setApplyError(null);
                setDraft((current) => ({ ...current, time: event.target.value }));
              }}
              className={cn(
                'h-11 w-full rounded-lg border border-input bg-surface px-3 text-base shadow-sm [color-scheme:light] dark:[color-scheme:dark]',
                'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20',
              )}
            />
            <div className="mt-1 grid grid-cols-3 gap-1" aria-label="Быстрый выбор времени">
              {QUICK_TIMES.map((quickTime) => (
                <Button
                  key={quickTime}
                  type="button"
                  variant={draft.time === quickTime ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-h-10 tabular-nums [@media(pointer:coarse)]:min-h-11"
                  aria-pressed={draft.time === quickTime}
                  onClick={() => {
                    setApplyError(null);
                    setDraft((current) => ({ ...current, time: quickTime }));
                  }}
                >
                  {quickTime}
                </Button>
              ))}
            </div>
          </div>

          {visibleError && (
            <p id={errorId} role="alert" className="text-xs leading-relaxed text-destructive">
              {visibleError}
            </p>
          )}

          <div className="grid grid-cols-[auto_1fr_1fr] gap-1 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              className="min-h-10 px-2.5 text-muted-foreground [@media(pointer:coarse)]:min-h-11"
              disabled={!value}
              onClick={clear}
            >
              Очистить
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 px-2 [@media(pointer:coarse)]:min-h-11"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="primary"
              className="min-h-10 px-2 [@media(pointer:coarse)]:min-h-11"
              disabled={!draft.date || !draft.time || Boolean(zone.error)}
              onClick={apply}
            >
              Применить
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
