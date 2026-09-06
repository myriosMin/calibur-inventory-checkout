"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Script from "next/script";

import { getWebApp } from "@/lib/telegram/webapp-client";

/**
 * Fires Telegram's `ready()`/`expand()` handshake once the WebApp script has
 * had a chance to load. Guarded in a try/catch: `getWebApp()` throws when
 * `window.Telegram.WebApp` is genuinely absent and dev mocks are disabled
 * (e.g. this layout loaded outside Telegram without
 * `NEXT_PUBLIC_ENABLE_DEV_MOCKS=1`) -- that must not crash the whole /store
 * subtree, it should just skip the handshake.
 */
function TelegramWebAppInit() {
  useEffect(() => {
    try {
      const webApp = getWebApp();
      webApp.ready();
      webApp.expand();
    } catch (err) {
      console.warn(
        "[store/layout] Telegram WebApp unavailable, skipping ready()/expand():",
        err instanceof Error ? err.message : err,
      );
    }
  }, []);

  return null;
}

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <TelegramWebAppInit />
      {children}
    </>
  );
}
