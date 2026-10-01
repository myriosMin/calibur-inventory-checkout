"use client";

import dynamic from "next/dynamic";

import Skeleton from "../Skeleton";

/**
 * Recharts is the heaviest thing in /admin. Loading it on demand keeps it
 * out of the first load of every page, including the ones that chart
 * something, which paint their numbers first and their chart a moment later.
 */
export const DailyStackedBar = dynamic(() => import("./DailyStackedBar"), {
  ssr: false,
  loading: () => <Skeleton className="h-[248px] w-full" />,
});
