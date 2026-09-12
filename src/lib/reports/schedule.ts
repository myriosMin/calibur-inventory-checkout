/**
 * Weekday gating for the weekly digest.
 *
 * There is **one** cron entry (`vercel.json`), because Vercel's cron
 * frequency is plan-limited and a hobby/pro project should not spend its
 * budget on a job that does nothing six days out of seven. The daily route
 * therefore decides internally what is due, and "is today digest day" is
 * that decision for the weekly report.
 *
 * The zone matters. The cron fires on a UTC schedule, but "Monday" to the
 * club is Monday in Singapore — where both the members and the Supabase
 * region are. A digest scheduled at 01:00 UTC is 09:00 SGT *the same day*,
 * but a naive `date.getUTCDay()` on a server in any other zone, or a
 * `getDay()` on a developer's laptop, would drift. So the weekday is always
 * resolved in an explicit IANA zone.
 */

/** Singapore: the club, the members, and the Supabase region are all here. */
export const REPORT_TIME_ZONE = "Asia/Singapore";

/** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Monday: the digest lands at the start of the working week, not in it. */
export const DIGEST_WEEKDAY: Weekday = 1;

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * The day of the week `date` falls on, as observed in `timeZone`.
 *
 * Uses `Intl` rather than a manual UTC offset so it stays correct in any
 * zone that observes DST (Singapore does not, but the function is not
 * Singapore-specific and a future committee elsewhere should not inherit a
 * hardcoded +8).
 */
export function weekdayInZone(date: Date, timeZone: string = REPORT_TIME_ZONE): Weekday {
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const weekday = WEEKDAY_INDEX[label];
  if (weekday === undefined) {
    // Unreachable with "en-US"/"short", but a wrong guess here would silently
    // move the digest to another day, so fail loudly rather than default.
    throw new Error(`Unrecognised weekday label "${label}" for time zone ${timeZone}`);
  }
  return weekday;
}

/** The calendar date in `timeZone`, as `YYYY-MM-DD`. Used for grouping and headings. */
export function dateInZone(date: Date, timeZone: string = REPORT_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isDigestDay(
  date: Date,
  weekday: Weekday = DIGEST_WEEKDAY,
  timeZone: string = REPORT_TIME_ZONE,
): boolean {
  return weekdayInZone(date, timeZone) === weekday;
}
