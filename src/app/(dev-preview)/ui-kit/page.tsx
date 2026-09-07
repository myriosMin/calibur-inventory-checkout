"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import Stepper from "@/components/ui/Stepper";
import Toast from "@/components/ui/Toast";

/**
 * Throwaway smoke-test route for the WP4 UI kit.
 *
 * Renders each primitive with sample props so `npm run build` exercises them
 * end to end. Not part of the product — delete this route once the kit is
 * consumed by real screens (WP15/16/17).
 */
export default function UiKitPreviewPage() {
  const [quantity, setQuantity] = useState(2);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(true);
  const [showErrorToast, setShowErrorToast] = useState(true);

  return (
    <main className="pt-safe pb-safe px-safe mx-auto flex max-w-md flex-col gap-8 py-8">
      <h1 className="text-xl font-bold">UI kit preview</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Button
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Stepper
        </h2>
        <div className="flex items-center gap-4">
          <span>Resistor 10kΩ 0402</span>
          <Stepper
            value={quantity}
            onChange={setQuantity}
            min={0}
            max={99}
            label="Resistor 10kΩ 0402"
          />
        </div>
        <p className="text-sm text-neutral-400">Current value: {quantity}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Toast
        </h2>
        {showSuccessToast ? (
          <Toast
            variant="success"
            message="Cart submitted."
            onDismiss={() => setShowSuccessToast(false)}
          />
        ) : null}
        {showErrorToast ? (
          <Toast
            variant="error"
            message="Couldn't reach the server. Your cart is safe."
            actionLabel="Retry"
            onAction={() => setShowErrorToast(false)}
            onDismiss={() => setShowErrorToast(false)}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Sheet
        </h2>
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          Open sheet
        </Button>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Where is this going?"
        >
          <ul className="flex flex-col gap-2 pb-4">
            {["Hero", "Standard", "Sentry", "Personal/bench"].map((dest) => (
              <li key={dest}>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => setSheetOpen(false)}
                >
                  {dest}
                </Button>
              </li>
            ))}
          </ul>
        </Sheet>
      </section>
    </main>
  );
}
