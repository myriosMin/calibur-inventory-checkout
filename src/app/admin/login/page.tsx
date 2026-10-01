"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CAPTION, FIELD, LABEL } from "@/components/admin/form";
import Button from "@/components/ui/Button";
import { clearAdminCache } from "@/lib/admin/queries";
import { getBrowserClient } from "@/lib/supabase/browser";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = getBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    // Whatever an earlier session cached belongs to that session.
    await clearAdminCache();
    router.push("/admin");
    router.refresh();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-red-600 font-display text-lg font-bold text-white">
            C
          </span>
          <div className="leading-tight">
            <h1 className="font-display text-xl font-semibold text-neutral-100">Calibur Store</h1>
            <p className="text-sm text-neutral-500">Admin sign in</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
          <label className={LABEL}>
            <span className={CAPTION}>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD}
              autoComplete="username"
            />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button type="submit" size="sm" className="mt-1 min-h-10" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
