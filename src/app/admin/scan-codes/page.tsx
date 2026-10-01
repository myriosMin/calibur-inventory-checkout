"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import ActionMenu from "@/components/admin/ActionMenu";
import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import Drawer from "@/components/admin/Drawer";
import { CAPTION, FIELD, FILTER, HELP, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import Segmented from "@/components/admin/Segmented";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconPlus, IconPrinter, IconSearch } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import { KEYS, revalidate, useLocations, useProducts, useScanCodes } from "@/lib/admin/queries";
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
  const supabase = getBrowserClient();

  // Shared, paged, cached lists (src/lib/admin/queries.ts) -- the Labels
  // tab reads the same ones, so switching between the two is instant.
  const codesQ = useScanCodes();
  const productsQ = useProducts();
  const locationsQ = useLocations();
  const scanCodes: ScanCode[] = useMemo(() => codesQ.data ?? [], [codesQ.data]);
  const products: ProductOption[] = useMemo(() => productsQ.data ?? [], [productsQ.data]);
  const locations: LocationOption[] = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  const loading = codesQ.isLoading;
  const loadAll = () => revalidate(KEYS.scanCodes);

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "retired" | "all">("active");
  const [query, setQuery] = useState("");

  // Create-form state.
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("product");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

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
      setFormOpen(false);
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

  const activeCount = scanCodes.filter((row) => row.active).length;
  const visible = scanCodes.filter((row) => {
    if (status === "active" && !row.active) return false;
    if (status === "retired" && row.active) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
      row.code.toLowerCase().includes(needle) ||
      describeTarget(row).toLowerCase().includes(needle) ||
      (row.label ?? "").toLowerCase().includes(needle)
    );
  });

  const columns: Column<ScanCode>[] = [
    {
      key: "code",
      header: "Code",
      render: (row) => (
        <span className={`font-mono ${row.code === lastCreatedCode ? "text-green-400" : "text-neutral-100"}`}>{row.code}</span>
      ),
    },
    {
      key: "target",
      header: "Points at",
      render: (row) => (
        <span className="block min-w-48">
          <span className="text-neutral-200">{describeTarget(row)}</span>
          {row.label ? <span className="block text-xs text-neutral-500">{row.label}</span> : null}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (row) =>
        row.kind === "group" ? <StatusPill tone="warning">group</StatusPill> : <span className="text-neutral-500">product</span>,
    },
    {
      key: "status",
      header: "",
      render: (row) => (row.active ? null : <StatusPill tone="inactive">retired</StatusPill>),
    },
    {
      key: "actions",
      header: "",
      className: "text-right whitespace-nowrap",
      render: (row) =>
        row.active ? (
          <span className="inline-flex items-center gap-1">
            <Link
              href={`/admin/labels?code=${encodeURIComponent(row.code)}`}
              className="inline-flex size-9 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
              aria-label={`Print label ${row.code}`}
              title="Print label"
            >
              <IconPrinter size={17} />
            </Link>
            <ActionMenu
              ariaLabel={`More actions for ${row.code}`}
              items={[
                {
                  label: "Regenerate",
                  hint: "New code for a damaged label; retires this one",
                  disabled: busyCode === row.code,
                  onSelect: () => void handleRegenerate(row),
                },
                {
                  label: "Retire",
                  hint: "The sticker will scan as retired",
                  tone: "danger",
                  disabled: busyCode === row.code,
                  onSelect: () => void handleRetire(row),
                },
              ]}
            />
          </span>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Scan codes"
        description={loading ? "What each QR sticker points at." : `${activeCount} live codes. Each points at one product or one shelf.`}
        info={
          <>
            <p>
              A product code is a single-item label; a group code is a location (a resistor-book page) where the
              member picks from a list.
            </p>
            <p>
              Codes are opaque and generated, never typed. Retiring never deletes: a stale sticker scans as
              &ldquo;retired&rdquo; instead of silently hitting the wrong item.
            </p>
          </>
        }
        actions={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <IconPlus size={16} />
            New code
          </Button>
        }
      />

      {feedback ? <Toast variant={feedback.variant} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          ariaLabel="Code status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Live", count: activeCount },
            { value: "retired", label: "Retired", count: scanCodes.length - activeCount },
            { value: "all", label: "All", count: scanCodes.length },
          ]}
        />
        <label className="relative block">
          <span className="sr-only">Search codes</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Code, product or shelf…"
            className={`${FILTER} w-64 pl-9`}
          />
        </label>
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => row.code}
          loading={loading}
          error={(codesQ.error as Error | undefined)?.message ?? null}
          emptyMessage={scanCodes.length === 0 ? "No scan codes yet." : "No codes match."}
        />
      </Card>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New scan code"
        description="A fresh opaque code. Print its label afterwards."
        footer={
          <>
            <Button type="submit" form="new-scan-code" size="sm" disabled={creating}>
              {creating ? "Creating…" : "Create code"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <form id="new-scan-code" onSubmit={handleCreate} className="flex flex-col gap-4">
          {feedback?.variant === "error" ? <Toast variant="error" message={feedback.message} /> : null}
          <fieldset className="flex flex-col gap-2">
            <legend className={`${CAPTION} mb-1.5 text-sm`}>Points at</legend>
            <Segmented
              ariaLabel="Code kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: "product", label: "One product" },
                { value: "group", label: "A shelf (group)" },
              ]}
            />
          </fieldset>
          {kind === "product" ? (
            <label className={LABEL}>
              <span className={CAPTION}>Product</span>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={FIELD}>
                <option value="">Select a product…</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.tier})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={LABEL}>
              <span className={CAPTION}>Location</span>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={FIELD}>
                <option value="">Select a location…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <span className={HELP}>Scanning it shows the member everything on that shelf to pick from.</span>
            </label>
          )}
          <label className={LABEL}>
            <span className={CAPTION}>Label text</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional" className={FIELD} />
          </label>
        </form>
      </Drawer>
    </div>
  );
}
