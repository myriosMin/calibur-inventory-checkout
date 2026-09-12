"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { insertScanCodeWithRetry } from "@/lib/codes/insert";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Tables } from "@/lib/types/database";

type ScanCode = Tables<"scan_codes">;
type ProductOption = Pick<Tables<"products">, "id" | "name" | "tier" | "active">;
type LocationOption = Pick<Tables<"locations">, "id" | "name">;

type Kind = "product" | "group";

interface FeedbackState {
  variant: "success" | "error" | "info";
  message: string;
}

export default function AdminScanCodesPage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [scanCodes, setScanCodes] = useState<ScanCode[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  // Create-form state.
  const [kind, setKind] = useState<Kind>("product");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [scanCodesRes, productsRes, locationsRes] = await Promise.all([
      supabase
        .from("scan_codes")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id, name, tier, active")
        .order("name", { ascending: true }),
      supabase.from("locations").select("id, name").order("name", { ascending: true }),
    ]);

    if (scanCodesRes.error) {
      setFeedback({ variant: "error", message: `Failed to load scan codes: ${scanCodesRes.error.message}` });
    } else {
      setScanCodes(scanCodesRes.data ?? []);
    }
    if (productsRes.error) {
      setFeedback({ variant: "error", message: `Failed to load products: ${productsRes.error.message}` });
    } else {
      setProducts(productsRes.data ?? []);
    }
    if (locationsRes.error) {
      setFeedback({ variant: "error", message: `Failed to load locations: ${locationsRes.error.message}` });
    } else {
      setLocations(locationsRes.data ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // Mount-only fetch; `cancelled` guards against setting state after
    // unmount if the request is still in flight (matches the pattern in
    // src/app/admin/holders/page.tsx).
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadAll();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  const productsById = useMemo(() => {
    const map = new Map<string, ProductOption>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const locationsById = useMemo(() => {
    const map = new Map<string, LocationOption>();
    for (const l of locations) map.set(l.id, l);
    return map;
  }, [locations]);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);

  function describeTarget(row: ScanCode): string {
    if (row.kind === "product") {
      const product = row.product_id ? productsById.get(row.product_id) : undefined;
      return product ? `${product.name} (${product.tier})` : row.product_id ? "Unknown product" : "—";
    }
    if (row.kind === "group") {
      const location = row.location_id ? locationsById.get(row.location_id) : undefined;
      return location ? location.name : row.location_id ? "Unknown location" : "—";
    }
    return "—";
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setLastCreatedCode(null);

    if (kind === "product" && !productId) {
      setFeedback({ variant: "error", message: "Pick a product." });
      return;
    }
    if (kind === "group" && !locationId) {
      setFeedback({ variant: "error", message: "Pick a location." });
      return;
    }

    setCreating(true);
    try {
      const inserted = await insertScanCodeWithRetry(supabase, {
        kind,
        product_id: kind === "product" ? productId : null,
        location_id: kind === "group" ? locationId : null,
        label: label.trim() || null,
        active: true,
      });
      setLastCreatedCode(inserted.code);
      setFeedback({
        variant: "success",
        message: `Created code "${inserted.code}". Print this on the new label.`,
      });
      setLabel("");
      setProductId("");
      setLocationId("");
      await loadAll();
    } catch (err) {
      setFeedback({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to create scan code.",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRetire(row: ScanCode) {
    setFeedback(null);
    setBusyCode(row.code);
    try {
      const { error } = await supabase
        .from("scan_codes")
        .update({ active: false })
        .eq("code", row.code);
      if (error) throw error;
      setFeedback({ variant: "success", message: `Retired code "${row.code}".` });
      await loadAll();
    } catch (err) {
      setFeedback({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to retire code.",
      });
    } finally {
      setBusyCode(null);
    }
  }

  async function handleRegenerate(row: ScanCode) {
    setFeedback(null);
    setLastCreatedCode(null);
    setBusyCode(row.code);
    try {
      // Create the replacement first (same kind/target/label), then retire
      // the old one -- if the retire step fails the new code still exists
      // and the old one just needs a manual retire retry, rather than
      // ending up with neither code active.
      const replacement = await insertScanCodeWithRetry(supabase, {
        kind: row.kind,
        product_id: row.product_id,
        location_id: row.location_id,
        label: row.label,
        active: true,
      });

      const { error: retireError } = await supabase
        .from("scan_codes")
        .update({ active: false })
        .eq("code", row.code);
      if (retireError) {
        setFeedback({
          variant: "error",
          message: `New code "${replacement.code}" created, but retiring the old code "${row.code}" failed: ${retireError.message}. Retire it manually.`,
        });
        await loadAll();
        return;
      }

      setLastCreatedCode(replacement.code);
      setFeedback({
        variant: "success",
        message: `Regenerated: old code "${row.code}" retired, new code "${replacement.code}" is live. Print the new label.`,
      });
      await loadAll();
    } catch (err) {
      setFeedback({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to regenerate code.",
      });
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Scan codes</h1>
        <p className="mt-1 text-sm text-neutral-300">
          Every code points at exactly one product (a single-item label) or one location (a
          group label, e.g. a resistor-book page). Codes are opaque and auto-generated -- never
          typed in by hand. Retiring a code never deletes it: a stale sticker resolves to a clean
          &quot;retired&quot; instead of silently hitting the wrong item.
        </p>
      </div>

      {feedback ? (
        <Toast
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {lastCreatedCode ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Generated code: <span className="font-mono text-base font-semibold">{lastCreatedCode}</span>
          {" "}— print this on the label.
        </div>
      ) : null}

      <form
        onSubmit={handleCreate}
        className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-neutral-100">Create a new code</h2>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input
              type="radio"
              name="kind"
              value="product"
              checked={kind === "product"}
              onChange={() => setKind("product")}
            />
            Product (single item)
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input
              type="radio"
              name="kind"
              value="group"
              checked={kind === "group"}
              onChange={() => setKind("group")}
            />
            Group (a location, e.g. resistor-book page)
          </label>
        </div>

        {kind === "product" ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-200" htmlFor="product-select">
              Product
            </label>
            <select
              id="product-select"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full max-w-md rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            >
              <option value="">Select a product…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.tier})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-200" htmlFor="location-select">
              Location
            </label>
            <select
              id="location-select"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full max-w-md rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            >
              <option value="">Select a location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-200" htmlFor="label-input">
            Label (free text, optional)
          </label>
          <input
            id="label-input"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Table Shelf A3"
            className="w-full max-w-md rounded-lg border border-neutral-700 px-3 py-2 text-sm"
          />
        </div>

        <Button type="submit" disabled={creating}>
          {creating ? "Creating…" : "Generate code"}
        </Button>
      </form>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 shadow-sm">
        <div className="border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">All codes</h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-neutral-400">Loading…</p>
        ) : scanCodes.length === 0 ? (
          <p className="p-4 text-sm text-neutral-400">No scan codes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-800 text-neutral-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">Label</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scanCodes.map((row) => (
                  <tr key={row.code} className="border-b border-neutral-800 last:border-0">
                    <td className="px-4 py-2 font-mono">{row.code}</td>
                    <td className="px-4 py-2 capitalize">{row.kind}</td>
                    <td className="px-4 py-2">{describeTarget(row)}</td>
                    <td className="px-4 py-2 text-neutral-300">{row.label ?? "—"}</td>
                    <td className="px-4 py-2">
                      {row.active ? (
                        <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300">
                          Retired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {row.active ? (
                        <div className="flex gap-2">
                          {/* Reprint hands off to /admin/labels, which owns
                              the QR rendering and the sticker-sheet print
                              CSS -- a single sticker is just a batch of one,
                              and duplicating the geometry here is how the
                              two would drift apart. */}
                          <Link
                            href={`/admin/labels?code=${encodeURIComponent(row.code)}`}
                            className="inline-flex min-h-0 items-center justify-center rounded-lg bg-neutral-800 px-2 py-1 text-xs font-medium uppercase tracking-wide text-neutral-100 transition-colors hover:bg-neutral-700"
                          >
                            Print label
                          </Link>
                          <Button
                            variant="secondary"
                            className="min-h-0 px-2 py-1 text-xs"
                            disabled={busyCode === row.code}
                            onClick={() => handleRegenerate(row)}
                          >
                            {busyCode === row.code ? "Working…" : "Regenerate"}
                          </Button>
                          <Button
                            variant="danger"
                            className="min-h-0 px-2 py-1 text-xs"
                            disabled={busyCode === row.code}
                            onClick={() => handleRetire(row)}
                          >
                            Retire
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-neutral-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
