"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import EmptyState from "./EmptyState";
import { TableSkeleton } from "./Skeleton";

export interface Column<T> {
  /** React key for the column, and nothing else -- not a field accessor. */
  key: string;
  header: ReactNode;
  /** Cell content for one row. Return "—" yourself for nulls. */
  render: (row: T) => ReactNode;
  /** Extra classes on this column's <td> (e.g. "text-right"). */
  className?: string;
  /** Extra classes on this column's <th>. Defaults to `className` so an
   *  aligned column stays aligned in the header without repeating it. */
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable React key per row. */
  rowKey: (row: T) => string;
  /**
   * Makes the whole row open this URL, so a row needs no "Open"/"Edit"
   * button of its own. Click or Enter. Buttons and links inside the row
   * keep working on their own (ActionMenu stops propagation).
   */
  rowHref?: (row: T) => string | null;
  /** Like rowHref, for rows that open something in place (a Drawer). */
  onRowClick?: (row: T) => void;
  /** Renders a skeleton instead of the table. */
  loading?: boolean;
  /** Renders the error rung instead of the table. Message text, not an Error. */
  error?: string | null;
  /** Text for the empty rung. Default: "Nothing here yet." */
  emptyMessage?: ReactNode;
  /**
   * Rows rendered before a "Show N more" button. Long lists stay quick to
   * scan, and to render. Default 50; pass Infinity to turn it off.
   */
  pageSize?: number;
  className?: string;
}

/**
 * The admin list table: columns + rows + the loading/error/empty ladder,
 * optional whole-row links and a render cap. No sorting or selection --
 * nothing needs them yet, and a primitive that guesses at them is harder to
 * delete than to add to.
 *
 * Designed to sit inside `<Card padded={false}>`: it brings its own cell
 * padding and its own horizontal scroll container.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  onRowClick,
  loading = false,
  error = null,
  emptyMessage = "Nothing here yet.",
  pageSize = 50,
  className = "",
}: DataTableProps<T>) {
  const router = useRouter();
  const [limit, setLimit] = useState(pageSize);

  if (loading && rows.length === 0) {
    return <TableSkeleton />;
  }
  if (error) {
    return <p className="p-4 text-sm text-red-400">{error}</p>;
  }
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-xs text-neutral-500">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-4 py-2 font-medium ${column.headerClassName ?? column.className ?? ""}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const href = rowHref?.(row) ?? null;
              const open = href ? () => router.push(href) : onRowClick ? () => onRowClick(row) : null;
              return (
                <tr
                  key={rowKey(row)}
                  className={`border-b border-neutral-800/70 last:border-0 ${
                    open ? "cursor-pointer transition-colors hover:bg-neutral-800/40 focus-visible:bg-neutral-800/40" : ""
                  }`}
                  tabIndex={open ? 0 : undefined}
                  onClick={
                    open
                      ? (event) => {
                          // A click on a control inside the row is that control's.
                          if ((event.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
                          open();
                        }
                      : undefined
                  }
                  onKeyDown={
                    open
                      ? (event) => {
                          if (event.key === "Enter" && event.target === event.currentTarget) open();
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-2.5 text-neutral-300 ${column.className ?? ""}`}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <div className="border-t border-neutral-800/70 p-2 text-center">
          <button
            type="button"
            onClick={() => setLimit((value) => value + pageSize)}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          >
            Show {Math.min(hidden, pageSize)} more
            <span className="text-neutral-500"> · {rows.length} total</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
