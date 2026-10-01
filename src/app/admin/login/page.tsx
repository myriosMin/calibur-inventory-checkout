"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { CAPTION, FIELD, HELP, LABEL } from "@/components/admin/form";
import Button from "@/components/ui/Button";
import { clearAdminCache } from "@/lib/admin/queries";
import { getBrowserClient } from "@/lib/supabase/browser";

// Invite and password-reset emails use Supabase's default template, whose
// {{ .ConfirmationURL }} resolves to /auth/v1/verify?...&redirect_to=<here>.
// That endpoint 303s back with the session in the URL **fragment**:
//   #access_token=...&refresh_token=...&type=invite
//
// A fragment never reaches the server, so src/middleware.ts cannot see a
// session for it. /admin/login is the one /admin/* path the middleware lets
// through unauthenticated, which is why setting a password happens here
// rather than on a route of its own -- landing anywhere else under /admin
// would redirect back here and drop the fragment on the way.
type Mode = "signin" | "set-password";

const INVITE_TYPES = new Set(["invite", "recovery"]);

/**
 * Reads the auth fragment and immediately clears it, so access tokens don't
 * linger in the address bar or in session history. Must run before the
 * Supabase client is constructed: its own `detectSessionInUrl` would consume
 * the fragment first, leaving nothing to distinguish an invite landing from
 * someone just visiting the sign-in page.
 */
function takeAuthFragment():
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "error"; message: string }
  | null {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const clear = () =>
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

  // Expired or already-used links come back as #error=...&error_description=...
  const failure = params.get("error_description") ?? params.get("error");
  if (failure) {
    clear();
    return { kind: "error", message: failure };
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");
  if (accessToken && refreshToken && type && INVITE_TYPES.has(type)) {
    clear();
    return { kind: "tokens", accessToken, refreshToken };
  }
  return null;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      // Runs before the first await, so the fragment is still captured ahead
      // of the Supabase client's own detectSessionInUrl.
      const fragment = takeAuthFragment();
      if (!fragment) return;

      if (fragment.kind === "error") {
        setError(`${fragment.message}. Ask an admin to send you a new invite.`);
        return;
      }

      const { error: sessionError } = await getBrowserClient().auth.setSession({
        access_token: fragment.accessToken,
        refresh_token: fragment.refreshToken,
      });
      if (sessionError) {
        setError(`${sessionError.message}. Ask an admin to send you a new invite.`);
        return;
      }
      setMode("set-password");
    })();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
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

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Those two passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = getBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    await clearAdminCache();
    router.push("/admin");
    router.refresh();
  };

  const settingPassword = mode === "set-password";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-red-600 font-display text-lg font-bold text-white">
            C
          </span>
          <div className="leading-tight">
            <h1 className="font-display text-xl font-semibold text-neutral-100">Calibur Store</h1>
            <p className="text-sm text-neutral-500">
              {settingPassword ? "Set your password" : "Admin sign in"}
            </p>
          </div>
        </div>

        {settingPassword ? (
          <form onSubmit={handleSetPassword} className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
            <label className={LABEL}>
              <span className={CAPTION}>New password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={FIELD}
                autoComplete="new-password"
              />
              <span className={HELP}>At least 6 characters.</span>
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>Confirm password</span>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={FIELD}
                autoComplete="new-password"
              />
            </label>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <Button type="submit" size="sm" className="mt-1 min-h-10" disabled={submitting}>
              {submitting ? "Saving…" : "Save password and continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
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
        )}
      </div>
    </main>
  );
}
