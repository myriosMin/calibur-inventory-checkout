"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import { FIELD } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import Button from "@/components/ui/Button";
import { IconCheck, IconSearch } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import { KEYS, revalidate, useMembers } from "@/lib/admin/queries";
import { getBrowserClient } from "@/lib/supabase/browser";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
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
  const supabase = getBrowserClient();

  const attemptsQ = useSWR("admin/bind-attempts", () =>
    fetchAllRows<BindAttempt>((from, to) =>
      supabase
        .from("telegram_bind_attempts")
        .select("*")
        .is("resolved_member", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  );
  const attempts = attemptsQ.data ?? [];
  // The roster is already cached for every admin page; searching it locally
  // costs no request per keystroke.
  const membersQ = useMembers();

  // Which attempt row currently has its member picker open.
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [binding, setBinding] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const memberResults = useMemo<Member[]>(() => {
    const needle = memberQuery.trim().toLowerCase();
    return (membersQ.data ?? [])
      .filter(
        (m) =>
          m.active &&
          (!needle || [m.full_name, m.display_name, m.telegram_username].some((f) => f?.toLowerCase().includes(needle))),
      )
      .slice(0, 8);
  }, [membersQ.data, memberQuery]);

  function openPicker(attemptId: string) {
    setActiveAttemptId(attemptId);
    setMemberQuery("");
    setRowError((prev) => ({ ...prev, [attemptId]: "" }));
  }

  function closePicker() {
    setActiveAttemptId(null);
    setMemberQuery("");
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
    await attemptsQ.mutate((prev) => (prev ?? []).filter((a) => a.id !== attempt.id), { revalidate: false });
    void revalidate(KEYS.members);
    void revalidate(KEYS.badges);
  }

  const loadError = (attemptsQ.error as Error | undefined)?.message;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bind queue"
        description={
          attemptsQ.isLoading
            ? "Telegram users the bot couldn't match."
            : `${attempts.length} Telegram ${attempts.length === 1 ? "user" : "users"} the bot couldn't match to a member.`
        }
        info="The bot matches people by Telegram handle or join code. Whoever it can't match safely lands here: find the right member and link them."
      />

      {successMessage ? <Toast variant="success" message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {loadError ? <Toast variant="error" message={`Failed to load bind queue: ${loadError}`} /> : null}

      {attemptsQ.isLoading ? (
        <TableSkeleton rows={3} />
      ) : attempts.length === 0 ? (
        <Card>
          <EmptyState message="Nobody is waiting. Everyone who messaged the bot has been matched." />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {attempts.map((attempt) => {
            const open = activeAttemptId === attempt.id;
            return (
              <li key={attempt.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-neutral-100">
                      {attempt.display_name ?? "(no display name)"}
                      <span className="ml-2 font-normal text-neutral-500">
                        {attempt.username ? `@${attempt.username}` : "no username"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {new Date(attempt.created_at).toLocaleString()} · id {attempt.telegram_user_id}
                      {attempt.scan_code ? ` · scanned ${attempt.scan_code}` : ""}
                    </p>
                  </div>
                  {open ? (
                    <Button variant="ghost" size="sm" onClick={closePicker}>
                      Cancel
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => openPicker(attempt.id)}>
                      Link to member
                    </Button>
                  )}
                </div>

                {rowError[attempt.id] ? <p className="px-4 pb-3 text-sm text-red-400">{rowError[attempt.id]}</p> : null}

                {open ? (
                  <div className="border-t border-neutral-800 p-3">
                    <label className="relative block">
                      <span className="sr-only">Search members</span>
                      <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                      <input
                        type="text"
                        autoFocus
                        placeholder="Search members by name or handle…"
                        value={memberQuery}
                        onChange={(e) => setMemberQuery(e.target.value)}
                        className={`${FIELD} pl-9`}
                      />
                    </label>
                    <ul className="mt-2 flex flex-col">
                      {memberResults.length === 0 ? (
                        <li className="px-2 py-2 text-sm text-neutral-500">No members found.</li>
                      ) : (
                        memberResults.map((member) => {
                          const alreadyBoundElsewhere =
                            member.telegram_user_id !== null && member.telegram_user_id !== attempt.telegram_user_id;
                          return (
                            <li key={member.id}>
                              <button
                                type="button"
                                disabled={binding === attempt.id}
                                onClick={() => handleBind(attempt, member)}
                                className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-neutral-800 disabled:cursor-wait"
                              >
                                <span className="text-neutral-100">
                                  {member.display_name ?? member.full_name}
                                  {alreadyBoundElsewhere ? (
                                    <span className="ml-2 text-xs text-amber-400">linked to another account</span>
                                  ) : null}
                                </span>
                                <span className="flex items-center gap-1 text-xs text-neutral-500 group-hover:text-neutral-200">
                                  {binding === attempt.id ? "Linking…" : (
                                    <>
                                      <IconCheck size={14} />
                                      Link
                                    </>
                                  )}
                                </span>
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
