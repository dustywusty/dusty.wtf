export function extractUrlFromLink(link: Element | null): string {
  if (!link) return "";
  const explicit = (link.getAttribute("data-mud-ws") || link.getAttribute("data-mud") || "").trim();
  if (explicit) return explicit;
  const href = (link.getAttribute("href") || "").trim();
  if (/^wss?:\/\//i.test(href)) return href;
  const path = link.getAttribute("data-mud-path");
  if (path) {
    const base = location.protocol === "https:" ? "wss://" : "ws://";
    return `${base}${location.host}${path}`;
  }
  return "";
}

export function placeOverlay(
  root: HTMLElement,
  anchor: Element | null | undefined,
  mountSelector: string,
  lastAnchor: Element | null
): Element | null {
  const usableAnchor = anchor && anchor.nodeType === 1 && anchor.isConnected ? anchor : null;
  let inserted = false;
  if (usableAnchor) {
    const block = usableAnchor.closest(
      "[data-mud-mount],p,div,section,article,li,dd,dt,main,aside,header,footer,figure"
    );
    if (block && block.parentNode) {
      block.insertAdjacentElement("afterend", root);
      root.classList.add("embedded");
      inserted = true;
    }
  }
  if (!inserted) {
    const fallback = document.querySelector(mountSelector) || document.body;
    if (root.parentNode !== fallback) fallback.appendChild(root);
    if (fallback === document.body) root.classList.remove("embedded");
    else root.classList.add("embedded");
  }
  return inserted ? usableAnchor : anchor || lastAnchor;
}

export function resolveInitialUrl(initialUrl: string | undefined, anchor: Element | null, storageKey: string): string {
  const savedUrl = localStorage.getItem(storageKey) || "";
  const contextualLink = anchor && anchor.isConnected
    ? anchor
    : (document.querySelector("a[data-mud],a[data-mud-ws],a[href^=\"ws\"],a[href^=\"wss\"],[data-mud-mount]") as Element | null);
  const linkUrl = extractUrlFromLink(contextualLink);
  return initialUrl || savedUrl || linkUrl || "";
}
