"use client";

import { useMemo, useRef, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import {
  isUniqueViolation,
  parseMemberRoster,
  planRosterImport,
  ROSTER_CSV_EXAMPLE,
  type ParsedRoster,
  type RosterPlan,
  type RosterPlanEntry,
} from "@/lib/csv/member-roster";
import { getBrowserClient } from "@/lib/supabase/browser";

/**
 * Bulk roster import for /admin/members.
 *
 * `docs/tele-qr/operations.md` §1.3 budgets member provisioning as "~1 hr for
 * 120 members" on the explicit basis that it is "a bulk import, not a
 * per-person session" -- handles are already collected at club registration.
 * The one-at-a-time create form on this page can't hit that budget; this can.
 *
 * All the parsing/validation/planning logic lives in
 * `src/lib/csv/member-roster.ts` (pure, unit-tested). This component is the
 * three-step shell around it: paste/upload -> preview -> commit.
 *
 * Writes go straight through the anon browser client under the admin's own
 * Supabase Auth session, gated by RLS's `members_admin_all` policy
 * (0009_rls_policies.sql) -- the same path the create form above uses. There
 * is deliberately no /api/admin/* layer in this codebase. Inserting a member
 * fires the `create_member_holder` trigger (0003_holders.sql), so no separate
 * holder step is needed for any of these rows.
 */

/** Rows per insert request. Small enough that one poisoned chunk costs few
 *  per-row retries, large enough that 120 members is ~5 round trips. */
const CHUNK_SIZE = 25;

type Outcome = "created" | "skipped" | "invalid" | "failed";

interface ResultRow {
  line: number;
  label: string;
  outcome: Outcome;
  detail: string;
}

const OUTCOME_TONE: Record<Outcome, "active" | "inactive" | "warning" | "danger"> = {
  created: "active",
  skipped: "inactive",
  invalid: "warning",
  failed: "danger",
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  created: "Created",
  skipped: "Skipped",
  invalid: "Invalid",
  failed: "Failed",
};

export default function MemberImport({ onImported }: { onImported: () => void }) {
  const supabase = useMemo(() => getBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<ParsedRoster | null>(null);
  const [plan, setPlan] = useState<RosterPlan | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [feedback, setFeedback] = useState<{
    variant: "success" | "error" | "info";
    message: string;
  } | null>(null);

  function resetPreview() {
    setParsed(null);
    setPlan(null);
    setResults(null);
  }

  async function handleFile(file: File) {
    const text = await file.text();
    setCsvText(text);
    resetPreview();
    setFeedback({ variant: "info", message: `Loaded ${file.name}. Preview it before importing.` });
  }

  /**
   * Preview = parse + validate locally, then read the existing members so
   * duplicates are shown as "already exists" BEFORE anything is written.
   * This read is what makes a retried half-finished import a no-op.
   */
  async function handlePreview() {
    setFeedback(null);
    setResults(null);
    setPreviewing(true);
    try {
      const parsedRoster = parseMemberRoster(csvText);
      setParsed(parsedRoster);
      if (parsedRoster.fatalError) {
        setPlan(null);
        return;
      }

      const { data, error } = await supabase
        .from("members")
        .select("nus_email, telegram_username");
      if (error) throw error;

      setPlan(planRosterImport(parsedRoster.rows, data ?? []));
    } catch (err) {
      setPlan(null);
      setFeedback({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to build the preview.",
      });
    } finally {
      setPreviewing(false);
    }
  }

  /**
   * Inserts one chunk, falling back to per-row inserts if the chunk fails.
   *
   * Postgres rejects the whole multi-row INSERT on a single UNIQUE violation,
   * so without this fallback one duplicate that slipped past the preview
   * (created by another admin in the meantime) would silently cost 24 good
   * rows. The retry attributes each failure to the row that caused it.
   */
  async function insertChunk(entries: RosterPlanEntry[]): Promise<ResultRow[]> {
    const drafts = entries.map((entry) => entry.row.draft!);
    const { error } = await supabase.from("members").insert(drafts);

    if (!error) {
      return entries.map((entry) => ({
        line: entry.row.line,
        label: entry.row.label,
        outcome: "created" as const,
        detail: "",
      }));
    }

    const out: ResultRow[] = [];
    for (const entry of entries) {
      const { error: rowError } = await supabase.from("members").insert(entry.row.draft!);
      if (!rowError) {
        out.push({ line: entry.row.line, label: entry.row.label, outcome: "created", detail: "" });
      } else if (isUniqueViolation(rowError)) {
        out.push({
          line: entry.row.line,
          label: entry.row.label,
          outcome: "skipped",
          detail: "Already exists (email or Telegram handle is taken).",
        });
      } else {
        out.push({
          line: entry.row.line,
          label: entry.row.label,
          outcome: "failed",
          detail: rowError.message,
        });
      }
    }
    return out;
  }

  async function handleImport() {
    if (!plan) return;
    setImporting(true);
    setFeedback(null);

    const out: ResultRow[] = plan.entries
      .filter((entry) => entry.action === "skip")
      .map((entry) => ({
        line: entry.row.line,
        label: entry.row.label,
        outcome: entry.row.status === "invalid" ? ("invalid" as const) : ("skipped" as const),
        detail: entry.reason ?? "",
      }));

    try {
      const toInsert = plan.entries.filter((entry) => entry.action === "insert");
      for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
        out.push(...(await insertChunk(toInsert.slice(i, i + CHUNK_SIZE))));
      }

      out.sort((a, b) => a.line - b.line);
      setResults(out);
      setPlan(null);
      setParsed(null);

      const created = out.filter((r) => r.outcome === "created").length;
      const failed = out.filter((r) => r.outcome === "failed").length;
      setFeedback({
        variant: failed > 0 ? "error" : "success",
        message:
          `Created ${created} member${created === 1 ? "" : "s"}. ` +
          `Skipped ${out.filter((r) => r.outcome === "skipped").length}, ` +
          `${out.filter((r) => r.outcome === "invalid").length} invalid` +
          (failed > 0
            ? `, ${failed} failed. Fix those rows and re-run — already-created members are skipped, not duplicated.`
            : "."),
      });
      onImported();
    } catch (err) {
      // The import is resumable regardless of where it stopped: everything
      // already inserted is found by the next preview and skipped.
      setFeedback({
        variant: "error",
        message:
          (err instanceof Error ? err.message : "Import failed.") +
          " Nothing was rolled back — re-preview and import again to continue where this stopped.",
      });
    } finally {
      setImporting(false);
    }
  }

  const previewColumns: Column<RosterPlanEntry>[] = [
    { key: "line", header: "Line", render: (e) => e.row.line, className: "tabular-nums" },
    {
      key: "status",
      header: "Action",
      render: (e) =>
        e.action === "insert" ? (
          <StatusPill tone="active">Create</StatusPill>
        ) : e.row.status === "invalid" ? (
          <StatusPill tone="warning">Invalid</StatusPill>
        ) : (
          <StatusPill tone="inactive">Skip</StatusPill>
        ),
    },
    { key: "name", header: "Name", render: (e) => e.row.draft?.full_name ?? e.row.label },
    { key: "email", header: "NUS email", render: (e) => e.row.draft?.nus_email ?? "—" },
    {
      key: "handle",
      header: "Telegram",
      render: (e) =>
        e.row.draft?.telegram_username ? (
          `@${e.row.draft.telegram_username}`
        ) : (
          <span className="text-neutral-500">none — binds later</span>
        ),
    },
    { key: "role", header: "Role", render: (e) => e.row.draft?.role ?? "—" },
    { key: "reason", header: "Note", render: (e) => e.reason ?? "" },
  ];

  const resultColumns: Column<ResultRow>[] = [
    { key: "line", header: "Line", render: (r) => r.line, className: "tabular-nums" },
    {
      key: "outcome",
      header: "Outcome",
      render: (r) => <StatusPill tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</StatusPill>,
    },
    { key: "label", header: "Name", render: (r) => r.label },
    { key: "detail", header: "Detail", render: (r) => r.detail || "" },
  ];

  return (
    <Card
      title="Bulk import from CSV"
      actions={
        <Button
          variant="secondary"
          className="min-h-0 px-2 py-1 text-xs"
          onClick={() => {
            setOpen((prev) => !prev);
            if (open) {
              resetPreview();
              setFeedback(null);
            }
          }}
        >
          {open ? "Close" : "Open importer"}
        </Button>
      }
      padded={false}
    >
      {!open ? (
        <p className="p-4 text-sm text-neutral-400">
          Provision the whole roster in one pass instead of one member at a time. Handles are
          normalised (lowercased, leading <code className="rounded bg-neutral-800 px-1 py-0.5 text-xs">@</code>{" "}
          stripped), duplicates are skipped rather than failing the batch, and members with no
          Telegram handle are imported normally — they bind through the bind queue later.
        </p>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          {feedback ? (
            <Toast
              variant={feedback.variant}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
          ) : null}

          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            Roster CSV
            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                resetPreview();
              }}
              rows={8}
              spellCheck={false}
              placeholder={ROSTER_CSV_EXAMPLE}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100"
            />
            <span className="text-xs text-neutral-400">
              First row must be a header. Recognised columns: <code>full_name</code> (required),{" "}
              <code>display_name</code>, <code>nus_email</code>, <code>telegram_username</code>,{" "}
              <code>role</code>, <code>joined_at</code> (YYYY-MM-DD). Anything else is ignored.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="secondary"
              className="min-h-0 px-2 py-1 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload file
            </Button>
            <Button
              className="min-h-0 px-2 py-1 text-xs"
              disabled={previewing || importing || !csvText.trim()}
              onClick={handlePreview}
            >
              {previewing ? "Checking…" : "Preview"}
            </Button>
            {csvText ? (
              <Button
                variant="ghost"
                className="min-h-0 px-2 py-1 text-xs"
                disabled={importing}
                onClick={() => {
                  setCsvText("");
                  resetPreview();
                  setFeedback(null);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {parsed?.fatalError ? <Toast variant="error" message={parsed.fatalError} /> : null}

          {parsed && !parsed.fatalError && parsed.ignoredColumns.length > 0 ? (
            <p className="text-xs text-neutral-400">
              Ignored unrecognised column{parsed.ignoredColumns.length === 1 ? "" : "s"}:{" "}
              {parsed.ignoredColumns.join(", ")}
            </p>
          ) : null}

          {plan ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-neutral-300">
                <span className="font-medium text-neutral-100">{plan.toInsert}</span> to create,{" "}
                {plan.skippedDuplicate} already exist (skipped), {plan.invalid} invalid.
              </p>
              <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-800">
                <DataTable
                  columns={previewColumns}
                  rows={plan.entries}
                  rowKey={(e) => String(e.row.line)}
                  emptyMessage="No data rows found under the header."
                />
              </div>
              <div>
                <Button disabled={importing || plan.toInsert === 0} onClick={handleImport}>
                  {importing
                    ? "Importing…"
                    : `Import ${plan.toInsert} member${plan.toInsert === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          ) : null}

          {results ? (
            <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-800">
              <DataTable
                columns={resultColumns}
                rows={results}
                rowKey={(r) => String(r.line)}
                emptyMessage="Nothing was imported."
              />
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
