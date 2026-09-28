import qrcode from "qrcode-generator";
import type { Song } from "../../shared/protocol";

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, any> & { class?: string };

/** Tiny hyperscript helper. Keeps the bundle small enough for old TV browsers. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") el.innerHTML = v;
      else if (k in el && typeof v !== "string") (el as any)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** Karaoke uploads have noisy titles; strip the boilerplate for display. */
export function cleanTitle(t: string): string {
  return (
    t
      .replace(/[\[(【]([^\])】]*?(karaoke|instrumental|lyrics|version|minus one|videoke|with guide|mv|hd|4k)[^\])】]*)[\])】]/gi, "")
      .replace(/\b(karaoke version|karaoke|videoke|instrumental with lyrics|with lyrics|lyrics)\b/gi, "")
      .replace(/\s*[|｜].*$/, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[\s\-–—:]+$/, "")
      .replace(/^[\s\-–—:|]+/, "")
      .trim() || t
  );
}

const ICONS: Record<string, string> = {
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4.5" height="16" rx="1.2" fill="currentColor"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2" fill="currentColor"/>',
  skip: '<path d="M5 5.2v13.6a.9.9 0 0 0 1.4.75L16 13v5.5a1 1 0 0 0 2 0v-13a1 1 0 0 0-2 0V11L6.4 4.45A.9.9 0 0 0 5 5.2Z" fill="currentColor"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.35-5.65M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  back10: '<path d="M11 5 6 9l5 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 9h8a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  fwd10: '<path d="m13 5 5 4-5 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 9h-8a5 5 0 0 0 0 10h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 16.9l-5.25 2.76 1-5.86L3.5 9.66l5.9-.86Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  starFill: '<path d="m12 3.5 2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 16.9l-5.25 2.76 1-5.86L3.5 9.66l5.9-.86Z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  next: '<path d="M4 7h10M4 12h10M4 17h6M17 14l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  up: '<path d="m6 14 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  queue: '<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  fire: '<path d="M12 21c-4 0-7-2.7-7-6.5 0-3.2 2.2-5 3.5-7 .5 1.6 1.4 2.6 2.5 3 0-3 1.3-5.7 4-7.5-.3 3 1 4.8 2.6 6.7A7 7 0 0 1 19 14.5C19 18.3 16 21 12 21Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  volume: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/>',
  wave: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

export function icon(name: keyof typeof ICONS | string, size = 20): SVGSVGElement {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
  return wrap.firstChild as SVGSVGElement;
}

export function qrSvg(text: string, cell = 4): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 0, scalable: true });
}

export function brand(size: "sm" | "lg" = "sm") {
  return h("a", { class: `brand brand-${size}`, href: "/", "aria-label": "Awitloop home" }, disc("disc-mark"), h("span", { class: "brand-word" }, "awitloop"));
}

/**
 * The laser disc: the one loud element in the system. Grooves + iridescent foil,
 * with an optional center label (a QR code, an icon, a readout).
 */
export function disc(cls = "", label?: Node | null) {
  return h("span", { class: `disc ${cls}` }, h("span", { class: "disc-foil" }), h("span", { class: "disc-grooves" }), h("span", { class: "disc-label" }, label ?? null));
}

/** Dot-matrix readout, the videoke machine's display. */
export function led(text: string, cls = "") {
  return h("span", { class: `led ${cls}` }, text);
}

/* ---------- toasts ---------- */

let toastHost: HTMLElement | null = null;
export function toast(text: string, kind: "info" | "error" = "info") {
  if (!toastHost) {
    toastHost = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.appendChild(toastHost);
  }
  const el = h("div", { class: `toast toast-${kind}` }, text);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  window.setTimeout(() => {
    el.classList.remove("in");
    window.setTimeout(() => el.remove(), 300);
  }, 3600);
}

/* ---------- theme ---------- */

export function initTheme() {
  let t: string | null = null;
  try {
    t = localStorage.getItem("awitloop:theme");
  } catch {}
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
}

export function currentTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function themeToggle() {
  const btn = h("button", { class: "icon-btn", type: "button", title: "Toggle light / dark" });
  const paint = () => {
    clear(btn);
    btn.appendChild(icon(currentTheme() === "dark" ? "sun" : "moon", 18));
  };
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("awitloop:theme", next);
    } catch {}
    paint();
  });
  paint();
  return btn;
}

/* ---------- local prefs ---------- */

export function getName(): string {
  try {
    return localStorage.getItem("awitloop:name") || "";
  } catch {
    return "";
  }
}

export function setName(n: string) {
  try {
    localStorage.setItem("awitloop:name", n);
  } catch {}
}

export function getStars(): Song[] {
  try {
    return JSON.parse(localStorage.getItem("awitloop:stars") || "[]");
  } catch {
    return [];
  }
}

export function toggleStar(song: Song): boolean {
  const stars = getStars();
  const i = stars.findIndex((s) => s.videoId === song.videoId);
  if (i >= 0) stars.splice(i, 1);
  else stars.unshift(song);
  try {
    localStorage.setItem("awitloop:stars", JSON.stringify(stars.slice(0, 300)));
  } catch {}
  return i < 0;
}

export function isStarred(videoId: string) {
  return getStars().some((s) => s.videoId === videoId);
}

/** True when a keystroke belongs to a text field and must never trigger shortcuts. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function joinUrl(code: string) {
  return `${location.origin}/${code}`;
}
