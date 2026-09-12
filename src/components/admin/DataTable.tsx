import type { ReactNode } from "react";

import EmptyState from "./EmptyState";

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
  /** Renders the "Loading…" rung instead of the table. */
  loading?: boolean;
  /** Renders the error rung instead of the table. Message text, not an Error. */
  error?: string | null;
  /** Text for the empty rung. Default: "Nothing here yet." */
  emptyMessage?: ReactNode;
  className?: string;
}

/**
 * The admin list table. Deliberately minimal: columns + rows + the
 * loading/error/empty ladder, and nothing else. No sorting, no pagination,
 * no selection -- nothing needs them yet, and a primitive that guesses at
 * them is harder to delete than to add to.
 *
 * Designed to sit inside `<Card padded={false}>`: it brings its own cell
 * padding and its own horizontal scroll container, so it must not be
 * double-padded.
 *
 * The header style follows the majority convention in the existing pages
 * (holders / members / scan-codes): a single bottom border, muted text.
 * products/page.tsx's uppercase `bg-neutral-950` header is the outlier and
 * is not what this reproduces.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  emptyMessage = "Nothing here yet.",
  className = "",
}: DataTableProps<T>) {
  if (loading) {
    return <p className="p-4 text-sm text-neutral-400">Loading…</p>;
  }
  if (error) {
    return <p className="p-4 text-sm text-red-400">{error}</p>;
  }
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-2 font-medium ${
                  column.headerClassName ?? column.className ?? ""
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-neutral-800 last:border-0"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-2 text-neutral-300 ${column.className ?? ""}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
