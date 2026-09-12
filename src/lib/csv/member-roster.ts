/**
 * Member roster CSV parsing + validation — pure, no DB, no network, no Node.
 *
 * Why this exists: `docs/tele-qr/operations.md` §1.3 budgets provisioning
 * ~120 members as "a bulk import, not a per-person session" ("handles are
 * already collected at club registration"), but `/admin/members` only had a
 * one-at-a-time create form. This module is the testable half of the bulk
 * importer; `src/app/admin/members/MemberImport.tsx` is the UI around it.
 *
 * Two rules from the docs drive the validation shape:
 *
 *  1. **A missing Telegram handle is VALID, not an error.** operations.md
 *     §1.3 expects "~10-20% to fail the automatic bind — no username set, or
 *     handle changed since registration", and they "land in the dashboard's
 *     bind queue". Rejecting handle-less rows would lock out exactly the
 *     people the bind queue exists to serve.
 *  2. **One bad row must not fail the batch.** Every row carries its own
 *     status and its own reason, so a 120-row paste with three typos imports
 *     117 members and tells you about the three.
 *
 * `nus_email` and `telegram_username` are both UNIQUE in the schema
 * (`supabase/migrations/0002_members_and_bind_attempts.sql`), so duplicates
 * are the expected failure mode on a re-run of a half-finished import —
 * hence both in-file duplicate detection (here) and against-the-DB duplicate
 * detection (`planRosterImport`).
 */

import { normalizeTelegramHandle } from "@/lib/utils/normalize";

import { parseCsv } from "./parse";

export type MemberRole = "member" | "admin";

/** The exact shape inserted into `members`. Nulls, not empty strings — the
 *  UNIQUE indexes on nus_email/telegram_username treat every '' as equal,
 *  so a second handle-less row would collide on ''. */
export interface RosterMemberDraft {
  full_name: string;
  display_name: string | null;
  nus_email: string | null;
  telegram_username: string | null;
  role: MemberRole;
  joined_at: string | null;
}

export type RosterRowStatus = "valid" | "invalid" | "duplicate_in_file";

export interface RosterRow {
  /** 1-based line number in the pasted CSV, counting the header row as 1. */
  line: number;
  /** Best-effort label for the row even when it failed to validate. */
  label: string;
  status: RosterRowStatus;
  /** Populated for `valid` rows only. */
  draft: RosterMemberDraft | null;
  /** Human-readable reasons, one per problem. Empty for `valid`. */
  errors: string[];
}

export interface ParsedRoster {
  /** Canonical field names resolved from the header row, in file order. */
  recognizedColumns: RosterField[];
  /** Header cells that matched no known field. Ignored, but worth surfacing. */
  ignoredColumns: string[];
  rows: RosterRow[];
  /** A problem with the FILE (not a row) that makes the whole import
   *  impossible — e.g. no header row, or no `full_name` column. */
  fatalError: string | null;
}

export type RosterField =
  | "full_name"
  | "display_name"
  | "nus_email"
  | "telegram_username"
  | "role"
  | "joined_at";

/**
 * Header aliases, matched after normalising the header cell to lowercase
 * words (so `Telegram_Username`, `telegram username` and `TELEGRAM USERNAME`
 * are all the same key). Generous on purpose: the roster arrives as whatever
 * the registration form exported, and making a committee member rename
 * columns by hand before importing is exactly the friction operations.md
 * warns kills adoption.
 */
const HEADER_ALIASES: Record<RosterField, string[]> = {
  full_name: ["full name", "fullname", "name", "member name", "student name"],
  display_name: ["display name", "displayname", "nickname", "preferred name", "short name"],
  nus_email: ["nus email", "email", "email address", "nus email address", "e mail"],
  telegram_username: [
    "telegram username",
    "telegram handle",
    "telegram",
    "handle",
    "username",
    "tele",
    "tele handle",
    "telegram id",
  ],
  role: ["role", "access", "access level"],
  joined_at: ["joined at", "joined", "join date", "date joined", "joined on"],
};

/** Lowercase, and collapse `_`/`-`/runs of whitespace to single spaces. */
export function normalizeHeaderCell(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveHeaderField(raw: string): RosterField | null {
  const key = normalizeHeaderCell(raw);
  if (!key) return null;
  for (const field of Object.keys(HEADER_ALIASES) as RosterField[]) {
    if (HEADER_ALIASES[field].includes(key)) return field;
  }
  return null;
}

// Deliberately loose: this catches "not an email at all", not "not a real
// mailbox". A club roster carries @u.nus.edu, @nus.edu.sg and the occasional
// personal address, and rejecting the third would be wrong.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Telegram's own rule: 5-32 characters, letters/digits/underscore.
// https://core.telegram.org/method/account.checkUsername
const TELEGRAM_HANDLE_RE = /^[a-z0-9_]{5,32}$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

/** Applies to an ALREADY-normalised handle (see normalizeTelegramHandle). */
export function isValidTelegramHandle(normalized: string): boolean {
  return TELEGRAM_HANDLE_RE.test(normalized);
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Rejects 2026-02-31, which Date happily rolls over into March.
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates one already-split row into a draft. Returns the draft plus the
 * list of reasons it can't be inserted — never throws, never guesses.
 */
export function validateRosterValues(
  values: Partial<Record<RosterField, string>>,
): { draft: RosterMemberDraft | null; errors: string[] } {
  const errors: string[] = [];

  const fullName = (values.full_name ?? "").trim();
  if (!fullName) errors.push("Full name is required.");

  const displayName = (values.display_name ?? "").trim();

  const rawEmail = (values.nus_email ?? "").trim();
  let email: string | null = null;
  if (rawEmail) {
    email = rawEmail.toLowerCase();
    if (!isValidEmail(email)) {
      errors.push(`"${rawEmail}" is not a valid email address.`);
      email = null;
    }
  }

  // No handle at all is fine — operations.md §1.3 expects 10-20% of the
  // roster to have none and to bind via the bind queue later.
  const rawHandle = (values.telegram_username ?? "").trim();
  let handle: string | null = null;
  if (rawHandle) {
    const normalized = normalizeTelegramHandle(rawHandle);
    if (!normalized) {
      handle = null;
    } else if (!isValidTelegramHandle(normalized)) {
      errors.push(
        `"${rawHandle}" is not a valid Telegram username (5-32 characters, letters, digits and underscore only).`,
      );
    } else {
      handle = normalized;
    }
  }

  const rawRole = (values.role ?? "").trim().toLowerCase();
  let role: MemberRole = "member";
  if (rawRole) {
    if (rawRole === "member" || rawRole === "admin") {
      role = rawRole;
    } else {
      errors.push(`Role must be "member" or "admin", got "${values.role?.trim()}".`);
    }
  }

  const rawJoined = (values.joined_at ?? "").trim();
  let joinedAt: string | null = null;
  if (rawJoined) {
    if (isValidIsoDate(rawJoined)) {
      joinedAt = rawJoined;
    } else {
      errors.push(`Joined date "${rawJoined}" must be in YYYY-MM-DD form.`);
    }
  }

  if (errors.length > 0) return { draft: null, errors };

  return {
    draft: {
      full_name: fullName,
      display_name: displayName || null,
      nus_email: email,
      telegram_username: handle,
      role,
      joined_at: joinedAt,
    },
    errors: [],
  };
}

/**
 * Parses a pasted/uploaded roster CSV into per-row drafts.
 *
 * Rows that are entirely blank are dropped silently (trailing newlines and
 * spacer rows are normal in exported spreadsheets and are not a user error).
 * Everything else produces exactly one RosterRow, in file order.
 */
export function parseMemberRoster(csvText: string): ParsedRoster {
  const empty: ParsedRoster = {
    recognizedColumns: [],
    ignoredColumns: [],
    rows: [],
    fatalError: null,
  };

  if (!csvText.trim()) {
    return { ...empty, fatalError: "Nothing to import — paste or upload a CSV first." };
  }

  const grid = parseCsv(csvText);
  const headerCells = grid[0] ?? [];

  const columnFields: (RosterField | null)[] = headerCells.map(resolveHeaderField);
  const recognizedColumns = columnFields.filter((f): f is RosterField => f !== null);
  const ignoredColumns = headerCells.filter((cell, i) => columnFields[i] === null && cell.trim() !== "");

  if (!recognizedColumns.includes("full_name")) {
    return {
      ...empty,
      recognizedColumns,
      ignoredColumns,
      fatalError:
        "No recognised name column. The first row must be a header containing at least " +
        '"full_name" (also accepted: "name"). Optional columns: display_name, nus_email, ' +
        "telegram_username, role, joined_at.",
    };
  }

  const rows: RosterRow[] = [];
  // Keyed by the value; holds the line number of the first row that claimed it.
  const seenEmails = new Map<string, number>();
  const seenHandles = new Map<string, number>();

  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.every((cell) => cell.trim() === "")) continue;

    const line = i + 1;
    const values: Partial<Record<RosterField, string>> = {};
    columnFields.forEach((field, columnIndex) => {
      if (!field) return;
      // Last non-empty wins if the same field is mapped twice (a roster with
      // both "Telegram" and "handle" columns, one of which is blank).
      const cell = cells[columnIndex] ?? "";
      if (cell.trim() !== "" || values[field] === undefined) values[field] = cell;
    });

    const label = (values.full_name ?? "").trim() || (values.nus_email ?? "").trim() || `Row ${line}`;
    const { draft, errors } = validateRosterValues(values);

    if (!draft) {
      rows.push({ line, label, status: "invalid", draft: null, errors });
      continue;
    }

    // In-file duplicates: the first row to claim an email/handle wins, later
    // ones are reported rather than left to fail on the UNIQUE index at
    // insert time (where the error message names a constraint, not a person).
    const duplicateErrors: string[] = [];
    if (draft.nus_email) {
      const firstLine = seenEmails.get(draft.nus_email);
      if (firstLine !== undefined) {
        duplicateErrors.push(`Email ${draft.nus_email} already appears on line ${firstLine} of this file.`);
      }
    }
    if (draft.telegram_username) {
      const firstLine = seenHandles.get(draft.telegram_username);
      if (firstLine !== undefined) {
        duplicateErrors.push(
          `Telegram handle @${draft.telegram_username} already appears on line ${firstLine} of this file.`,
        );
      }
    }

    if (duplicateErrors.length > 0) {
      rows.push({ line, label, status: "duplicate_in_file", draft, errors: duplicateErrors });
      continue;
    }

    if (draft.nus_email) seenEmails.set(draft.nus_email, line);
    if (draft.telegram_username) seenHandles.set(draft.telegram_username, line);
    rows.push({ line, label, status: "valid", draft, errors: [] });
  }

  return { recognizedColumns, ignoredColumns, rows, fatalError: null };
}

// ---------------------------------------------------------------------------
// Planning against what's already in the DB.
// ---------------------------------------------------------------------------

/** The subset of an existing `members` row that can collide with an import. */
export interface ExistingMemberKey {
  nus_email: string | null;
  telegram_username: string | null;
}

export type RosterAction = "insert" | "skip";

export interface RosterPlanEntry {
  row: RosterRow;
  action: RosterAction;
  /** Why this row is being skipped. Null when action is "insert". */
  reason: string | null;
}

export interface RosterPlan {
  entries: RosterPlanEntry[];
  toInsert: number;
  skippedDuplicate: number;
  invalid: number;
}

/**
 * Decides what actually gets inserted, given the members already in the DB.
 *
 * This is what makes the import **safely re-runnable**: a half-finished
 * import that is retried finds its already-created rows here and skips them,
 * so re-pasting the same 120-row file creates zero duplicates. Pre-checking
 * is belt; the UI's per-row retry on a chunk failure is braces, since a
 * concurrent admin could create a colliding row between the read and the
 * write and only the UNIQUE index can settle that race.
 */
export function planRosterImport(rows: RosterRow[], existing: ExistingMemberKey[]): RosterPlan {
  const existingEmails = new Set<string>();
  const existingHandles = new Set<string>();
  for (const member of existing) {
    if (member.nus_email) existingEmails.add(member.nus_email.trim().toLowerCase());
    if (member.telegram_username) existingHandles.add(normalizeTelegramHandle(member.telegram_username));
  }

  const entries: RosterPlanEntry[] = rows.map((row) => {
    if (row.status === "invalid") {
      return { row, action: "skip" as const, reason: row.errors.join(" ") };
    }
    if (row.status === "duplicate_in_file") {
      return { row, action: "skip" as const, reason: row.errors.join(" ") };
    }

    const draft = row.draft!;
    if (draft.nus_email && existingEmails.has(draft.nus_email)) {
      return {
        row,
        action: "skip" as const,
        reason: `A member with email ${draft.nus_email} already exists.`,
      };
    }
    if (draft.telegram_username && existingHandles.has(draft.telegram_username)) {
      return {
        row,
        action: "skip" as const,
        reason: `A member with Telegram handle @${draft.telegram_username} already exists.`,
      };
    }
    return { row, action: "insert" as const, reason: null };
  });

  return {
    entries,
    toInsert: entries.filter((e) => e.action === "insert").length,
    skippedDuplicate: entries.filter(
      (e) => e.action === "skip" && e.row.status !== "invalid",
    ).length,
    invalid: entries.filter((e) => e.row.status === "invalid").length,
  };
}

/**
 * `true` if a Postgres error is a UNIQUE-violation on members — i.e. "someone
 * else already has this email/handle", which is a per-row *skip*, not a
 * failed import. 23505 is Postgres's unique_violation SQLSTATE.
 */
export function isUniqueViolation(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "23505";
}

/** A short, quotable sample roster for the UI's "what should this look like" hint. */
export const ROSTER_CSV_EXAMPLE = [
  "full_name,display_name,nus_email,telegram_username,role,joined_at",
  "Alex Tan,Alex,alex.tan@u.nus.edu,@AlexTan_NUS,member,2026-08-01",
  "Priya Nair,Priya,priya.nair@u.nus.edu,,member,2026-08-01",
].join("\n");
