"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import Button from "@/components/ui/Button";
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
  const supabase = useMemo(() => getBrowserClient(), []);

  const [codes, setCodes] = useState<JoinCode[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [maxUses, setMaxUses] = useState(String(JOIN_DEFAULT_MAX_USES));
  const [validMinutes, setValidMinutes] = useState(String(JOIN_DEFAULT_VALID_MINUTES));
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [codesResult, attemptsResult] = await Promise.all([
      supabase
        .from("join_codes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(CODE_LIMIT),
      supabase
        .from("join_code_attempts")
        .select("*, members(full_name, display_name)")
        .order("created_at", { ascending: false })
        .limit(ATTEMPT_LIMIT),
    ]);
    if (codesResult.error) setError(codesResult.error.message);
    else setCodes(codesResult.data ?? []);
    if (attemptsResult.error) setError(attemptsResult.error.message);
    else setAttempts((attemptsResult.data ?? []) as Attempt[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // One-shot load of external data on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const audits = useMemo(
    () => new Map(codes.map((code) => [code.id, auditJoinCode(code, attempts, now)])),
    [codes, attempts, now],
  );
  const activeCodes = codes.filter((code) => audits.get(code.id)?.status === "active");
  const hasActive = activeCodes.length > 0;

  // A live countdown, and live use counts while a code is open -- the point
  // of watching is to notice the count outrunning the room.
  useEffect(() => {
    if (!hasActive) return;
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [hasActive, load]);

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-2 text-lg font-semibold text-neutral-100">Join codes</h1>
        <p className="text-sm text-neutral-300">
          New members join by opening the bot and entering a code from here, with their name and
          email. Each code works for a set number of people within a set time. Show the QR on a
          screen, or read the code out. If someone&apos;s email or Telegram handle is already on
          the roster, they&apos;re linked to that record. Anyone who can&apos;t be matched safely
          goes to the{" "}
          <Link href="/admin/bind-queue" className="text-red-400 hover:text-red-300">
            bind queue
          </Link>
          .
        </p>
      </div>

      {error ? <Toast variant="error" message={error} onDismiss={() => setError(null)} /> : null}

      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        <label className="flex flex-col gap-1 text-sm text-neutral-300">
          People
          <input
            type="number"
            min={1}
            max={JOIN_MAX_USES_LIMIT}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className="min-h-11 w-24 rounded-lg border border-neutral-700 px-3 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-neutral-300">
          Minutes
          <input
            type="number"
            min={1}
            max={JOIN_VALID_MINUTES_LIMIT}
            value={validMinutes}
            onChange={(e) => setValidMinutes(e.target.value)}
            className="min-h-11 w-24 rounded-lg border border-neutral-700 px-3 text-base"
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm text-neutral-300">
          Note (optional)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Freshmen briefing, 1 Oct"
            className="min-h-11 w-full rounded-lg border border-neutral-700 px-3 text-base"
          />
        </label>
        <Button type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create code"}
        </Button>
      </form>

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : null}

      {activeCodes.map((code) => {
        const url = joinUrlFor(code.code);
        const symbol = url ? encodeQrSymbol(url) : null;
        const audit = audits.get(code.id);
        return (
          <section
            key={code.id}
            className="flex flex-wrap items-center gap-6 rounded-lg border border-green-500/30 bg-neutral-900 p-4"
          >
            {symbol ? (
              <svg
                viewBox={symbol.viewBox}
                xmlns="http://www.w3.org/2000/svg"
                className="size-48 shrink-0"
                shapeRendering="crispEdges"
                role="img"
                aria-label={`QR code for join code ${formatJoinCode(code.code)}`}
              >
                <rect width={symbol.extent} height={symbol.extent} fill="#ffffff" />
                <path d={symbol.path} fill="#000000" />
              </svg>
            ) : null}
            <div className="flex flex-col gap-2">
              <p className="font-mono text-4xl tracking-widest text-neutral-100">
                {formatJoinCode(code.code)}
              </p>
              <p className="text-sm text-neutral-300">
                {code.used_count} / {code.max_uses} joined · {formatTimeLeft(code.expires_at, now)}{" "}
                left
                {code.note ? ` · ${code.note}` : ""}
              </p>
              {audit && audit.blocked > 0 ? (
                <p className="text-sm text-amber-400">
                  {audit.blocked} couldn&apos;t be linked automatically. Check the bind queue.
                </p>
              ) : null}
              {url ? (
                <p className="break-all font-mono text-xs text-neutral-500">{url}</p>
              ) : (
                <p className="text-xs text-amber-400">
                  No QR: set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME and
                  NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME. The code still works if typed.
                </p>
              )}
              <div>
                <Button variant="danger" onClick={() => handleRevoke(code)}>
                  Revoke now
                </Button>
              </div>
            </div>
          </section>
        );
      })}

      {codes.length > 0 ? (
        <section>
          <h2 className="mb-2 text-base font-semibold text-neutral-100">Recent codes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-400">
                <tr>
                  <th className="py-2 pr-4 font-normal">Code</th>
                  <th className="py-2 pr-4 font-normal">Status</th>
                  <th className="py-2 pr-4 font-normal">Joined</th>
                  <th className="py-2 pr-4 font-normal">Tried after close</th>
                  <th className="py-2 pr-4 font-normal">Created</th>
                  <th className="py-2 pr-4 font-normal">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800 text-neutral-200">
                {codes.map((code) => {
                  const audit = audits.get(code.id);
                  return (
                    <tr key={code.id}>
                      <td className="py-2 pr-4 font-mono">{formatJoinCode(code.code)}</td>
                      <td className="py-2 pr-4">{audit ? STATUS_LABEL[audit.status] : ""}</td>
                      <td className="py-2 pr-4">
                        {code.used_count} / {code.max_uses}
                      </td>
                      <td
                        className={`py-2 pr-4 ${audit && audit.lateAttempts > 0 ? "text-amber-400" : ""}`}
                      >
                        {audit?.lateAttempts ?? 0}
                      </td>
                      <td className="py-2 pr-4 text-neutral-400">
                        {new Date(code.created_at).toLocaleString()} · {code.valid_minutes} min
                      </td>
                      <td className="py-2 pr-4 text-neutral-400">{code.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            &quot;Tried after close&quot; counts attempts made after a code expired, ran out or was
            revoked. A few are latecomers; a lot means the code spread beyond the room.
          </p>
        </section>
      ) : null}

      {attempts.length > 0 ? (
        <section>
          <h2 className="mb-2 text-base font-semibold text-neutral-100">Attempts</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-400">
                <tr>
                  <th className="py-2 pr-4 font-normal">When</th>
                  <th className="py-2 pr-4 font-normal">Code</th>
                  <th className="py-2 pr-4 font-normal">Telegram</th>
                  <th className="py-2 pr-4 font-normal">Result</th>
                  <th className="py-2 pr-4 font-normal">Member</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800 text-neutral-200">
                {attempts.slice(0, 100).map((attempt) => {
                  const code = attempt.join_code_id ? codeById.get(attempt.join_code_id) : null;
                  const success = attempt.outcome === "created" || attempt.outcome === "linked";
                  return (
                    <tr key={attempt.id}>
                      <td className="py-2 pr-4 text-neutral-400">
                        {new Date(attempt.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 font-mono">
                        {formatJoinCode(code?.code ?? attempt.code_entered)}
                      </td>
                      <td className="py-2 pr-4">
                        {attempt.telegram_username ? `@${attempt.telegram_username}` : ""}
                        <span className="ml-2 text-xs text-neutral-500">
                          {attempt.telegram_user_id}
                        </span>
                      </td>
                      <td className={`py-2 pr-4 ${success ? "text-green-400" : "text-amber-400"}`}>
                        {OUTCOME_LABEL[attempt.outcome] ?? attempt.outcome}
                      </td>
                      <td className="py-2 pr-4">
                        {attempt.member_id && attempt.members ? (
                          <Link
                            href={`/admin/members/${attempt.member_id}`}
                            className="text-red-400 hover:text-red-300"
                          >
                            {attempt.members.display_name ?? attempt.members.full_name}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
