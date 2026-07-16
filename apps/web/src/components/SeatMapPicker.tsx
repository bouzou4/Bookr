import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Accessibility } from "lucide-react";
import type { SeatMapView } from "@bookr/shared";
import { cn } from "../lib/utils.ts";
import { OccupancyMeter } from "./OccupancyMeter.tsx";

/** Props for {@link SeatMapPicker}. */
export interface SeatMapPickerProps {
  /** The seat map to render (layout, signature, occupancy). */
  view: SeatMapView;
  /** Currently selected (acceptable) seat names. */
  selected: string[];
  /** Called with the full selection whenever it changes. */
  onChange: (seats: string[]) => void;
}

/** The in-flight drag rectangle, in pixel coordinates relative to the grid. */
interface DragRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function normalize(rect: DragRect): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(rect.x1, rect.x2),
    top: Math.min(rect.y1, rect.y2),
    right: Math.max(rect.x1, rect.x2),
    bottom: Math.max(rect.y1, rect.y2),
  };
}

/** Pixel distance under which a pointer gesture counts as a click, not a drag. */
const CLICK_TOLERANCE = 5;

/** Comfortable keycap width on a roomy viewport; the grid caps here and shrinks to fit below it. */
const SEAT_MAX_REM = 2.4;

/** Small legend entry: a swatch matching a seat state plus its label. */
function LegendSwatch({ swatchClassName, label }: { swatchClassName: string; label: string }): React.JSX.Element {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-[0.7rem]">
      <span className={cn("size-3 shrink-0 rounded-[3px] border", swatchClassName)} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Interactive seat-map picker: renders the auditorium as a grid of keycap buttons (voids
 * preserved as gaps, occupied seats dashed and dimmed, wheelchair/companion seats badged) and
 * lets the user mark their acceptable seats by clicking individual seats or dragging a rectangle
 * across a block. Marking an occupied seat is deliberate — the watch alerts when it frees up, so
 * taken seats stay fully clickable, just visually muted. Dragging over seats selects them; a drag
 * that starts on an already-selected seat deselects instead, so sweeping mistakes out works the
 * way it feels like it should.
 */
export function SeatMapPicker({ view, selected, onChange }: SeatMapPickerProps): React.JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);
  const seatRefs = useRef(new Map<string, HTMLButtonElement>());
  const [drag, setDrag] = useState<DragRect | null>(null);
  const [dragDeselects, setDragDeselects] = useState(false);

  const selectedSet = new Set(selected);
  const rowIndex = new Map(view.map.rows.map((label, i) => [label, i]));
  const statusById = new Map(view.map.seats.map((s) => [s.id, s.status]));
  const openWanted = selected.filter((id) => statusById.get(id) === "available").length;
  const takenWanted = selected.length - openWanted;

  function toggle(seatId: string): void {
    const next = new Set(selectedSet);
    if (next.has(seatId)) next.delete(seatId);
    else next.add(seatId);
    onChange([...next]);
  }

  function gridPoint(e: ReactPointerEvent): { x: number; y: number } {
    const bounds = gridRef.current?.getBoundingClientRect();
    return { x: e.clientX - (bounds?.left ?? 0), y: e.clientY - (bounds?.top ?? 0) };
  }

  function seatsInRect(rect: DragRect): string[] {
    const bounds = gridRef.current?.getBoundingClientRect();
    if (!bounds) return [];
    const sel = normalize(rect);
    const hits: string[] = [];
    for (const [id, el] of seatRefs.current) {
      const r = el.getBoundingClientRect();
      const left = r.left - bounds.left;
      const top = r.top - bounds.top;
      if (left < sel.right && left + r.width > sel.left && top < sel.bottom && top + r.height > sel.top) {
        hits.push(id);
      }
    }
    return hits;
  }

  function handlePointerDown(e: ReactPointerEvent): void {
    if (e.button !== 0) return;
    const { x, y } = gridPoint(e);
    setDrag({ x1: x, y1: y, x2: x, y2: y });
    // A drag beginning on a selected seat sweeps seats OUT of the selection.
    const startSeat = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-seat]")?.dataset.seat;
    setDragDeselects(startSeat != null && selectedSet.has(startSeat));
    // Keep receiving move/up events when the pointer leaves the grid mid-drag. Feature-detected:
    // pointer capture is missing in some environments (e.g. jsdom).
    if (typeof gridRef.current?.setPointerCapture === "function") {
      gridRef.current.setPointerCapture(e.pointerId);
    }
  }

  function handlePointerMove(e: ReactPointerEvent): void {
    if (!drag) return;
    const { x, y } = gridPoint(e);
    setDrag({ ...drag, x2: x, y2: y });
  }

  function handlePointerUp(): void {
    if (!drag) return;
    const moved = Math.abs(drag.x2 - drag.x1) > CLICK_TOLERANCE || Math.abs(drag.y2 - drag.y1) > CLICK_TOLERANCE;
    if (moved) {
      const hits = seatsInRect(drag);
      const next = new Set(selectedSet);
      for (const id of hits) {
        if (dragDeselects) next.delete(id);
        else next.add(id);
      }
      onChange([...next]);
    }
    setDrag(null);
  }

  const dragBox = drag && normalize(drag);
  const moved = drag && (Math.abs(drag.x2 - drag.x1) > CLICK_TOLERANCE || Math.abs(drag.y2 - drag.y1) > CLICK_TOLERANCE);

  return (
    <div aria-label="Seat selection map" className="bg-card/60 rounded-xl border p-4 sm:p-6">
      <p className="text-muted-foreground mb-5 text-xs leading-relaxed">
        You&apos;re looking at <span className="text-foreground font-medium">this showtime&apos;s</span> live
        seat map, but the seats you mark are saved for{" "}
        <span className="text-foreground font-medium">this auditorium&apos;s layout</span> and reused for every
        showtime and movie here. <span className="text-signal font-medium">Green</span> = a seat you want that&apos;s
        open now; <span className="text-primary font-medium">amber</span> = one you want that&apos;s currently
        booked (the watch pings you when it frees).
      </p>

      {/* Curved "screen" header, purely decorative context for the grid below. */}
      <div aria-hidden className="mb-6 flex flex-col items-center gap-2">
        <div className="border-foreground/20 from-foreground/[0.07] h-4 w-full max-w-sm rounded-t-[100%] border-t bg-gradient-to-b to-transparent" />
        <span className="text-muted-foreground text-[0.65rem] font-semibold tracking-[0.35em] uppercase">
          Screen
        </span>
      </div>

      <div className="flex justify-center pb-1">
        <div
          ref={gridRef}
          className="relative grid w-full gap-1 sm:gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${String(view.map.columns)}, minmax(0, 1fr))`,
            maxWidth: `${String(view.map.columns * SEAT_MAX_REM)}rem`,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {view.map.seats.map((seat) => {
            const taken = seat.status !== "available";
            const isSelected = selectedSet.has(seat.id);
            return (
              <button
                key={seat.id}
                ref={(el) => {
                  if (el) seatRefs.current.set(seat.id, el);
                  else seatRefs.current.delete(seat.id);
                }}
                type="button"
                data-seat={seat.id}
                className={cn(
                  "tnum relative flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border text-[clamp(0.5rem,2vw,0.65rem)] leading-none font-semibold transition-colors select-none",
                  isSelected && !taken
                    ? // Wanted and open right now — bookable this showtime.
                      "bg-signal border-signal text-signal-foreground shadow-sm"
                    : isSelected && taken
                      ? // Wanted but currently booked — the watch waits for it to free up.
                        "border-primary bg-primary/20 text-primary border-dashed"
                      : taken
                        ? "border-border bg-muted/40 text-muted-foreground/60 border-dashed"
                        : "border-input bg-card text-foreground/80 hover:border-primary/60 hover:bg-accent",
                )}
                style={{
                  gridColumn: seat.column,
                  gridRow: (rowIndex.get(seat.row) ?? 0) + 1,
                }}
                title={`${seat.type ? `${seat.type} ` : ""}${seat.id}${taken ? " (occupied)" : ""}`}
                aria-pressed={isSelected}
                onClick={(e) => {
                  // Rectangle drags commit on pointerup; only a stationary press is a toggle.
                  if (!moved) toggle(seat.id);
                  e.preventDefault();
                }}
              >
                {seat.type === "Wheelchair" ? (
                  <Accessibility aria-hidden className="size-[58%]" />
                ) : seat.type === "Companion" ? (
                  <span className="text-[0.85em] leading-none font-bold">C</span>
                ) : (
                  seat.id
                )}
              </button>
            );
          })}
          {dragBox && moved && (
            <div
              className="border-primary bg-primary/10 pointer-events-none absolute rounded-sm border"
              style={{
                left: dragBox.left,
                top: dragBox.top,
                width: dragBox.right - dragBox.left,
                height: dragBox.bottom - dragBox.top,
              }}
            />
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <OccupancyMeter
          percentTaken={view.summary.percentTaken}
          availableSeats={view.summary.availableSeats}
          totalSeats={view.summary.totalSeats}
          className="max-w-56"
        />
        <div className="sm:text-right">
          <p className="seatmap-hint text-foreground text-xs font-medium">
            {selected.length > 0
              ? `${String(selected.length)} acceptable seats`
              : "click or drag to mark acceptable seats"}
          </p>
          {selected.length > 0 && (
            <p className="tnum text-muted-foreground mt-0.5 text-[0.7rem]">
              <span className="text-signal font-medium">{openWanted} open now</span>
              {" · "}
              <span className="text-primary font-medium">{takenWanted} booked this showtime</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        <LegendSwatch swatchClassName="border-input bg-card" label="Available" />
        <LegendSwatch swatchClassName="border-border bg-muted/40 border-dashed" label="Taken" />
        <LegendSwatch swatchClassName="border-signal bg-signal" label="Want · open now" />
        <LegendSwatch swatchClassName="border-primary bg-primary/20 border-dashed" label="Want · booked" />
        <span className="text-muted-foreground flex items-center gap-1.5 text-[0.7rem]">
          <Accessibility className="size-3.5" />
          Wheelchair / companion
        </span>
      </div>
    </div>
  );
}
