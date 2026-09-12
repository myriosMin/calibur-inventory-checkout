import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** "No movements yet." -- a full sentence, not a fragment. */
  message: ReactNode;
  /** Optional call to action (a Button or Link) under the message. */
  action?: ReactNode;
  className?: string;
}

/**
 * The bottom rung of the loading / error / empty ladder every admin list
 * renders. Padded to sit flush inside an unpadded Card, matching the
 * existing `<p className="p-4 text-sm text-neutral-400">No X yet.</p>`.
 */
export default function EmptyState({
  message,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`p-4 ${className}`}>
      <p className="text-sm text-neutral-400">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
