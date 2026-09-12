/**
 * The two destructive member-lifecycle actions, as pure patch builders.
 *
 * `docs/tele-qr/pdpa.md` makes an explicit commitment under "Withdrawal /
 * deletion": *"On leaving the club, or on request: clear `telegram_user_id`,
 * set `active = false`, unlink the Telegram binding."* Until now
 * `/admin/members/[id]` rendered the telegram fields read-only with no unbind
 * action at all, so there was no way to honour it from the dashboard.
 *
 * Equally explicit is what must NOT happen: pdpa.md's retention table keeps
 * the member record ("Deactivated on leaving; kept for historical
 * attribution") and the borrowing history ("Retained as club inventory
 * records"), because *"who had the Livox LiDAR in 2026" is a legitimate club
 * record*. So neither patch deletes anything — offboarding UNLINKS a live
 * Telegram account from a member row, it does not erase the member or their
 * movements.
 *
 * Kept as pure functions (rather than inline object literals in the page) so
 * the exact field set is unit-testable and so the integration test can apply
 * the same patch the UI applies, instead of a hand-copied approximation of it.
 */

export interface MemberUnbindPatch {
  telegram_user_id: null;
  telegram_bound_at: null;
}

export interface MemberOffboardPatch extends MemberUnbindPatch {
  active: false;
  left_at: string;
}

/**
 * Unbind WITHOUT deactivating: the member stays active and can re-bind by
 * messaging the bot again. This is the "they changed their Telegram handle"
 * case that `docs/tele-qr/flows.md` §5 says will happen — the old
 * `telegram_user_id` still points at the account they no longer use, and
 * nothing else clears it.
 *
 * Deliberately does NOT clear `telegram_username`: the handle is roster data
 * collected at registration and is what the bind queue matches on, while
 * `telegram_user_id` is the binding itself. Clearing the handle too would
 * make the member unmatchable on their next `/start`.
 */
export function buildUnbindPatch(): MemberUnbindPatch {
  return { telegram_user_id: null, telegram_bound_at: null };
}

/**
 * Offboard: unbind, deactivate, and stamp a leaving date.
 *
 * `existingLeftAt` is preserved when already set, so re-running an offboard
 * on an already-offboarded member doesn't quietly rewrite the date they
 * actually left to the date someone clicked the button a second time.
 */
export function buildOffboardPatch(
  today: string,
  existingLeftAt: string | null = null,
): MemberOffboardPatch {
  return {
    ...buildUnbindPatch(),
    active: false,
    left_at: existingLeftAt ?? today,
  };
}

/**
 * Today as `YYYY-MM-DD` in the **local** timezone.
 *
 * `members.left_at` is a Postgres `date`, not a timestamptz. Building it from
 * `toISOString()` would use UTC and, for a Singapore admin clicking offboard
 * any time before 08:00 SGT, stamp yesterday's date.
 */
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
