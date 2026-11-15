// Loading, error and empty states for a query, consistently.
import type { ReactNode } from "react";
import { EmptyState, ErrorState, Skeleton } from "@drift/ui";

export function Loading({ label = "Loading", lines = 6 }: { label?: string; lines?: number }) {
  return (
    <div className="st-loading" role="status" aria-label={label}>
      <Skeleton lines={lines} height={14} />
    </div>
  );
}

export function QueryState({ isLoading, error, onRetry, children, empty, loadingLabel }: { isLoading: boolean; error: unknown; onRetry?: () => void; children: ReactNode; empty?: { title: string; body?: ReactNode; action?: ReactNode } | null; loadingLabel?: string }) {
  if (isLoading) return <Loading label={loadingLabel} />;
  if (error) return <ErrorState title="Drift could not produce this data" error={error} onRetry={onRetry} />;
  if (empty) return <EmptyState title={empty.title} action={empty.action}>{empty.body}</EmptyState>;
  return <>{children}</>;
}
