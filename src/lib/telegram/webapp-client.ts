"use client";

/**
 * Thin wrapper around `window.Telegram.WebApp` (injected by
 * `https://telegram.org/js/telegram-web-app.js`, loaded in
 * `src/app/store/layout.tsx`) plus a dev-only mock so `/store` can be
 * exercised in a plain browser tab during local development.
 *
 * IMPORTANT: `startParam` (Telegram's `initDataUnsafe.start_param`) is read
 * client-side, unsigned, and is for routing convenience ONLY (e.g. "should
 * I show the group-pick sheet"). It must never be treated as a trusted
 * identity/authorization signal -- every server route re-validates the raw
 * `initData` string itself. See docs/tele-qr/architecture.md.
 */

export interface WebAppClient {
  initData: string;
  startParam: string | null;
  /** Unsigned first + last name, only for prefilling a form. Never identity. */
  telegramName: string | null;
  showScanQrPopup(opts: { text?: string }, onScan: (raw: string) => boolean): void;
  closeScanQrPopup(): void;
  ready(): void;
  expand(): void;
}

interface TelegramWebAppNative {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { first_name?: string; last_name?: string };
  };
  showScanQrPopup?: (
    params: { text?: string },
    callback?: (text: string) => boolean | void,
  ) => void;
  closeScanQrPopup?: () => void;
  ready: () => void;
  expand: () => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppNative;
    };
  }
}

const MOCK_START_PARAM_QUERY_KEY = "mock_start_param";

/**
 * Extracts a scan code from the raw string handed back by Telegram's
 * `showScanQrPopup` camera callback (or `initDataUnsafe.start_param`, or a
 * manually-typed code from the dev `prompt()` fallback).
 *
 * Per Telegram's docs, scanning a QR that encodes
 * `https://t.me/<bot>/<app>?startapp=<code>` returns that full URL string as
 * the raw scan result -- extract the `startapp` query param in that case.
 * A bare/manually-entered code has no URL structure, so it's returned
 * unchanged (this also makes calling this function on `start_param`, which
 * Telegram already delivers as the bare code, a safe no-op passthrough).
 *
 * Returns `null` when nothing usable could be extracted (empty input, or a
 * URL with no `startapp` param).
 */
export function parseStartAppCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("tg://")) {
    try {
      const url = new URL(trimmed);
      const startapp = url.searchParams.get("startapp");
      return startapp && startapp !== "" ? startapp : null;
    } catch {
      return null;
    }
  }

  return trimmed;
}

function nameFromUnsafeUser(user?: { first_name?: string; last_name?: string }): string | null {
  const name = [user?.first_name, user?.last_name]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();
  return name || null;
}

function createRealWebApp(nativeWebApp: TelegramWebAppNative): WebAppClient {
  return {
    initData: nativeWebApp.initData ?? "",
    startParam: nativeWebApp.initDataUnsafe?.start_param ?? null,
    telegramName: nameFromUnsafeUser(nativeWebApp.initDataUnsafe?.user),
    showScanQrPopup(opts, onScan) {
      nativeWebApp.showScanQrPopup?.(opts, (text) => onScan(text));
    },
    closeScanQrPopup() {
      nativeWebApp.closeScanQrPopup?.();
    },
    ready() {
      nativeWebApp.ready();
    },
    expand() {
      nativeWebApp.expand();
    },
  };
}

function readMockStartParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(MOCK_START_PARAM_QUERY_KEY);
}

/**
 * Dev-only mock. `showScanQrPopup` falls back to a native `prompt()` loop:
 * each result is passed to `onScan`; if `onScan` returns `false` the popup
 * "stays open" by immediately prompting again (simulating Telegram's
 * multi-scan behavior); it stops once `onScan` returns `true` or the user
 * cancels the prompt (mirrors backing out of the real camera popup).
 */
function createDevMockWebApp(): WebAppClient {
  return {
    initData: process.env.NEXT_PUBLIC_DEV_MOCK_INIT_DATA ?? "",
    startParam: readMockStartParam(),
    telegramName: null,
    showScanQrPopup(opts, onScan) {
      for (;;) {
        const result = window.prompt(opts.text ?? "Simulate QR scan (dev mock)");
        if (result === null) return; // user cancelled -- stop, like closing the real popup
        if (onScan(result)) return; // handled -- close, like a real successful scan
        // onScan returned false: loop again to simulate the popup staying open.
      }
    },
    closeScanQrPopup() {
      // no-op in dev mock
    },
    ready() {
      // no-op in dev mock
    },
    expand() {
      // no-op in dev mock
    },
  };
}

/**
 * Returns the Telegram WebApp client, or the dev mock when
 * `NEXT_PUBLIC_ENABLE_DEV_MOCKS === '1'` and no real `window.Telegram.WebApp`
 * is present. Throws otherwise -- fail loud rather than silently mocking in
 * anything resembling a production environment.
 */
export function getWebApp(): WebAppClient {
  if (typeof window !== "undefined" && window.Telegram?.WebApp) {
    return createRealWebApp(window.Telegram.WebApp);
  }

  if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_DEV_MOCKS === "1") {
    return createDevMockWebApp();
  }

  throw new Error(
    "getWebApp(): window.Telegram.WebApp is not present and dev mocks are " +
      "disabled (NEXT_PUBLIC_ENABLE_DEV_MOCKS is unset or '0'). This app " +
      "must run inside a Telegram Mini App WebView, or with dev mocks " +
      "explicitly enabled for local testing.",
  );
}
