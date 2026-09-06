import type { ReactNode } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastProps {
  variant?: ToastVariant;
  message: ReactNode;
  onDismiss?: () => void;
  /** Optional action, e.g. a "Retry" button for a failed submit. */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "bg-green-50 text-green-900 border-green-200",
  error: "bg-red-50 text-red-900 border-red-200",
  info: "bg-gray-50 text-gray-900 border-gray-200",
};

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: "✓",
  error: "!",
  info: "i",
};

/**
 * Dismissible notification banner, e.g. for "submit failed, retry" messaging
 * after a cart submit. Positions itself respecting the bottom safe-area
 * inset so it isn't obscured by Telegram's own chrome.
 */
export default function Toast({
  variant = "info",
  message,
  onDismiss,
  actionLabel,
  onAction,
  className = "",
}: ToastProps) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-sm ${VARIANT_CLASSES[variant]} ${className}`}
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 text-sm font-bold"
      >
        {VARIANT_ICON[variant]}
      </span>
      <div className="min-w-0 flex-1 text-sm leading-snug">{message}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold underline underline-offset-2"
        >
          {actionLabel}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-lg leading-none opacity-60 hover:opacity-100"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
