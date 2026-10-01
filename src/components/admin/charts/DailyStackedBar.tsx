"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DailyPoint, SeriesDef } from "@/lib/reports/chart-data";

import Legend from "./Legend";
import { CHROME, slotColor } from "./theme";

export interface DailyStackedBarProps {
  data: DailyPoint[];
  series: SeriesDef[];
  /** "sessions", "movements": used in the tooltip total. */
  unit: string;
  height?: number;
  /** Makes each day clickable (e.g. to filter a list to that day). */
  onSelectDay?: (date: string) => void;
}

interface TooltipPayload {
  dataKey?: string | number;
  value?: number;
  payload?: DailyPoint;
}

function ChartTooltip({
  active,
  payload,
  series,
  unit,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  series: SeriesDef[];
  unit: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="min-w-36 rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-neutral-100">{point.label}</p>
      {series.map((def) => {
        const value = Number(point[def.key] ?? 0);
        if (value === 0) return null;
        return (
          <p key={def.key} className="flex items-center justify-between gap-4 text-neutral-300">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm" style={{ background: slotColor(def.slot) }} />
              {def.label}
            </span>
            <span className="tabular-nums">{value}</span>
          </p>
        );
      })}
      <p className="mt-1 flex justify-between gap-4 border-t border-neutral-800 pt-1 text-neutral-400">
        <span>Total</span>
        <span className="tabular-nums text-neutral-100">
          {point.total} {unit}
        </span>
      </p>
    </div>
  );
}

/**
 * Counts per day, stacked by a fixed set of series. The one time-series
 * form the admin needs: sessions by mode on the dashboard, movements by
 * kind on the ledger. Lazy-loaded (see ./lazy.tsx) so Recharts stays out of
 * every page that doesn't draw one.
 */
export default function DailyStackedBar({ data, series, unit, height = 220, onSelectDay }: DailyStackedBarProps) {
  const total = data.reduce((sum, point) => sum + point.total, 0);
  const lastIndex = series.length - 1;

  return (
    <div className="flex flex-col gap-3">
      <Legend series={series} />
      <div style={{ height }} role="img" aria-label={`${total} ${unit} over ${data.length} days, by day`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={CHROME.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: CHROME.grid }}
              tick={{ fill: CHROME.axis, fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: CHROME.axis, fontSize: 11 }}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={<ChartTooltip series={series} unit={unit} />}
              isAnimationActive={false}
            />
            {series.map((def, index) => (
              <Bar
                key={def.key}
                dataKey={def.key}
                name={def.label}
                stackId="day"
                fill={slotColor(def.slot)}
                // A 1px surface stroke on each segment reads as a 2px gap between them.
                stroke={CHROME.surface}
                strokeWidth={1}
                radius={index === lastIndex ? [4, 4, 0, 0] : 0}
                maxBarSize={28}
                isAnimationActive={false}
                cursor={onSelectDay ? "pointer" : undefined}
                onClick={
                  onSelectDay
                    ? (entry: { payload?: DailyPoint }) => {
                        if (entry.payload?.date) onSelectDay(entry.payload.date);
                      }
                    : undefined
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
