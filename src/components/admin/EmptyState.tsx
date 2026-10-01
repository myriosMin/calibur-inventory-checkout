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
 * renders. Padded to sit flush inside an unpadded Card.
 */
export default function EmptyState({ message, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`px-4 py-8 text-center ${className}`}>
      <p className="text-sm text-neutral-500">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
