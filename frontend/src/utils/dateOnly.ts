/**
 * Helpers for working with date-only strings (YYYY-MM-DD).
 *
 * The default `new Date("2026-04-04")` parses as UTC midnight. When rendered
 * via `toLocaleDateString` etc. in any timezone west of UTC, that shows up
 * as the previous day. We parse at local noon instead, which puts us safely
 * inside the intended day in every real-world timezone.
 *
 * Symmetrically, `new Date().toISOString().split('T')[0]` returns today's
 * date in UTC, which is "tomorrow" for users west of UTC near midnight.
 * `localTodayIso()` returns the user's actual local date.
 */

/**
 * Parse a date-only ISO string ("YYYY-MM-DD") as local noon, avoiding the
 * UTC-midnight boundary that causes off-by-one rendering in negative-offset
 * timezones. Pass-through for full ISO strings (anything containing 'T').
 */
export function parseDateOnly(iso: string): Date {
  if (iso.includes('T')) return new Date(iso)
  // YYYY-MM-DD → construct in local time at noon. The Date constructor with
  // numeric args uses local time, so this stays in the user's day.
  const parts = iso.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1]) - 1  // Date months are 0-indexed
  const day = Number(parts[2])
  return new Date(year, month, day, 12, 0, 0, 0)
}

/**
 * Return today's date in the user's local timezone as a YYYY-MM-DD string.
 * Replaces `new Date().toISOString().split('T')[0]`, which returns UTC and
 * gives "tomorrow" for users west of UTC near midnight.
 */
export function localTodayIso(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Convert a Date to a YYYY-MM-DD string in the user's local timezone.
 * Use instead of `date.toISOString().split('T')[0]` whenever the underlying
 * Date represents a calendar day rather than an instant.
 */
export function toLocalDateIso(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
