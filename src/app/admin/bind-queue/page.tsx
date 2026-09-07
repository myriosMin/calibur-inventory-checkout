"use client";

import { useEffect, useMemo, useState } from "react";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

type BindAttempt = Database["public"]["Tables"]["telegram_bind_attempts"]["Row"];
type Member = Pick<
  Database["public"]["Tables"]["members"]["Row"],
  "id" | "full_name" | "display_name" | "telegram_user_id"
>;

/**
 * Admin bind-queue: resolves `telegram_bind_attempts` rows (created by the
 * bot webhook when it can't match an incoming Telegram user to a member by
 * handle) against a real `members` row. Every read/write goes through the
 * anon `getBrowserClient()` -- Postgres RLS's `is_admin()` policy is what
 * actually gates this, not anything in this component.
 */
export default function AdminBindQueuePage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [attempts, setAttempts] = useState<BindAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Which attempt row currently has its member picker open.
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [binding, setBinding] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function loadAttempts() {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("telegram_bind_attempts")
      .select("*")
      .is("resolved_member", null)
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError(error.message);
    } else {
      setAttempts(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await loadAttempts();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live search over members by name as the admin types, scoped to the
  // currently-open picker.
  useEffect(() => {
    if (!activeAttemptId) {
      const timeout = setTimeout(() => setMemberResults([]), 0);
      return () => clearTimeout(timeout);
    }

    const trimmed = memberQuery.trim();
    let cancelled = false;

    async function search() {
      setSearching(true);
      let query = supabase
        .from("members")
        .select("id, full_name, display_name, telegram_user_id")
        .order("full_name", { ascending: true })
        .limit(20);

      if (trimmed.length > 0) {
        query = query.or(
          `full_name.ilike.%${trimmed}%,display_name.ilike.%${trimmed}%`,
        );
      }

      const { data, error } = await query;
      if (!cancelled) {
        if (!error) setMemberResults(data ?? []);
        setSearching(false);
      }
    }

    const timeout = setTimeout(search, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [activeAttemptId, memberQuery, supabase]);

  function openPicker(attemptId: string) {
    setActiveAttemptId(attemptId);
    setMemberQuery("");
    setMemberResults([]);
    setRowError((prev) => ({ ...prev, [attemptId]: "" }));
  }

  function closePicker() {
    setActiveAttemptId(null);
    setMemberQuery("");
    setMemberResults([]);
  }

  async function handleBind(attempt: BindAttempt, member: Member) {
    setRowError((prev) => ({ ...prev, [attempt.id]: "" }));

    // Guard rail: don't silently overwrite an existing binding to a
    // different Telegram account.
    if (
      member.telegram_user_id !== null &&
      member.telegram_user_id !== attempt.telegram_user_id
    ) {
      setRowError((prev) => ({
        ...prev,
        [attempt.id]:
          "This member is already linked to a different Telegram account.",
      }));
      return;
    }

    setBinding(attempt.id);

    const { error: memberError } = await supabase
      .from("members")
      .update({
        telegram_user_id: attempt.telegram_user_id,
        telegram_bound_at: new Date().toISOString(),
      })
      .eq("id", member.id);

    if (memberError) {
      setRowError((prev) => ({
        ...prev,
        [attempt.id]: `Failed to update member: ${memberError.message}`,
      }));
      setBinding(null);
      return;
    }

    const { error: attemptError } = await supabase
      .from("telegram_bind_attempts")
      .update({ resolved_member: member.id })
      .eq("id", attempt.id);

    if (attemptError) {
      setRowError((prev) => ({
        ...prev,
        [attempt.id]:
          `Member ${member.display_name ?? member.full_name} was bound, but ` +
          `marking this bind-attempt row resolved failed: ` +
          `${attemptError.message}. The member's telegram_user_id is now set ` +
          `-- please resolve this row manually to avoid a duplicate bind.`,
      }));
      setBinding(null);
      return;
    }

    setBinding(null);
    closePicker();
    setSuccessMessage(
      `Bound Telegram user ${attempt.telegram_user_id} to ${
        member.display_name ?? member.full_name
      }.`,
    );
    setAttempts((prev) => prev.filter((a) => a.id !== attempt.id));
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-100">Bind queue</h1>
      <p className="mb-4 text-sm text-neutral-300">
        Telegram users the bot couldn&apos;t match to a member by handle.
        Search for the right member and bind them below.
      </p>

      {successMessage ? (
        <Toast
          variant="success"
          message={successMessage}
          onDismiss={() => setSuccessMessage(null)}
          className="mb-4"
        />
      ) : null}

      {loadError ? (
        <Toast
          variant="error"
          message={`Failed to load bind queue: ${loadError}`}
          onDismiss={() => setLoadError(null)}
          className="mb-4"
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : attempts.length === 0 ? (
        <p className="text-sm text-neutral-400">No unresolved bind attempts.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {attempts.map((attempt) => (
            <li
              key={attempt.id}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm text-neutral-100">
                  <div className="font-medium">
                    {attempt.display_name ?? "(no display name)"}
                    {attempt.username ? (
                      <span className="ml-2 text-neutral-400">
                        @{attempt.username}
                      </span>
                    ) : (
                      <span className="ml-2 text-neutral-600">(no username)</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-neutral-400">
                    telegram_user_id: {attempt.telegram_user_id}
                  </div>
                  {attempt.scan_code ? (
                    <div className="text-xs text-neutral-400">
                      scan_code: {attempt.scan_code}
                    </div>
                  ) : null}
                  <div className="text-xs text-neutral-400">
                    {new Date(attempt.created_at).toLocaleString()}
                  </div>
                </div>

                {activeAttemptId === attempt.id ? (
                  <Button
                    variant="secondary"
                    onClick={closePicker}
                    className="shrink-0"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => openPicker(attempt.id)}
                    className="shrink-0"
                  >
                    Bind to member…
                  </Button>
                )}
              </div>

              {rowError[attempt.id] ? (
                <p className="mt-3 text-sm text-red-400">
                  {rowError[attempt.id]}
                </p>
              ) : null}

              {activeAttemptId === attempt.id ? (
                <div className="mt-3 border-t border-neutral-800 pt-3">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search members by name…"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-neutral-700 px-3 text-base"
                  />
                  <ul className="mt-2 flex flex-col gap-1">
                    {searching ? (
                      <li className="text-sm text-neutral-400">Searching…</li>
                    ) : memberResults.length === 0 ? (
                      <li className="text-sm text-neutral-400">No members found.</li>
                    ) : (
                      memberResults.map((member) => {
                        const alreadyBoundElsewhere =
                          member.telegram_user_id !== null &&
                          member.telegram_user_id !== attempt.telegram_user_id;
                        return (
                          <li
                            key={member.id}
                            className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-neutral-800"
                          >
                            <div className="text-sm text-neutral-100">
                              {member.display_name ?? member.full_name}
                              {alreadyBoundElsewhere ? (
                                <span className="ml-2 text-xs text-red-400">
                                  already linked to another Telegram account
                                </span>
                              ) : null}
                            </div>
                            <Button
                              variant={
                                alreadyBoundElsewhere ? "secondary" : "primary"
                              }
                              disabled={binding === attempt.id}
                              onClick={() => handleBind(attempt, member)}
                            >
                              {binding === attempt.id ? "Binding…" : "Bind"}
                            </Button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
