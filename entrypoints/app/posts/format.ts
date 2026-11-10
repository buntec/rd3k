const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The units ages are told in, each with the age up to which it's used */
const AGE_STEPS: [unit: Intl.RelativeTimeFormatUnit, size: number, limit: number][] = [
  ['minute', MINUTE, HOUR],
  ['hour', HOUR, DAY],
  ['day', DAY, 30 * DAY],
  ['month', 30 * DAY, 365 * DAY],
  ['year', 365 * DAY, Infinity],
];

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'always', style: 'short' });

/** How long ago, e.g. "5 hr. ago"; "just now" under a minute */
export function timeAgo(time: number, now = Date.now()): string {
  const age = Math.max(0, now - time);
  if (age < MINUTE) return 'just now';
  const [unit, size] = AGE_STEPS.find(([, , limit]) => age < limit)!;
  return relativeTime.format(-Math.floor(age / size), unit);
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The full date and time, for a tooltip */
export function fullDate(time: number): string {
  return dateTime.format(time);
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** e.g. 1.2K */
export function compactNumber(n: number): string {
  return compact.format(n);
}

/** e.g. "1 comment", "1.2K comments" */
export function countOf(n: number, noun: string): string {
  return `${compactNumber(n)} ${noun}${n === 1 ? '' : 's'}`;
}
