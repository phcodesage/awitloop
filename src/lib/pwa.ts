/* Installable app: service worker registration, the install prompt, and "last room". */

let deferred: any = null;
const listeners = new Set<() => void>();

export function initPwa() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support is a bonus; the app works without it */
      });
    });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own button instead of the mini-infobar
    deferred = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** "native" = Chrome/Edge/Android can install with one tap; "ios" = needs Share → Add to Home Screen. */
export function installMode(): "native" | "ios" | null {
  if (isStandalone()) return null;
  if (deferred) return "native";
  if (isIos()) return "ios";
  return null;
}

export function onInstallChange(fn: () => void) {
  listeners.add(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  listeners.forEach((fn) => fn());
  return choice?.outcome === "accepted";
}

/* ---------- last room, so the installed app can drop you back in ---------- */

export interface LastRoom {
  code: string;
  role: "host" | "remote" | "stage";
  at: number;
}

export function rememberRoom(code: string, role: LastRoom["role"]) {
  try {
    localStorage.setItem("awitloop:lastRoom", JSON.stringify({ code, role, at: Date.now() }));
  } catch {}
}

export function lastRoom(): LastRoom | null {
  try {
    const r = JSON.parse(localStorage.getItem("awitloop:lastRoom") || "null") as LastRoom | null;
    // Rooms are wiped after 3 idle days; don't offer anything older.
    return r && Date.now() - r.at < 3 * 24 * 3600 * 1000 ? r : null;
  } catch {
    return null;
  }
}

export function roomPath(r: LastRoom) {
  return r.role === "host" ? `/r/${r.code}` : r.role === "stage" ? `/tv/${r.code}` : `/${r.code}`;
}
