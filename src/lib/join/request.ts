/**
 * The join form's body, and what each join_with_code() outcome means to the
 * person holding the phone. Pure and shared by /api/store/join and the Mini
 * App form, so the two cannot disagree about what is valid.
 */

import { isValidEmail } from "@/lib/csv/member-roster";

import { isWellFormedJoinCode, normalizeJoinCode } from "./code";

export interface JoinRequestBody {
  code: string;
  fullName: string;
  displayName: string | null;
  email: string;
}

export type JoinField = "code" | "fullName" | "displayName" | "email" | "acceptedNotice";

export type JoinValidation =
  | { ok: true; body: JoinRequestBody }
  | { ok: false; errors: Partial<Record<JoinField, string>> };

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateJoinRequest(raw: unknown): JoinValidation {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: Partial<Record<JoinField, string>> = {};

  const code = normalizeJoinCode(text(input.code));
  if (!code) errors.code = "Enter the join code a committee member gave you.";
  else if (!isWellFormedJoinCode(code)) errors.code = "Join codes are 8 letters and digits, like ABCD-EF23.";

  const fullName = text(input.fullName).replace(/\s+/g, " ");
  if (!fullName) errors.fullName = "Enter your full name.";
  else if (fullName.length > MAX_NAME_LENGTH) errors.fullName = "That name is too long.";

  const displayName = text(input.displayName).replace(/\s+/g, " ");
  if (displayName.length > MAX_NAME_LENGTH) errors.displayName = "That name is too long.";

  const email = text(input.email).toLowerCase();
  if (!email) errors.email = "Enter your NUS email.";
  else if (email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
    errors.email = "That doesn't look like an email address.";
  }

  if (input.acceptedNotice !== true) {
    errors.acceptedNotice = "Please read and accept the notice to continue.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { code, fullName, displayName: displayName || null, email } };
}

export const JOIN_OUTCOMES = [
  "created",
  "linked",
  "already_member",
  "inactive",
  "unknown_code",
  "revoked",
  "expired",
  "exhausted",
  "email_taken",
  "needs_committee",
  "rate_limited",
] as const;

export type JoinOutcome = (typeof JOIN_OUTCOMES)[number];

export function isJoinOutcome(value: unknown): value is JoinOutcome {
  return typeof value === "string" && (JOIN_OUTCOMES as readonly string[]).includes(value);
}

/** Outcomes after which the person can use the store. */
export function isJoinSuccess(outcome: JoinOutcome): boolean {
  return outcome === "created" || outcome === "linked" || outcome === "already_member";
}

export function joinOutcomeStatus(outcome: JoinOutcome): number {
  switch (outcome) {
    case "created":
    case "linked":
    case "already_member":
      return 200;
    case "unknown_code":
    case "revoked":
    case "expired":
    case "exhausted":
    case "inactive":
      return 403;
    case "email_taken":
    case "needs_committee":
      return 409;
    case "rate_limited":
      return 429;
  }
}

/**
 * Deliberately specific: "that code has been used up" tells an honest
 * latecomer exactly who to ask, and a leaked code gains nothing from it
 * because every attempt is logged either way.
 */
export function joinOutcomeMessage(outcome: JoinOutcome): string {
  switch (outcome) {
    case "created":
      return "You're in. You can borrow and return parts now.";
    case "linked":
      return "Found you on the club roster and linked your Telegram. You're all set.";
    case "already_member":
      return "You're already registered.";
    case "inactive":
      return "Your membership is deactivated. Ask a committee member to reactivate it.";
    case "unknown_code":
      return "That join code isn't right. Check it and try again.";
    case "revoked":
      return "That join code has been cancelled. Ask a committee member for a new one.";
    case "expired":
      return "That join code has expired. Ask a committee member for a new one.";
    case "exhausted":
      return "That join code has been used up. Ask a committee member for a new one.";
    case "email_taken":
      return "That email is already linked to another Telegram account. Ask a committee member to sort it out.";
    case "needs_committee":
      return "We found a club record for you that a committee member needs to link by hand. Ask one to check the bind queue.";
    case "rate_limited":
      return "Too many attempts. Wait 15 minutes and try again.";
  }
}
