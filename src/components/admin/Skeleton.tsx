/**
 * Placeholder blocks that hold a component's shape while its data loads, so
 * the page doesn't jump when numbers arrive. Replaces the bare "Loading…".
 */
export default function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-neutral-800/70 motion-reduce:animate-none ${className}`} />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
