"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import Button from "@/components/ui/Button";
import { formatJoinCode } from "@/lib/join/code";
import {
  isJoinOutcome,
  isJoinSuccess,
  joinOutcomeMessage,
  validateJoinRequest,
  type JoinField,
} from "@/lib/join/request";

export interface JoinFormProps {
  initData: string;
  /** Prefilled from a `join_<CODE>` link; empty when typed by hand. */
  initialCode: string;
  /** Telegram's (unsigned) name, as a starting point for the full-name field. */
  defaultName: string | null;
  onJoined: () => void;
}

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-base text-neutral-100";

/**
 * Self-service onboarding. The notice below is the in-app version of the
 * registration-form text in docs/tele-qr/pdpa.md, and accepting it is
 * recorded on the member row (members.notice_accepted_at).
 */
export default function JoinForm({ initData, initialCode, defaultName, onJoined }: JoinFormProps) {
  const [code, setCode] = useState(initialCode ? formatJoinCode(initialCode) : "");
  const [fullName, setFullName] = useState(defaultName ?? "");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [acceptedNotice, setAcceptedNotice] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<JoinField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const payload = { code, fullName, displayName, email, acceptedNotice };
    const validation = validateJoinRequest(payload);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      const res = await fetch("/api/store/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        outcome?: unknown;
        fields?: Partial<Record<JoinField, string>>;
      };

      if (isJoinOutcome(data.outcome)) {
        if (isJoinSuccess(data.outcome)) {
          setDoneMessage(joinOutcomeMessage(data.outcome));
        } else {
          setFormError(joinOutcomeMessage(data.outcome));
        }
      } else if (data.fields) {
        setFieldErrors(data.fields);
      } else {
        setFormError(`Couldn't join just now (${res.status}). Try again in a minute.`);
      }
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (doneMessage) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-base text-neutral-100">{doneMessage}</p>
        <Button onClick={onJoined}>Continue</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Join the parts store</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Get a join code from a committee member, then fill this in once.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Join code" error={fieldErrors.code}>
          <input
            className={`${INPUT_CLASS} font-mono uppercase tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD-EF23"
          />
        </Field>

        <Field label="Full name" error={fieldErrors.fullName}>
          <input
            className={INPUT_CLASS}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
        </Field>

        <Field label="What people call you (optional)" error={fieldErrors.displayName}>
          <input
            className={INPUT_CLASS}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="nickname"
          />
        </Field>

        <Field label="NUS email" error={fieldErrors.email}>
          <input
            className={INPUT_CLASS}
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            placeholder="e0123456@u.nus.edu"
          />
        </Field>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
          <p className="font-medium text-neutral-100">How your data is used</p>
          <p className="mt-2">
            This bot tracks what&apos;s borrowed from the parts store. Your name, email and
            Telegram account identify you when you scan an item, and we log what you borrow,
            when, and which robot it&apos;s for.
          </p>
          <p className="mt-2">
            It&apos;s used only for managing club inventory, not for attendance or any kind of
            monitoring. You can see your own borrowing history in the app at any time. When you
            leave the club, your Telegram account is unlinked. Ask a committee member if you
            have questions or want something corrected.
          </p>
          <label className="mt-3 flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={acceptedNotice}
              onChange={(e) => setAcceptedNotice(e.target.checked)}
            />
            <span className="text-neutral-100">I understand and agree</span>
          </label>
          {fieldErrors.acceptedNotice ? (
            <p className="mt-1 text-sm text-red-400">{fieldErrors.acceptedNotice}</p>
          ) : null}
        </section>

        {formError ? <p className="text-sm text-red-400">{formError}</p> : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Joining…" : "Join"}
        </Button>
      </form>
    </main>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-neutral-300">{label}</span>
      {children}
      {error ? <span className="text-sm text-red-400">{error}</span> : null}
    </label>
  );
}
