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
  const width = Math.min(preferredWidth, window.innerWidth - 16);
  const minimumTop =
    (document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0) +
    8;
  Object.assign(popup.style, {
    position: "fixed",
    width: `${width}px`,
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
  popup.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`;
  popup.style.top = `${upwards ? bounds.top - height - 6 : bounds.bottom + 6}px`;
  popup.style.maxHeight = `${height}px`;
}
