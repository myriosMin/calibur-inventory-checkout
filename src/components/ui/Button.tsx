import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-300",
  secondary:
    "bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300 disabled:bg-slate-50 disabled:text-slate-400",
  danger:
    "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300",
  /** Text-only, no background -- for a de-emphasized action (e.g. "Cancel")
   * that must stay reachable without competing visually with the primary CTA. */
  ghost:
    "bg-transparent text-slate-500 hover:text-slate-800 active:text-slate-900 disabled:text-slate-300",
};

/**
 * Thumb-friendly button primitive for a phone-width Mini App.
 * Guarantees a minimum 44px tap target regardless of content.
 */
export default function Button({
  variant = "primary",
  className = "",
  disabled = false,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-base font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
