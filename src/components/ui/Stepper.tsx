export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  step?: number;
  className?: string;
  /** Accessible label for the control, e.g. the product name. */
  label?: string;
}

/**
 * `[-] N [+]` quantity stepper — the cart-line quantity control used by the
 * borrow/return flows (see docs/tele-qr/flows.md §2). Purely a controlled
 * value/onChange primitive; callers own the actual cart state.
 */
export default function Stepper({
  value,
  onChange,
  min = 0,
  max,
  disabled = false,
  step = 1,
  className = "",
  label,
}: StepperProps) {
  const canDecrement = !disabled && value - step >= min;
  const canIncrement = !disabled && (max === undefined || value + step <= max);

  const decrement = () => {
    if (!canDecrement) return;
    onChange(Math.max(min, value - step));
  };

  const increment = () => {
    if (!canIncrement) return;
    onChange(max === undefined ? value + step : Math.min(max, value + step));
  };

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      role="group"
      aria-label={label ? `${label} quantity` : "Quantity"}
    >
      <button
        type="button"
        onClick={decrement}
        disabled={!canDecrement}
        aria-label="Decrease quantity"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-neutral-800 text-lg font-semibold text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <span
        className="min-w-8 text-center text-base font-semibold tabular-nums text-neutral-100"
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={increment}
        disabled={!canIncrement}
        aria-label="Increase quantity"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-neutral-800 text-lg font-semibold text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
