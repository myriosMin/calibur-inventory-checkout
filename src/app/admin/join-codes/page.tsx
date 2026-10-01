"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import Drawer from "@/components/admin/Drawer";
import EmptyState from "@/components/admin/EmptyState";
import { CAPTION, FIELD, HELP, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import StatusPill, { type StatusTone } from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconChevronDown, IconPlus } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import { encodeQrSymbol } from "@/lib/codes/qr";
import {
  JOIN_DEFAULT_MAX_USES,
  JOIN_DEFAULT_VALID_MINUTES,
  JOIN_MAX_USES_LIMIT,
  JOIN_VALID_MINUTES_LIMIT,
  buildJoinUrl,
  formatJoinCode,
  generateJoinCode,
} from "@/lib/join/code";
import { auditJoinCode, formatTimeLeft, type JoinCodeStatus } from "@/lib/join/audit";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

type JoinCode = Database["public"]["Tables"]["join_codes"]["Row"];
type Attempt = Database["public"]["Tables"]["join_code_attempts"]["Row"] & {
  members: { full_name: string; display_name: string | null } | null;
};

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
const APP_NAME = process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "";
const CODE_LIMIT = 30;
const ATTEMPT_LIMIT = 500;
const REFRESH_MS = 10_000;

const STATUS_TONE: Record<JoinCodeStatus, StatusTone> = {
  active: "active",
  revoked: "inactive",
  expired: "inactive",
  used_up: "inactive",
};

const STATUS_LABEL: Record<JoinCodeStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  used_up: "Used up",
};

const OUTCOME_LABEL: Record<string, string> = {
  created: "Joined (new)",
  linked: "Joined (linked to roster)",
  unknown_code: "Wrong code",
  revoked: "Code revoked",
  expired: "Code expired",
  exhausted: "Code used up",
  email_taken: "Email already linked",
  needs_committee: "Sent to bind queue",
  rate_limited: "Rate limited",
};

function joinUrlFor(code: string): string | null {
  try {
    return buildJoinUrl(BOT_USERNAME, APP_NAME, code);
  } catch {
    return null;
  }
}

/**
 * Issue join codes and watch them being used. Admin-only by RLS
 * (0026_join_codes.sql); the nav hiding it from procurement is cosmetic.
 */
export default function AdminJoinCodesPage() {
  const supabase = getBrowserClient();

  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [hasActive, setHasActive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [maxUses, setMaxUses] = useState(String(JOIN_DEFAULT_MAX_USES));
  const [validMinutes, setValidMinutes] = useState(String(JOIN_DEFAULT_VALID_MINUTES));
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  // Live use counts while a code is open -- the point of watching is to
  // notice the count outrunning the room. SWR pauses the polling while the
  // tab is hidden, and stops it once nothing is open.
  const dataQ = useSWR(
    "admin/join-codes",
    async () => {
      const [codesResult, attemptsResult] = await Promise.all([
        supabase.from("join_codes").select("*").order("created_at", { ascending: false }).limit(CODE_LIMIT),
        supabase
          .from("join_code_attempts")
          .select("*, members(full_name, display_name)")
          .order("created_at", { ascending: false })
          .limit(ATTEMPT_LIMIT),
      ]);
      if (codesResult.error) throw new Error(codesResult.error.message);
      if (attemptsResult.error) throw new Error(attemptsResult.error.message);
      return { codes: codesResult.data ?? [], attempts: (attemptsResult.data ?? []) as Attempt[] };
    },
    { refreshInterval: hasActive ? REFRESH_MS : 0, dedupingInterval: 2_000 },
  );
  const codes = useMemo(() => dataQ.data?.codes ?? [], [dataQ.data]);
  const attempts = useMemo(() => dataQ.data?.attempts ?? [], [dataQ.data]);
  const loading = dataQ.isLoading;
  const load = () => dataQ.mutate();

  const audits = useMemo(
    () => new Map(codes.map((code) => [code.id, auditJoinCode(code, attempts, now)])),
    [codes, attempts, now],
  );
  const activeCodes = codes.filter((code) => audits.get(code.id)?.status === "active");
  if (hasActive !== activeCodes.length > 0) setHasActive(activeCodes.length > 0);

  // A live countdown while a code is open.
  useEffect(() => {
    if (!hasActive) return;
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, [hasActive]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const uses = Number(maxUses);
    const minutes = Number(validMinutes);
    if (!Number.isInteger(uses) || uses < 1 || uses > JOIN_MAX_USES_LIMIT) {
      setError(`Uses must be a whole number from 1 to ${JOIN_MAX_USES_LIMIT}.`);
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > JOIN_VALID_MINUTES_LIMIT) {
      setError(`Minutes must be a whole number from 1 to ${JOIN_VALID_MINUTES_LIMIT} (7 days).`);
      return;
    }

    setCreating(true);
    // A collision is ~1 in 850 billion per code; retry once or twice anyway.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: insertError } = await supabase.from("join_codes").insert({
        code: generateJoinCode(),
        max_uses: uses,
        valid_minutes: minutes,
        note: note.trim() || null,
        // Overwritten by the insert trigger from the database clock.
        expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
      });
      if (!insertError) {
        setNote("");
        setFormOpen(false);
        setNow(new Date());
        await load();
        setCreating(false);
        return;
      }
      if (insertError.code !== "23505") {
        setError(`Couldn't create the code: ${insertError.message}`);
        break;
      }
    }
    setCreating(false);
  }

  async function handleRevoke(code: JoinCode) {
    setError(null);
    const { error: updateError } = await supabase
      .from("join_codes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", code.id);
    if (updateError) setError(`Couldn't revoke: ${updateError.message}`);
    await load();
  }

  const codeById = new Map(codes.map((code) => [code.id, code]));

  const codeColumns: Column<JoinCode>[] = [
    { key: "code", header: "Code", render: (code) => <span className="font-mono text-neutral-100">{formatJoinCode(code.code)}</span> },
    {
      key: "status",
      header: "Status",
      render: (code) => {
        const audit = audits.get(code.id);
        return audit ? <StatusPill tone={STATUS_TONE[audit.status]}>{STATUS_LABEL[audit.status]}</StatusPill> : null;
      },
    },
    {
      key: "joined",
      header: "Joined",
      className: "tabular-nums",
      render: (code) => (
        <span>
          {code.used_count}
          <span className="text-neutral-600"> / {code.max_uses}</span>
        </span>
      ),
    },
    {
      key: "late",
      header: "Tried after close",
      className: "tabular-nums",
      render: (code) => {
        const late = audits.get(code.id)?.lateAttempts ?? 0;
        return <span className={late > 0 ? "text-amber-400" : "text-neutral-600"}>{late}</span>;
      },
    },
    {
      key: "created",
      header: "Created",
      render: (code) => (
        <span className="text-neutral-500">
          {new Date(code.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {code.note ? ` · ${code.note}` : ""}
        </span>
      ),
    },
  ];

  const attemptColumns: Column<Attempt>[] = [
    {
      key: "when",
      header: "When",
      render: (a) => <span className="text-neutral-500">{new Date(a.created_at).toLocaleString()}</span>,
    },
    {
      key: "code",
      header: "Code",
      render: (a) => {
        const code = a.join_code_id ? codeById.get(a.join_code_id) : null;
        return <span className="font-mono">{formatJoinCode(code?.code ?? a.code_entered)}</span>;
      },
    },
    {
      key: "who",
      header: "Telegram",
      render: (a) => (
        <>
          {a.telegram_username ? `@${a.telegram_username}` : ""}
          <span className="ml-2 text-xs text-neutral-600">{a.telegram_user_id}</span>
        </>
      ),
    },
    {
      key: "result",
      header: "Result",
      render: (a) => {
        const success = a.outcome === "created" || a.outcome === "linked";
        return <span className={success ? "text-green-400" : "text-amber-400"}>{OUTCOME_LABEL[a.outcome] ?? a.outcome}</span>;
      },
    },
    {
      key: "member",
      header: "Member",
      render: (a) =>
        a.member_id && a.members ? (
          <Link href={`/admin/members/${a.member_id}`} className="text-neutral-300 hover:text-neutral-100">
            {a.members.display_name ?? a.members.full_name}
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Join codes"
        description="Let new members sign themselves up, for a few people and a few minutes at a time."
        info={
          <>
            <p>
              New members open the bot and enter a code from here, with their name and email. Show the QR on a screen
              or read the code out.
            </p>
            <p>
              Someone whose email or Telegram handle is already on the roster is linked to that record. Anyone who
              can&apos;t be matched safely goes to the{" "}
              <Link href="/admin/bind-queue" className="text-red-400 hover:text-red-300">
                bind queue
              </Link>
              .
            </p>
          </>
        }
        actions={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <IconPlus size={16} />
            New code
          </Button>
        }
      />

      {error ? <Toast variant="error" message={error} onDismiss={() => setError(null)} /> : null}
      {dataQ.error ? <Toast variant="error" message={(dataQ.error as Error).message} /> : null}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : activeCodes.length === 0 ? (
        <Card>
          <EmptyState
            message="No code is open right now."
            action={
              <Button variant="secondary" size="sm" onClick={() => setFormOpen(true)}>
                Open one for the next briefing
              </Button>
            }
          />
        </Card>
      ) : (
        activeCodes.map((code) => {
          const url = joinUrlFor(code.code);
          const symbol = url ? encodeQrSymbol(url) : null;
          const audit = audits.get(code.id);
          return (
            <section
              key={code.id}
              className="flex flex-wrap items-center gap-6 rounded-xl border border-green-500/25 bg-neutral-900/60 p-5"
            >
              {symbol ? (
                <svg
                  viewBox={symbol.viewBox}
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-44 shrink-0 rounded-lg"
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label={`QR code for join code ${formatJoinCode(code.code)}`}
                >
                  <rect width={symbol.extent} height={symbol.extent} fill="#ffffff" />
                  <path d={symbol.path} fill="#000000" />
                </svg>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <p className="font-mono text-4xl tracking-widest text-neutral-100">{formatJoinCode(code.code)}</p>
                <div className="flex max-w-sm flex-col gap-1.5">
                  <div className="flex justify-between text-sm text-neutral-400">
                    <span>
                      <span className="tabular-nums text-neutral-100">{code.used_count}</span> of {code.max_uses} joined
                    </span>
                    <span className="tabular-nums">{formatTimeLeft(code.expires_at, now)} left</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-status-good"
                      style={{ width: `${Math.min(100, (code.used_count / Math.max(1, code.max_uses)) * 100)}%` }}
                    />
                  </div>
                </div>
                {code.note ? <p className="text-sm text-neutral-500">{code.note}</p> : null}
                {audit && audit.blocked > 0 ? (
                  <Link href="/admin/bind-queue" className="text-sm text-amber-400 hover:text-amber-300">
                    {audit.blocked} couldn&apos;t be linked automatically. Check the bind queue →
                  </Link>
                ) : null}
                {url ? null : (
                  <p className="text-xs text-amber-400">
                    No QR: set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME and NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME. The code
                    still works if typed.
                  </p>
                )}
                <div>
                  <Button variant="secondary" size="sm" onClick={() => handleRevoke(code)}>
                    Close this code now
                  </Button>
                </div>
              </div>
            </section>
          );
        })
      )}

      {codes.length > 0 ? (
        <Card
          title="Recent codes"
          info="“Tried after close” counts attempts made after a code expired, ran out or was closed. A few are latecomers; a lot means the code spread beyond the room."
          padded={false}
        >
          <DataTable columns={codeColumns} rows={codes} rowKey={(code) => code.id} pageSize={10} />
        </Card>
      ) : null}

      {attempts.length > 0 ? (
        <details className="group rounded-xl border border-neutral-800 bg-neutral-900/60">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-neutral-300 hover:text-neutral-100">
            <IconChevronDown size={15} className="-rotate-90 text-neutral-500 transition-transform group-open:rotate-0" />
            Attempt log
            <span className="tabular-nums text-neutral-500">{attempts.length}</span>
          </summary>
          <div className="border-t border-neutral-800">
            <DataTable columns={attemptColumns} rows={attempts} rowKey={(a) => String(a.id)} pageSize={25} />
          </div>
        </details>
      ) : null}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New join code"
        description="Works for this many people, within this many minutes."
        footer={
          <>
            <Button type="submit" form="new-join-code" size="sm" disabled={creating}>
              {creating ? "Creating…" : "Create code"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <form id="new-join-code" onSubmit={handleCreate} className="flex flex-col gap-4">
          {error ? <Toast variant="error" message={error} onDismiss={() => setError(null)} /> : null}
          <div className="grid grid-cols-2 gap-4">
            <label className={LABEL}>
              <span className={CAPTION}>People</span>
              <input
                type="number"
                min={1}
                max={JOIN_MAX_USES_LIMIT}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className={FIELD}
              />
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>Minutes</span>
              <input
                type="number"
                min={1}
                max={JOIN_VALID_MINUTES_LIMIT}
                value={validMinutes}
                onChange={(e) => setValidMinutes(e.target.value)}
                className={FIELD}
              />
            </label>
          </div>
          <label className={LABEL}>
            <span className={CAPTION}>Note</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Freshmen briefing, 1 Oct"
              className={FIELD}
            />
            <span className={HELP}>Optional. Shown next to the code so you know which room it was for.</span>
          </label>
        </form>
      </Drawer>
    </div>
  );
}
