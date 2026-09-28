/**
 * Per-code summary for /admin/join-codes. Pure, so the leak signal is tested.
 */

export type JoinCodeStatus = "active" | "revoked" | "expired" | "used_up";

export interface JoinCodeLike {
  id: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  revoked_at: string | null;
}

export interface JoinAttemptLike {
  join_code_id: string | null;
  outcome: string;
}

export interface JoinCodeAudit {
  status: JoinCodeStatus;
  joined: number;
  /** Tried after the code closed. The main sign it travelled further than intended. */
  lateAttempts: number;
  /** Code was fine but the person couldn't be linked (email taken, needs committee). */
  blocked: number;
}

const LATE_OUTCOMES = new Set(["revoked", "expired", "exhausted"]);
const BLOCKED_OUTCOMES = new Set(["email_taken", "needs_committee"]);

export function joinCodeStatus(code: JoinCodeLike, now: Date): JoinCodeStatus {
  if (code.revoked_at) return "revoked";
  if (new Date(code.expires_at).getTime() <= now.getTime()) return "expired";
  if (code.used_count >= code.max_uses) return "used_up";
  return "active";
}

export function auditJoinCode(
  code: JoinCodeLike,
  attempts: readonly JoinAttemptLike[],
  now: Date,
): JoinCodeAudit {
  let joined = 0;
  let lateAttempts = 0;
  let blocked = 0;
  for (const attempt of attempts) {
    if (attempt.join_code_id !== code.id) continue;
    if (attempt.outcome === "created" || attempt.outcome === "linked") joined++;
    else if (LATE_OUTCOMES.has(attempt.outcome)) lateAttempts++;
    else if (BLOCKED_OUTCOMES.has(attempt.outcome)) blocked++;
  }
  return { status: joinCodeStatus(code, now), joined, lateAttempts, blocked };
}

/** `4m 05s`, `1h 02m`, or `0s` once passed. */
export function formatTimeLeft(expiresAt: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
