import { Activity, KeyRound, LogOut, Radar, Ticket, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

/** The dashboard's top-level sections. */
export type Tab = "watches" | "activity" | "credentials" | "health";

const NAV_ITEMS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "watches", label: "Watches", icon: Radar },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "credentials", label: "Credentials", icon: KeyRound },
  { id: "health", label: "Health", icon: Ticket },
];

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** The currently selected tab. */
  active: Tab;
  /** Called with the newly selected tab id. */
  onSelect: (tab: Tab) => void;
  /** Called when the operator asks to log out. */
  onLogout: () => void;
  /** The active screen's content. */
  children: ReactNode;
}

/**
 * Responsive application chrome. A single navigation element reflows between a left sidebar on
 * wide viewports and a fixed bottom tab bar on phones (kept as one DOM node so each destination
 * has exactly one accessible control), paired with a persistent top bar carrying the brand and
 * the lone log-out button. Content is centered with generous breathing room and extra bottom
 * padding on mobile so it clears the floating tab bar.
 */
export function AppShell({ active, onSelect, onLogout, children }: AppShellProps): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <Ticket className="size-4" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Bookr</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground gap-2">
          <LogOut className="size-4" />
          <span className="hidden sm:inline">Log out</span>
        </Button>
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Primary"
          className={cn(
            "bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t px-2 py-1.5 backdrop-blur-md",
            "md:sticky md:top-14 md:bottom-auto md:z-0 md:h-[calc(100dvh-3.5rem)] md:w-56 md:flex-col md:items-stretch md:justify-start md:gap-1 md:border-t-0 md:border-r md:px-3 md:py-4",
          )}
        >
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const isActive = id === active;
            return (
              <button
                key={id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(id)}
                className={cn(
                  "group flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[0.7rem] font-medium transition-colors",
                  "md:flex-none md:flex-row md:gap-3 md:px-3 md:py-2 md:text-sm",
                  isActive
                    ? "text-primary md:bg-primary/10"
                    : "text-muted-foreground hover:text-foreground md:hover:bg-accent",
                )}
              >
                <Icon className="size-5 md:size-[1.05rem]" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 md:px-8 md:pt-10 md:pb-14">
          {children}
        </main>
      </div>
    </div>
  );
}
