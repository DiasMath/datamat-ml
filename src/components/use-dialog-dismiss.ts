"use client";
import { useRef, type PointerEvent } from "react";

// Only dismiss when the complete gesture happens on the backdrop. Selecting
// text or dragging from inside a form must never discard the user's work.
export default function useDialogDismiss(onDismiss: () => void) {
  const pointer = useRef<number | null>(null);
  function outside(event: PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  }
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) {
      pointer.current =
        event.button === 0 && outside(event) ? event.pointerId : null;
    },
    onPointerUp(event: PointerEvent<HTMLDialogElement>) {
      const dismiss = pointer.current === event.pointerId && outside(event);
      pointer.current = null;
      if (dismiss) onDismiss();
    },
    onPointerCancel() {
      pointer.current = null;
    },
  };
}
