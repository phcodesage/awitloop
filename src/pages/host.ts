import { SyncedPlayer } from "../lib/player";
import { RoomClient } from "../lib/room";
import { Songbook } from "../lib/songbook";
import { Transport } from "../lib/transport";
import { brand, cleanTitle, disc, getName, h, icon, isTyping, joinUrl, led, qrSvg, themeToggle, toast } from "../lib/ui";

/** Laptop/desktop console: the screen and its deck on the left, the songbook on the right. */
export function Host(root: HTMLElement, code: string) {
  document.title = `Room ${code} · Awitloop`;
  const room = new RoomClient(code, "host", getName() || "Host");
  room.onToast((t, err) => toast(t, err ? "error" : "info"));

  let forceSound = false;
  const stageOnline = () => !!room.state?.members.some((m) => m.role === "stage");
  const shortJoin = joinUrl(code).replace(/^https?:\/\//, "");

  /* ---------- screen ---------- */

  const gate = h("button", { class: "gate", type: "button", hidden: true }, h("span", { class: "gate-ic" }, icon("volume", 26)), h("span", null, "Turn on sound"));
  const idle = h(
    "div",
    { class: "screen-idle" },
    disc("disc-qr", h("span", { class: "qr", html: qrSvg(joinUrl(code)) })),
    h(
      "div",
      { class: "idle-copy" },
      h("p", { class: "idle-lead" }, "Scan the disc to add songs from your phone."),
      h("p", { class: "idle-code" }, h("span", null, "Room"), led(code, "led-xl")),
      h("p", { class: "idle-alt" }, "Or search in the songbook."),
    ),
  );
  const videoHost = h("div", { class: "video" });
  const mutedBadge = h("button", { class: "screen-badge", type: "button", hidden: true, title: "Play sound on this computer too" }, icon("mute", 14), h("span", null, "Sound is on the TV"));
  const fsBtn = h("button", { class: "screen-fs", type: "button", title: "Fullscreen (F)", "aria-label": "Fullscreen" }, icon("expand", 16));
  const screen = h("div", { class: "screen is-idle" }, videoHost, idle, gate, mutedBadge, fsBtn);
  fsBtn.addEventListener("click", () => fullscreen(screen));

  const player = new SyncedPlayer(videoHost, room, {
    muted: () => stageOnline() && !forceSound,
    onNeedsGesture: (needs) => (gate.hidden = !needs),
  });
  gate.addEventListener("click", () => player.unlock());
  mutedBadge.addEventListener("click", () => {
    forceSound = true;
    player.unlock();
  });

  /* ---------- deck ---------- */

  const transport = Transport(room);
  const titleEl = h("p", { class: "np-title" }, "Nothing playing");
  const singerEl = h("p", { class: "np-singer" });
  const nextEl = h("p", { class: "np-next" });

  const vol = h("input", { class: "vol", type: "range", min: 0, max: 100, step: 1, "aria-label": "Volume" }) as HTMLInputElement;
  let volTimer = 0;
  vol.addEventListener("input", () => {
    clearTimeout(volTimer);
    volTimer = window.setTimeout(() => room.send({ t: "volume", value: Number(vol.value) }), 120);
  });

  const deck = h(
    "section",
    { class: "deck", "aria-label": "Playback" },
    transport.progressRow,
    h(
      "div",
      { class: "deck-row" },
      h("div", { class: "np" }, titleEl, singerEl, nextEl),
      transport.ctrlRow,
      h("div", { class: "deck-side" }, h("label", { class: "vol-wrap", title: "Volume on every screen" }, icon("volume", 16), vol)),
    ),
  );

  /* ---------- header ---------- */

  const people = h("span", { class: "people", title: "People in this room" }, icon("users", 15), led("1", "led-sm"));
  const conn = h("span", { class: "conn", role: "status" });
  const codeBtn = h("button", { class: "room-code", type: "button", title: `Copy join link (${shortJoin})` }, h("span", { class: "room-code-label" }, "Room"), led(code), icon("copy", 14));
  codeBtn.addEventListener("click", () => {
    navigator.clipboard?.writeText(joinUrl(code)).then(
      () => toast("Join link copied"),
      () => toast(joinUrl(code)),
    );
  });

  const songbook = Songbook(room, { singer: () => getName() || "Host" });

  const shell = h(
    "div",
    { class: "console" },
    h(
      "header",
      { class: "console-bar" },
      brand(),
      h(
        "div",
        { class: "bar-right" },
        conn,
        codeBtn,
        people,
        h("a", { class: "btn btn-ghost", href: `/tv/${code}`, target: "_blank", rel: "noopener" }, icon("tv", 16), h("span", null, "Open TV view")),
        themeToggle(),
        h("a", { class: "icon-btn", href: "/", title: "Leave room", "aria-label": "Leave room" }, icon("logout", 18)),
      ),
    ),
    h("main", { class: "console-main" }, h("div", { class: "stage-col" }, screen, deck), h("aside", { class: "songbook-panel" }, songbook.el)),
  );
  root.appendChild(shell);

  let lastItem = "";
  room.onState((s) => {
    (people.querySelector(".led") as HTMLElement).textContent = String(s.members.length);
    if (document.activeElement !== vol) vol.value = String(s.volume);
    screen.classList.toggle("is-idle", !s.current);
    titleEl.textContent = s.current ? cleanTitle(s.current.title) : "Nothing playing";
    singerEl.textContent = s.current ? `${s.current.singer} is singing` : "Queue a song and it starts right away.";
    const next = s.queue[0];
    nextEl.textContent = next ? `Next: ${next.singer}, ${cleanTitle(next.title)}` : "";
    shell.classList.toggle("is-playing", s.playback.status === "playing");
    mutedBadge.hidden = !(stageOnline() && !forceSound && s.current);
    if (s.current && s.current.id !== lastItem) {
      lastItem = s.current.id;
      document.title = `${cleanTitle(s.current.title)} · Room ${code}`;
    }
  });
  room.onStatus((st) => {
    conn.textContent = st === "online" ? "" : st === "connecting" ? "Connecting" : "Reconnecting";
    conn.className = `conn ${st}`;
  });

  // Keyboard shortcuts never fire while typing, so every letter works in search.
  document.addEventListener("keydown", (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " ") (e.preventDefault(), transport.toggle());
    else if (e.key === "ArrowLeft") (e.preventDefault(), transport.seekBy(-10));
    else if (e.key === "ArrowRight") (e.preventDefault(), transport.seekBy(10));
    else if (e.key === "n" || e.key === "N") transport.skip();
    else if (e.key === "f" || e.key === "F") fullscreen(screen);
    else if (e.key === "/") (e.preventDefault(), songbook.focusSearch());
  });
}

export function fullscreen(el: HTMLElement) {
  const d = document as any;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else {
    const e = el as any;
    (e.requestFullscreen || e.webkitRequestFullscreen)?.call(e);
  }
}
