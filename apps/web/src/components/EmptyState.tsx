import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /** Icon rendered in the centered medallion. */
  icon: LucideIcon;
  /** Headline describing the empty condition. */
  title: string;
  /** Supporting sentence with guidance on what to do next. */
  description?: string;
  /** Optional call-to-action (typically a button). */
  action?: ReactNode;
}

/**
 * Centered empty-state placeholder for screens with no data yet: a tokened icon medallion, a
 * title, an optional description, and an optional call-to-action. Gives blank screens a
 * deliberate, designed feel instead of a bare "nothing here" line.
 */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="border-border/70 bg-card/40 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
        <Icon className="size-6" />
      </div>
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold">{title}</p>
        {description && <p className="text-muted-foreground mx-auto max-w-sm text-sm">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
