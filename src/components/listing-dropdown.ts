export function positionListingDropdown(
  details: HTMLDetailsElement,
  selector: string,
  preferredWidth = 260,
  preferredHeight = 260,
) {
  if (!details.open) return;
  const popup = details.querySelector<HTMLElement>(selector);
  const anchor = details.querySelector("summary");
  if (!popup || !anchor) return;
  const bounds = anchor.getBoundingClientRect();
  // Keep existing popup styles within the viewport even before the next toggle
  // event runs after a window resize.
  const width = `min(${preferredWidth}px, calc(100vw - 16px))`;
  const minimumTop =
    (document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0) +
    8;
  Object.assign(popup.style, {
    position: "fixed",
    width,
    minWidth: "0",
    right: "auto",
    transform: "none",
    maxHeight: `${preferredHeight}px`,
  });
  const desiredHeight = Math.min(popup.scrollHeight + 2, preferredHeight);
  const below = Math.max(0, window.innerHeight - bounds.bottom - 14);
  const above = Math.max(0, bounds.top - minimumTop - 6);
  const upwards = desiredHeight > below && above > below;
  const height = Math.min(desiredHeight, upwards ? above : below);
  popup.style.left = `clamp(8px, ${bounds.left}px, calc(100vw - ${width} - 8px))`;
  popup.style.top = `${upwards ? bounds.top - height - 6 : bounds.bottom + 6}px`;
  popup.style.maxHeight = `${height}px`;
}
