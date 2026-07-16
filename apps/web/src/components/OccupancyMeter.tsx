import { cn } from "@/lib/utils.ts";

/** Props for {@link OccupancyMeter}. */
export interface OccupancyMeterProps {
  /** Percentage of seats taken, 0–100. */
  percentTaken: number;
  /** Optional open-seat count, shown in the readout when paired with {@link totalSeats}. */
  availableSeats?: number;
  /** Optional total-seat count for the readout. */
  totalSeats?: number;
  /** Render a compact single-line variant (used inside dense table rows). */
  compact?: boolean;
  /** Additional classes for the wrapper. */
  className?: string;
}

/** Map an occupancy percentage onto the availability heat scale (open → filling → full). */
function heatToken(percentTaken: number): { bar: string; text: string } {
  if (percentTaken >= 90) return { bar: "bg-full", text: "text-full" };
  if (percentTaken >= 60) return { bar: "bg-warn", text: "text-warn" };
  return { bar: "bg-signal", text: "text-signal" };
}

/**
 * A horizontal occupancy readout: a heat-colored fill bar (green when seats are plentiful,
 * amber as it fills, red when nearly sold out) with a monospace percentage. The color scale is
 * the load-bearing signal — at a glance it says whether a showtime is worth chasing.
 */
export function OccupancyMeter({
  percentTaken,
  availableSeats,
  totalSeats,
  compact = false,
  className,
}: OccupancyMeterProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(percentTaken)));
  const heat = heatToken(pct);
  const showCounts = availableSeats !== undefined && totalSeats !== undefined;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="bg-muted relative h-1.5 w-full min-w-16 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="seats taken"
      >
        <div className={cn("h-full rounded-full transition-[width]", heat.bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("tnum shrink-0 text-xs font-medium", heat.text)}>{pct}%</span>
      {!compact && showCounts && (
        <span className="tnum text-muted-foreground shrink-0 text-xs">
          {availableSeats}/{totalSeats} open
        </span>
      )}
    </div>
  );
}
