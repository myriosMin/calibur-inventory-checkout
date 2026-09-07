import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  children: ReactNode;
}

// Disabled state is uniformly muted gray across every variant rather than a
// washed-out tint of the variant's own color -- reads more clearly as "not
// available" on a dark surface, and it's one less thing each variant has to
// get right on its own.
const DISABLED = "disabled:bg-neutral-800 disabled:text-neutral-600";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Brand red, per nuscalibur.com's --rc-red (#DC2626) -- with the same
  // red glow-on-hover treatment their site uses on its own CTAs.
  primary:
    `bg-red-600 text-white hover:bg-red-500 hover:shadow-[0_0_20px_rgba(220,38,38,0.5)] active:bg-red-700 ${DISABLED}`,
  secondary:
    `bg-neutral-800 text-neutral-100 hover:bg-neutral-700 active:bg-neutral-600 ${DISABLED}`,
  // Amber, not red -- red is the brand/primary accent here, so a destructive
  // action needs a hue of its own to stay visually distinct from "the main
  // button" rather than reading as just another primary action.
  danger:
    `bg-amber-600 text-white hover:bg-amber-500 active:bg-amber-700 ${DISABLED}`,
  /** Text-only, no background -- for a de-emphasized action (e.g. "Cancel")
   * that must stay reachable without competing visually with the primary CTA. */
  ghost:
    "bg-transparent text-neutral-400 hover:text-neutral-100 active:text-white disabled:text-neutral-700",
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
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-base font-medium uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:shadow-none ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
