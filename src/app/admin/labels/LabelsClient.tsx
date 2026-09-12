"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconPrinter } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import { insertScanCodesWithRetry } from "@/lib/codes/insert";
import {
  inspectLabelUrlConfig,
  qrModuleCount,
  QR_V3_L_BYTE_BUDGET,
} from "@/lib/codes/label-url";
import { MIN_QR_SYMBOL_MM, symbolSizeMm } from "@/lib/codes/qr";
import { getBrowserClient } from "@/lib/supabase/browser";

import LabelSheet from "./LabelSheet";
import {
  ALL_LOCATIONS,
  buildLabelSpec,
  locationPath,
  matchesLocation,
  NO_LOCATION,
  sortForPrinting,
  type LabelLocation,
  type LabelProduct,
  type LabelSpec,
  type ScanCode,
} from "./label-spec";
import { PRINT_BODY_CLASS, SCREEN_ONLY_CLASS, sheetPrintCss } from "./print-css";
import {
  checkGeometry,
  DEFAULT_SHEET_ID,
  findSheetGeometry,
  labelsPerSheet,
  SHEET_GEOMETRIES,
} from "./sheet-geometry";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
const APP_NAME = process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "";

interface FeedbackState {
  variant: "success" | "error" | "info";
  message: string;
}

const INPUT_CLASS =
  "rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100";

export default function LabelsClient() {
  const supabase = useMemo(() => getBrowserClient(), []);
  const searchParams = useSearchParams();
  // Single-label reprint arrives as /admin/labels?code=A3F9K2 from the
  // "Print label" action on /admin/scan-codes -- one pipeline, not two.
  const requestedCode = searchParams.get("code");

  const [scanCodes, setScanCodes] = useState<ScanCode[]>([]);
  const [products, setProducts] = useState<LabelProduct[]>([]);
  const [locations, setLocations] = useState<LabelLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [locationFilter, setLocationFilter] = useState<string>(ALL_LOCATIONS);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetId, setSheetId] = useState(DEFAULT_SHEET_ID);
  const [generating, setGenerating] = useState(false);
  const [appliedRequestedCode, setAppliedRequestedCode] = useState(false);

  const geometry = findSheetGeometry(sheetId);

  /**
   * The whole reason this page is shaped the way it is. Version 3 at EC L
   * holds 53 bytes; one byte over and every sticker in the run silently
   * jumps to version 4 -- 33x33 modules instead of 29x29, ~12% finer at the
   * same 20 mm, which is the difference between a phone locking on and a
   * member giving up and typing the code. Checked on render, not in a
   * comment, so it cannot come back quietly after 500 labels are printed.
   */
  const urlBudget = useMemo(
    () => inspectLabelUrlConfig(BOT_USERNAME, APP_NAME),
    [],
  );

  const moduleCount = qrModuleCount(urlBudget.qrVersion ?? 4);
  const geometryWarnings = checkGeometry(geometry, moduleCount);
  const symbolMm = symbolSizeMm(geometry.qrBoxMm, moduleCount);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [codesRes, productsRes, locationsRes] = await Promise.all([
      supabase.from("scan_codes").select("*").order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id, name, location_id, tier, active, part_number")
        .order("name", { ascending: true }),
      supabase
        .from("locations")
        .select("id, name, parent_id")
        .order("name", { ascending: true }),
    ]);

    const firstError = codesRes.error ?? productsRes.error ?? locationsRes.error;
    if (firstError) {
      setLoadError(firstError.message);
      setLoading(false);
      return;
    }

    setScanCodes(codesRes.data ?? []);
    setProducts(productsRes.data ?? []);
    setLocations(locationsRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // Mount-only fetch with the `cancelled` guard used across /admin.
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadAll();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  // The print rules have to reach the admin chrome in layout.tsx, which this
  // page doesn't own; a body class scopes them to this route and restores
  // normal printing for every other admin page on unmount.
  useEffect(() => {
    document.body.classList.add(PRINT_BODY_CLASS);
    return () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
    };
  }, []);

  const locationsById = useMemo(() => {
    const map = new Map<string, LabelLocation>();
    for (const l of locations) map.set(l.id, l);
    return map;
  }, [locations]);

  const productsById = useMemo(() => {
    const map = new Map<string, LabelProduct>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const activeCodes = useMemo(
    () => scanCodes.filter((row) => row.active),
    [scanCodes],
  );

  /** Every printable label. `null` when the bot/app config is unusable. */
  const allSpecs = useMemo<LabelSpec[] | null>(() => {
    if (urlBudget.error) return null;
    return activeCodes.map((row) =>
      buildLabelSpec(row, {
        productsById,
        locationsById,
        botUsername: BOT_USERNAME,
        appName: APP_NAME,
      }),
    );
  }, [activeCodes, productsById, locationsById, urlBudget.error]);

  const visibleSpecs = useMemo(() => {
    if (!allSpecs) return [];
    const needle = search.trim().toLowerCase();
    return allSpecs.filter((spec) => {
      if (!matchesLocation(spec.locationId, locationFilter)) return false;
      if (!needle) return true;
      return (
        spec.title.toLowerCase().includes(needle) ||
        spec.code.toLowerCase().includes(needle)
      );
    });
  }, [allSpecs, locationFilter, search]);

  const selectedSpecs = useMemo(() => {
    if (!allSpecs) return [];
    return sortForPrinting(
      allSpecs.filter((spec) => selected.has(spec.code)),
      locationsById,
    );
  }, [allSpecs, selected, locationsById]);

  /**
   * Products in scope that have no active `product` scan code. These are
   * the bins that would get no sticker at all, which is the failure mode
   * that matters before a print run.
   */
  const productsMissingCodes = useMemo(() => {
    const covered = new Set(
      activeCodes
        .filter((row) => row.kind === "product" && row.product_id)
        .map((row) => row.product_id as string),
    );
    return products.filter(
      (p) =>
        p.active &&
        !covered.has(p.id) &&
        matchesLocation(p.location_id ?? null, locationFilter),
    );
  }, [products, activeCodes, locationFilter]);

  // Preselect the single code a reprint was requested for, once the rows
  // that prove it exists have arrived. Adjusted during render rather than in
  // an effect: this is state derived from `?code=` plus the loaded rows, and
  // an effect would paint the full unselected list for a frame first (and is
  // what react-hooks/set-state-in-effect exists to stop).
  if (!appliedRequestedCode && requestedCode && !loading && allSpecs) {
    const match = allSpecs.find((spec) => spec.code === requestedCode);
    setAppliedRequestedCode(true);
    if (match) {
      setSelected(new Set([match.code]));
      setFeedback({
        variant: "info",
        message: `Reprinting one label: "${match.code}" — ${match.title}.`,
      });
    } else {
      setFeedback({
        variant: "error",
        message: `No active scan code "${requestedCode}". It may have been retired — regenerate it on the Scan codes page.`,
      });
    }
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(visibleSpecs.map((s) => s.code)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  /**
   * Picking a location is the "print/reprint this whole shelf" gesture, so
   * it selects that shelf. Going back to "All locations" clears instead of
   * selecting 500 labels nobody asked to preview.
   */
  function handleLocationChange(next: string) {
    setLocationFilter(next);
    if (next === ALL_LOCATIONS || !allSpecs) {
      setSelected(new Set());
      return;
    }
    setSelected(
      new Set(
        allSpecs
          .filter((spec) => matchesLocation(spec.locationId, next))
          .map((spec) => spec.code),
      ),
    );
  }

  async function handleBulkGenerate() {
    if (productsMissingCodes.length === 0) return;
    setFeedback(null);
    setGenerating(true);
    try {
      const created = await insertScanCodesWithRetry(
        supabase,
        productsMissingCodes.map((p) => ({
          kind: "product",
          product_id: p.id,
          location_id: null,
          label: null,
          active: true,
        })),
      );
      setFeedback({
        variant: "success",
        message: `Generated ${created.length} scan code${created.length === 1 ? "" : "s"}. They are selected below — print the sheet.`,
      });
      await loadAll();
      setSelected((prev) => {
        const next = new Set(prev);
        for (const row of created) next.add(row.code);
        return next;
      });
    } catch (err) {
      setFeedback({
        variant: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to generate scan codes. Nothing else was changed.",
      });
    } finally {
      setGenerating(false);
    }
  }

  const columns: Column<LabelSpec>[] = [
    {
      key: "select",
      header: (
        <input
          type="checkbox"
          aria-label="Select all shown"
          checked={
            visibleSpecs.length > 0 &&
            visibleSpecs.every((spec) => selected.has(spec.code))
          }
          onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
        />
      ),
      className: "w-8",
      render: (spec) => (
        <input
          type="checkbox"
          aria-label={`Select ${spec.title}`}
          checked={selected.has(spec.code)}
          onChange={() => toggle(spec.code)}
        />
      ),
    },
    {
      key: "title",
      header: "Label",
      render: (spec) => <span className="text-neutral-100">{spec.title}</span>,
    },
    {
      key: "kind",
      header: "Kind",
      render: (spec) =>
        spec.kind === "group" ? (
          <StatusPill tone="warning">Group</StatusPill>
        ) : (
          <StatusPill tone="inactive">Product</StatusPill>
        ),
    },
    {
      key: "location",
      header: "Location",
      render: (spec) => locationPath(spec.locationId, locationsById) || "—",
    },
    {
      key: "code",
      header: "Code",
      className: "font-mono",
      render: (spec) => spec.code,
    },
  ];

  const perSheet = labelsPerSheet(geometry);
  const sheetCount = Math.ceil(selectedSpecs.length / perSheet);

  return (
    <div className="space-y-6">
      {/* Generated from the sheet geometry constants; also carries the
          @media print rules that hide the admin chrome. */}
      <style dangerouslySetInnerHTML={{ __html: sheetPrintCss(geometry) }} />

      <div className={SCREEN_ONLY_CLASS}>
        <PageHeader
          title="Labels"
          description="Generate and print the QR stickers. One label per storage compartment — a group label for a shelf of closely-related parts, a product label for everything else."
          actions={
            <Button
              onClick={() => window.print()}
              disabled={selectedSpecs.length === 0}
              className="gap-2"
            >
              <IconPrinter size={16} />
              <span className="ml-2">
                Print {selectedSpecs.length || "—"}
              </span>
            </Button>
          }
        />
      </div>

      {feedback ? (
        <div className={SCREEN_ONLY_CLASS}>
          <Toast
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        </div>
      ) : null}

      {/* --- the size budget, loudly ------------------------------------ */}
      <div className={SCREEN_ONLY_CLASS}>
        {urlBudget.error ? (
          <Toast variant="error" message={urlBudget.error} />
        ) : urlBudget.withinBudget ? (
          <Card title="Link size">
            <p className="text-sm text-neutral-300">
              <span className="font-mono text-neutral-100">{urlBudget.sampleUrl}</span>
              <br />
              {urlBudget.byteLength} of {QR_V3_L_BYTE_BUDGET} bytes — QR version{" "}
              {urlBudget.qrVersion} ({moduleCount}×{moduleCount} modules), printing at{" "}
              {symbolMm.toFixed(1)} mm on this sheet (minimum {MIN_QR_SYMBOL_MM} mm).
            </p>
          </Card>
        ) : (
          <Toast
            variant="error"
            message={
              <>
                <strong>Labels will print denser than they should.</strong> The link
                is {urlBudget.byteLength} bytes — {urlBudget.overBy} over the{" "}
                {QR_V3_L_BYTE_BUDGET}-byte budget for QR version 3, so every sticker
                encodes at version {urlBudget.qrVersion ?? "5+"} ({moduleCount}×
                {moduleCount} modules) and is harder to scan at{" "}
                {MIN_QR_SYMBOL_MM} mm. Shorten{" "}
                <span className="font-mono">NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME</span>{" "}
                (currently <span className="font-mono">{APP_NAME}</span>) or the bot
                username in BotFather before committing to a print run.
                <br />
                <span className="font-mono">{urlBudget.sampleUrl}</span>
              </>
            }
          />
        )}
      </div>

      {geometryWarnings.length > 0 ? (
        <div className={`space-y-2 ${SCREEN_ONLY_CLASS}`}>
          {geometryWarnings.map((warning) => (
            <Toast key={warning.id} variant="error" message={warning.message} />
          ))}
        </div>
      ) : null}

      {/* --- filters ---------------------------------------------------- */}
      <div className={SCREEN_ONLY_CLASS}>
        <Card title="Batch">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400" htmlFor="location-filter">
                Location
              </label>
              <select
                id="location-filter"
                className={INPUT_CLASS}
                value={locationFilter}
                onChange={(e) => handleLocationChange(e.target.value)}
              >
                <option value={ALL_LOCATIONS}>All locations</option>
                <option value={NO_LOCATION}>No location set</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locationPath(l.id, locationsById)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400" htmlFor="label-search">
                Search
              </label>
              <input
                id="label-search"
                type="search"
                className={INPUT_CLASS}
                value={search}
                placeholder="Name or code"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400" htmlFor="sheet-select">
                Sticker sheet
              </label>
              <select
                id="sheet-select"
                className={INPUT_CLASS}
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
              >
                {SHEET_GEOMETRIES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="min-h-0 px-2 py-1 text-xs"
                onClick={selectAllVisible}
                disabled={visibleSpecs.length === 0}
              >
                Select all shown
              </Button>
              <Button
                variant="ghost"
                className="min-h-0 px-2 py-1 text-xs"
                onClick={clearSelection}
                disabled={selected.size === 0}
              >
                Clear
              </Button>
            </div>
          </div>

          <p className="mt-3 text-sm text-neutral-400">
            {selectedSpecs.length} selected of {visibleSpecs.length} shown —{" "}
            {sheetCount} sheet{sheetCount === 1 ? "" : "s"} at {perSheet} per A4.
          </p>
        </Card>
      </div>

      {/* --- missing codes ---------------------------------------------- */}
      {productsMissingCodes.length > 0 ? (
        <div className={SCREEN_ONLY_CLASS}>
          <Card
            title={`${productsMissingCodes.length} product${productsMissingCodes.length === 1 ? "" : "s"} with no label code`}
            actions={
              <Button
                className="min-h-0 px-3 py-1.5 text-xs"
                onClick={handleBulkGenerate}
                disabled={generating}
              >
                {generating
                  ? "Generating…"
                  : `Generate ${productsMissingCodes.length} code${productsMissingCodes.length === 1 ? "" : "s"}`}
              </Button>
            }
          >
            <p className="text-sm text-neutral-400">
              These would get no sticker at all. Generating creates one active scan
              code each — opaque, 7 characters, never derived from the product — and
              adds them to the selection below.
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              {productsMissingCodes
                .slice(0, 12)
                .map((p) => p.name)
                .join(", ")}
              {productsMissingCodes.length > 12
                ? `, and ${productsMissingCodes.length - 12} more`
                : ""}
            </p>
          </Card>
        </div>
      ) : null}

      {/* --- picker ------------------------------------------------------ */}
      <div className={SCREEN_ONLY_CLASS}>
        <Card title="Labels" padded={false}>
          <DataTable
            columns={columns}
            rows={visibleSpecs}
            rowKey={(spec) => spec.code}
            loading={loading}
            error={loadError}
            emptyMessage="No active scan codes match this filter. Create them on the Scan codes page, or generate the missing ones above."
          />
        </Card>
      </div>

      {/* --- the sheet itself -------------------------------------------- */}
      {selectedSpecs.length === 0 ? (
        <div className={SCREEN_ONLY_CLASS}>
          <EmptyState message="Pick a location or tick some rows to build a sheet." />
        </div>
      ) : (
        <>
          <p className={`text-sm text-neutral-400 ${SCREEN_ONLY_CLASS}`}>
            Print preview — laser, matte polyester or vinyl, scaling set to 100%
            (not &quot;fit to page&quot;, which shrinks every QR below{" "}
            {MIN_QR_SYMBOL_MM} mm).
          </p>
          <LabelSheet specs={selectedSpecs} geometry={geometry} />
        </>
      )}
    </div>
  );
}
