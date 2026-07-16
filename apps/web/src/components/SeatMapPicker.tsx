import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SeatMapView } from "@bookr/shared";

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

/**
 * Interactive seat-map picker: renders the auditorium as a grid (voids preserved as gaps,
 * occupied seats dimmed, wheelchair/companion seats badged) and lets the user mark their
 * acceptable seats by clicking individual seats or dragging a rectangle across a block.
 * Dragging over seats selects them; a drag that starts on an already-selected seat deselects
 * instead, so sweeping mistakes out works the way it feels like it should.
 */
export function SeatMapPicker({ view, selected, onChange }: SeatMapPickerProps): React.JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);
  const seatRefs = useRef(new Map<string, HTMLButtonElement>());
  const [drag, setDrag] = useState<DragRect | null>(null);
  const [dragDeselects, setDragDeselects] = useState(false);

  const selectedSet = new Set(selected);
  const rowIndex = new Map(view.map.rows.map((label, i) => [label, i]));

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
    <div className="seatmap" aria-label="Seat selection map">
      <div className="seatmap-screen">SCREEN</div>
      <div
        ref={gridRef}
        className="seatmap-grid"
        style={{ gridTemplateColumns: `repeat(${String(view.map.columns)}, var(--seat-size))` }}
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
              className={`seat${taken ? " seat-taken" : ""}${isSelected ? " seat-selected" : ""}`}
              style={{ gridColumn: seat.column, gridRow: (rowIndex.get(seat.row) ?? 0) + 1 }}
              title={`${seat.type ? `${seat.type} ` : ""}${seat.id}${taken ? " (occupied)" : ""}`}
              aria-pressed={isSelected}
              onClick={(e) => {
                // Rectangle drags commit on pointerup; only a stationary press is a toggle.
                if (!moved) toggle(seat.id);
                e.preventDefault();
              }}
            >
              {seat.type === "Wheelchair" ? "♿" : seat.type === "Companion" ? "C" : ""}
            </button>
          );
        })}
        {dragBox && moved && (
          <div
            className="seatmap-dragbox"
            style={{
              left: dragBox.left,
              top: dragBox.top,
              width: dragBox.right - dragBox.left,
              height: dragBox.bottom - dragBox.top,
            }}
          />
        )}
      </div>
      <div className="seatmap-legend">
        <span>
          {view.summary.availableSeats}/{view.summary.totalSeats} open ({view.summary.percentTaken}% taken)
        </span>
        <span className="seatmap-hint">
          {selected.length > 0 ? `${String(selected.length)} acceptable seats` : "click or drag to mark acceptable seats"}
        </span>
      </div>
    </div>
  );
}
