import { describe, expect, it } from "vitest";

import {
  isUniqueViolation,
  isValidIsoDate,
  isValidTelegramHandle,
  normalizeHeaderCell,
  parseMemberRoster,
  planRosterImport,
  validateRosterValues,
  type RosterRow,
} from "@/lib/csv/member-roster";
import {
  buildOffboardPatch,
  buildUnbindPatch,
  todayIsoDate,
} from "@/app/admin/members/memberLifecycle";

// ---------------------------------------------------------------------------
// tests/unit/member-roster.test.ts
//
// Pure -- no network, no DB. Covers the bulk roster importer's parsing and
// validation (src/lib/csv/member-roster.ts) and the offboard/unbind patch
// builders (src/app/admin/members/memberLifecycle.ts).
//
// The cases that matter most come straight from the docs rather than from
// imagination:
//  * operations.md §1.3 -- handles are normalised (lowercase, strip `@`), and
//    ~10-20% of the roster has NO handle at all, which must be valid.
//  * The schema's UNIQUE constraints on nus_email / telegram_username -- so
//    duplicates within one file, and against the DB, must be reported per-row
//    rather than blowing up the batch.
//  * pdpa.md -- offboarding unlinks, it never deletes.
// ---------------------------------------------------------------------------

describe("normalizeHeaderCell", () => {
  it("folds case, underscores, hyphens and runs of whitespace", () => {
    expect(normalizeHeaderCell("Full_Name")).toBe("full name");
    expect(normalizeHeaderCell("  TELEGRAM-HANDLE ")).toBe("telegram handle");
    expect(normalizeHeaderCell("NUS   Email")).toBe("nus email");
  });
});

describe("validateRosterValues — Telegram handle normalisation", () => {
  it("strips a leading @ and lowercases", () => {
    const { draft, errors } = validateRosterValues({
      full_name: "Alex Tan",
      telegram_username: "@AlexTan_NUS",
    });
    expect(errors).toEqual([]);
    expect(draft?.telegram_username).toBe("alextan_nus");
  });

  it("lowercases an already-bare handle", () => {
    const { draft } = validateRosterValues({ full_name: "A", telegram_username: "HANDLE_X" });
    expect(draft?.telegram_username).toBe("handle_x");
  });

  it("trims surrounding whitespace around the @", () => {
    const { draft } = validateRosterValues({
      full_name: "A",
      telegram_username: "   @Priya_Nair   ",
    });
    expect(draft?.telegram_username).toBe("priya_nair");
  });

  it("treats an absent handle as VALID with a null handle, not an error", () => {
    // operations.md §1.3: ~10-20% have no username set; they bind via the
    // bind queue later. Rejecting them here would lock out exactly the people
    // the bind queue exists for.
    for (const value of ["", "   ", undefined]) {
      const { draft, errors } = validateRosterValues({
        full_name: "No Handle Person",
        telegram_username: value,
      });
      expect(errors, `value: ${JSON.stringify(value)}`).toEqual([]);
      expect(draft?.telegram_username).toBeNull();
    }
  });

  it("flags a handle that is PRESENT but normalises away to nothing", () => {
    // A bare "@" is not an empty cell: it used to import as a member with no
    // handle and no warning -- someone who can never auto-bind, and whose row
    // told the importing admin nothing. An empty cell stays valid (above);
    // this one is the admin's to fix.
    for (const value of ["@", " @ "]) {
      const { draft, errors } = validateRosterValues({
        full_name: "Typo Person",
        telegram_username: value,
      });
      expect(draft, `value: ${JSON.stringify(value)}`).toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(value.trim());
      // The message has to tell them what to do instead, or they will just
      // delete the person.
      expect(errors[0]).toContain("Leave the cell empty");
    }

    // "@@" normalises to "@", which is a non-empty but illegal handle: still
    // invalid, just caught by Telegram's own character rule instead.
    expect(validateRosterValues({ full_name: "T", telegram_username: "@@" }).draft).toBeNull();
  });

  it("rejects handles Telegram itself would reject, naming the raw value", () => {
    const { draft, errors } = validateRosterValues({
      full_name: "A",
      telegram_username: "ab c!",
    });
    expect(draft).toBeNull();
    expect(errors[0]).toContain("ab c!");
  });

  it("enforces Telegram's 5-32 character range", () => {
    expect(isValidTelegramHandle("abcd")).toBe(false);
    expect(isValidTelegramHandle("abcde")).toBe(true);
    expect(isValidTelegramHandle("a".repeat(32))).toBe(true);
    expect(isValidTelegramHandle("a".repeat(33))).toBe(false);
    expect(isValidTelegramHandle("has.dot")).toBe(false);
  });
});

describe("validateRosterValues — other fields", () => {
  it("requires a full name", () => {
    const { draft, errors } = validateRosterValues({ full_name: "   ", nus_email: "a@b.com" });
    expect(draft).toBeNull();
    expect(errors).toContain("Full name is required.");
  });

  it("lowercases the email and nulls empty strings (not '')", () => {
    // '' would collide on the UNIQUE index for every handle-less member.
    const { draft } = validateRosterValues({ full_name: "A", nus_email: "  Alex.Tan@U.NUS.edu " });
    expect(draft?.nus_email).toBe("alex.tan@u.nus.edu");
    expect(validateRosterValues({ full_name: "A" }).draft?.nus_email).toBeNull();
    expect(validateRosterValues({ full_name: "A" }).draft?.display_name).toBeNull();
  });

  it("rejects a non-email", () => {
    const { draft, errors } = validateRosterValues({ full_name: "A", nus_email: "not an email" });
    expect(draft).toBeNull();
    expect(errors[0]).toContain("not a valid email");
  });

  it("defaults role to member and accepts admin and procurement, case-insensitively", () => {
    expect(validateRosterValues({ full_name: "A" }).draft?.role).toBe("member");
    expect(validateRosterValues({ full_name: "A", role: "Admin" }).draft?.role).toBe("admin");
    expect(validateRosterValues({ full_name: "A", role: "Procurement" }).draft?.role).toBe("procurement");
    expect(validateRosterValues({ full_name: "A", role: "owner" }).errors[0]).toContain("Role must be");
  });

  it("accepts an ISO joined date and rejects anything else", () => {
    expect(validateRosterValues({ full_name: "A", joined_at: "2026-08-01" }).draft?.joined_at).toBe(
      "2026-08-01",
    );
    expect(validateRosterValues({ full_name: "A", joined_at: "01/08/2026" }).errors).toHaveLength(1);
    expect(isValidIsoDate("2026-02-31")).toBe(false); // Date would roll this into March
    expect(isValidIsoDate("2026-02-28")).toBe(true);
  });

  it("reports every problem in one row rather than stopping at the first", () => {
    const { errors } = validateRosterValues({
      full_name: "",
      nus_email: "nope",
      telegram_username: "!!",
      role: "wizard",
      joined_at: "yesterday",
    });
    expect(errors).toHaveLength(5);
  });
});

describe("parseMemberRoster", () => {
  it("parses a normal roster, honouring header aliases and ignoring extra columns", () => {
    const csv = [
      "Name,Display Name,Email,Telegram Handle,Role,Joined,Matric",
      "Alex Tan,Alex,Alex.Tan@u.nus.edu,@AlexTan_NUS,member,2026-08-01,A0123456X",
      "Priya Nair,Priya,priya.nair@u.nus.edu,,,2026-08-01,A0123457Y",
    ].join("\n");

    const parsed = parseMemberRoster(csv);
    expect(parsed.fatalError).toBeNull();
    expect(parsed.ignoredColumns).toEqual(["Matric"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ line: 2, status: "valid" });
    expect(parsed.rows[0].draft).toEqual({
      full_name: "Alex Tan",
      display_name: "Alex",
      nus_email: "alex.tan@u.nus.edu",
      telegram_username: "alextan_nus",
      role: "member",
      joined_at: "2026-08-01",
    });
    expect(parsed.rows[1].draft?.telegram_username).toBeNull();
    expect(parsed.rows[1].draft?.role).toBe("member");
  });

  it("refuses a file with no recognisable name column", () => {
    const parsed = parseMemberRoster("handle,email\n@alex,a@b.com");
    expect(parsed.fatalError).toContain("No recognised name column");
    expect(parsed.rows).toEqual([]);
  });

  it("refuses empty input", () => {
    expect(parseMemberRoster("   ").fatalError).toContain("Nothing to import");
  });

  it("skips entirely blank rows without reporting them as errors", () => {
    const parsed = parseMemberRoster("full_name\nAlex Tan\n\n   \nPriya Nair\n");
    expect(parsed.rows.map((r) => r.label)).toEqual(["Alex Tan", "Priya Nair"]);
  });

  it("keeps quoted commas inside a field (shared parseCsv)", () => {
    const parsed = parseMemberRoster('full_name,display_name\n"Tan, Alex",Alex');
    expect(parsed.rows[0].draft?.full_name).toBe("Tan, Alex");
  });

  it("flags an in-file duplicate email, naming the earlier line, and keeps the first", () => {
    const csv = [
      "full_name,nus_email",
      "Alex Tan,alex@u.nus.edu",
      "Alexander Tan,ALEX@u.nus.edu", // same address, different case
    ].join("\n");

    const parsed = parseMemberRoster(csv);
    expect(parsed.rows[0].status).toBe("valid");
    expect(parsed.rows[1].status).toBe("duplicate_in_file");
    expect(parsed.rows[1].errors[0]).toContain("line 2");
  });

  it("flags an in-file duplicate handle across differing @/case spellings", () => {
    const csv = [
      "full_name,telegram_username",
      "Alex Tan,alextan_nus",
      "Alex T,@AlexTan_NUS",
    ].join("\n");

    const parsed = parseMemberRoster(csv);
    expect(parsed.rows[1].status).toBe("duplicate_in_file");
    expect(parsed.rows[1].errors[0]).toContain("@alextan_nus");
  });

  it("does NOT treat two handle-less, email-less rows as duplicates of each other", () => {
    // Both normalise to null, and null is not a value that collides.
    const parsed = parseMemberRoster("full_name,telegram_username\nAlex Tan,\nPriya Nair,");
    expect(parsed.rows.every((r) => r.status === "valid")).toBe(true);
  });

  it("keeps one bad row from poisoning the rest of the batch", () => {
    const csv = [
      "full_name,nus_email,telegram_username",
      "Good One,good@u.nus.edu,@GoodOne",
      ",orphan@u.nus.edu,@orphan",
      "Also Good,also@u.nus.edu,",
    ].join("\n");

    const parsed = parseMemberRoster(csv);
    expect(parsed.rows.map((r) => r.status)).toEqual(["valid", "invalid", "valid"]);
    expect(parsed.rows[1].label).toBe("orphan@u.nus.edu"); // falls back to email for the label
  });
});

describe("planRosterImport", () => {
  const rows = (csv: string): RosterRow[] => parseMemberRoster(csv).rows;

  const CSV = [
    "full_name,nus_email,telegram_username",
    "Alex Tan,alex@u.nus.edu,@AlexTan_NUS",
    "Priya Nair,priya@u.nus.edu,",
    ",bad@u.nus.edu,",
  ].join("\n");

  it("inserts everything when the DB is empty", () => {
    const plan = planRosterImport(rows(CSV), []);
    expect(plan.toInsert).toBe(2);
    expect(plan.invalid).toBe(1);
    // `skippedDuplicate` counts only rows skipped for *existing elsewhere*
    // reasons, so an invalid row is not double-counted as a duplicate.
    expect(plan.skippedDuplicate).toBe(0);
    expect(plan.entries).toHaveLength(3);
  });

  it("skips a row whose email already exists, regardless of stored case", () => {
    const plan = planRosterImport(rows(CSV), [
      { nus_email: "ALEX@u.nus.edu", telegram_username: null },
    ]);
    expect(plan.toInsert).toBe(1);
    const alex = plan.entries.find((e) => e.row.line === 2)!;
    expect(alex.action).toBe("skip");
    expect(alex.reason).toContain("already exists");
  });

  it("skips a row whose handle already exists, normalising the stored value", () => {
    const plan = planRosterImport(rows(CSV), [
      { nus_email: null, telegram_username: "@AlexTan_NUS" },
    ]);
    expect(plan.entries.find((e) => e.row.line === 2)!.action).toBe("skip");
  });

  it("is a no-op when re-run against a DB that already has the whole roster", () => {
    // The re-runnability guarantee: a half-finished import that gets retried
    // must not create duplicates.
    const existing = rows(CSV)
      .filter((r) => r.draft)
      .map((r) => ({
        nus_email: r.draft!.nus_email,
        telegram_username: r.draft!.telegram_username,
      }));
    const plan = planRosterImport(rows(CSV), existing);
    expect(plan.toInsert).toBe(0);
    expect(plan.entries.every((e) => e.action === "skip")).toBe(true);
  });

  it("does not let a NULL-handled existing member swallow every handle-less row", () => {
    const plan = planRosterImport(rows(CSV), [{ nus_email: null, telegram_username: null }]);
    expect(plan.toInsert).toBe(2);
  });
});

describe("isUniqueViolation", () => {
  it("recognises Postgres 23505 only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("member lifecycle patches (pdpa.md)", () => {
  it("unbind clears only the binding fields", () => {
    // Notably NOT telegram_username: the handle is roster data the bind queue
    // matches on, so clearing it would make the member unmatchable on /start.
    expect(buildUnbindPatch()).toEqual({ telegram_user_id: null, telegram_bound_at: null });
    expect(Object.keys(buildUnbindPatch())).toHaveLength(2);
  });

  it("offboard clears the binding, deactivates, and stamps left_at", () => {
    expect(buildOffboardPatch("2026-09-12")).toEqual({
      telegram_user_id: null,
      telegram_bound_at: null,
      active: false,
      left_at: "2026-09-12",
    });
  });

  it("offboard never deletes: the patch touches no history-bearing column", () => {
    const keys = Object.keys(buildOffboardPatch("2026-09-12"));
    // pdpa.md retains the member record and the borrowing history; the patch
    // must not reach for full_name, nus_email or anything in stock_movements.
    expect(keys.sort()).toEqual(["active", "left_at", "telegram_bound_at", "telegram_user_id"]);
  });

  it("offboard preserves an existing left_at rather than rewriting it", () => {
    expect(buildOffboardPatch("2026-09-12", "2025-05-01").left_at).toBe("2025-05-01");
  });

  it("todayIsoDate uses the LOCAL date, not UTC", () => {
    // members.left_at is a `date`. Built from toISOString(), a Singapore admin
    // clicking offboard at 01:00 SGT would stamp yesterday.
    const localMidnightIsh = new Date(2026, 8, 12, 1, 0, 0); // 12 Sep 2026, 01:00 local
    expect(todayIsoDate(localMidnightIsh)).toBe("2026-09-12");
    expect(todayIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05"); // zero-padding
  });
});
