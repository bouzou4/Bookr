import type { ReactNode } from "react";

/** Props for {@link PageHeader}. */
export interface PageHeaderProps {
  /** Small uppercase eyebrow label rendered above the title. */
  eyebrow?: string;
  /** The screen title. */
  title: string;
  /** Optional supporting sentence rendered under the title. */
  description?: string;
  /** Optional actions (buttons, filters) aligned to the end on wide viewports. */
  actions?: ReactNode;
}

/**
 * Section header shared across dashboard screens: an editorial title block with an optional
 * eyebrow and description, plus a trailing actions slot that stacks below the title on narrow
 * (mobile) viewports and sits inline on wider ones.
 */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps): React.JSX.Element {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        {eyebrow && (
          <p className="text-primary text-xs font-medium tracking-[0.2em] uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="text-muted-foreground max-w-prose text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
