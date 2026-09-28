import { SyncedPlayer } from "../lib/player";
import { RoomClient } from "../lib/room";
import { Songbook } from "../lib/songbook";
import { Transport } from "../lib/transport";
import { brand, cleanTitle, getName, h, icon, isTyping, joinUrl, qrSvg, themeToggle, toast } from "../lib/ui";

/** Laptop/desktop console: player on the left, songbook on the right. */
export function Host(root: HTMLElement, code: string) {
  document.title = `Room ${code} · Awitloop`;
  const room = new RoomClient(code, "host", getName() || "Host");
  room.onToast((t, err) => toast(t, err ? "error" : "info"));

  let forceSound = false;
  const stageOnline = () => !!room.state?.members.some((m) => m.role === "stage");

  const titleEl = h("div", { class: "np-title" }, "Nothing playing");
  const singerEl = h("div", { class: "np-singer" });
  const gate = h(
    "button",
    { class: "gate", type: "button", hidden: true },
    h("span", { class: "gate-ic" }, icon("volume", 28)),
    h("span", null, "Tap to turn on sound"),
  );
  const idle = h(
    "div",
    { class: "stage-idle" },
    h("div", { class: "idle-qr", html: qrSvg(joinUrl(code)) }),
    h("div", null, h("div", { class: "idle-big" }, "Scan to add songs"), h("div", { class: "idle-code mono" }, code), h("div", { class: "muted" }, "or search on the right →")),
  );
  const videoHost = h("div", { class: "video" });
  const mutedBadge = h("button", { class: "muted-badge", type: "button", hidden: true, title: "Play sound here too" }, icon("mute", 14), h("span", null, "Muted: the TV has the sound"));
  const frame = h("div", { class: "video-frame" }, videoHost, idle, gate, mutedBadge);

  const player = new SyncedPlayer(videoHost, room, {
    muted: () => stageOnline() && !forceSound,
    onNeedsGesture: (needs) => (gate.hidden = !needs),
  });
  gate.addEventListener("click", () => player.unlock());
  mutedBadge.addEventListener("click", () => {
    forceSound = true;
    player.unlock();
  });

  const transport = Transport(room);

  const vol = h("input", { class: "vol", type: "range", min: 0, max: 100, step: 1, "aria-label": "Volume" }) as HTMLInputElement;
  let volTimer = 0;
  vol.addEventListener("input", () => {
    clearTimeout(volTimer);
    volTimer = window.setTimeout(() => room.send({ t: "volume", value: Number(vol.value) }), 120);
  });

  const members = h("span", { class: "pill" }, h("span", { class: "live-dot" }), icon("users", 14), h("span", { class: "n" }, "1"));
  const conn = h("span", { class: "conn" });

  const copyBtn = h("button", { class: "pill pill-btn mono", type: "button", title: "Copy join link" }, code, icon("copy", 13));
  copyBtn.addEventListener("click", () => {
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
      h("div", { class: "bar-right" }, conn, copyBtn, members, h("a", { class: "btn btn-outline", href: `/tv/${code}`, target: "_blank", rel: "noopener" }, icon("tv", 16), h("span", null, "TV stage view")), themeToggle(), h("a", { class: "icon-btn", href: "/", title: "Leave room" }, icon("logout", 18))),
    ),
    h(
      "main",
      { class: "console-main" },
      h(
        "section",
        { class: "card player-card" },
        h("div", { class: "np" }, h("span", { class: "np-eq" }, h("i"), h("i"), h("i")), h("div", { class: "np-text" }, titleEl, singerEl), h("button", { class: "icon-btn sm", type: "button", title: "Fullscreen (F)", onclick: () => fullscreen(frame) }, icon("expand", 16))),
        frame,
        transport.el,
        h(
          "div",
          { class: "player-foot" },
          h("div", { class: "remote-chip" }, h("div", { class: "mini-qr", html: qrSvg(joinUrl(code)) }), h("div", null, h("div", { class: "kicker" }, "Songbook remote"), h("div", { class: "mono" }, `${location.host}/m/${code}`))),
          h("label", { class: "vol-wrap" }, icon("volume", 16), vol),
        ),
      ),
      h("aside", { class: "card songbook-card" }, songbook.el),
    ),
  );
  root.appendChild(shell);

  let lastItem = "";
  room.onState((s) => {
    (members.querySelector(".n") as HTMLElement).textContent = String(s.members.length);
    if (document.activeElement !== vol) vol.value = String(s.volume);
    frame.classList.toggle("is-idle", !s.current);
    titleEl.textContent = s.current ? cleanTitle(s.current.title) : "Nothing playing";
    singerEl.textContent = s.current ? `${s.current.singer} is singing` : s.queue.length ? "" : "Queue a song to start";
    shell.classList.toggle("is-playing", s.playback.status === "playing");
    mutedBadge.hidden = !(stageOnline() && !forceSound && s.current);
    if (s.current && s.current.id !== lastItem) {
      lastItem = s.current.id;
      document.title = `♪ ${cleanTitle(s.current.title)} · ${code}`;
    }
  });
  room.onStatus((st) => {
    conn.textContent = st === "online" ? "" : st === "connecting" ? "Connecting…" : "Reconnecting…";
    conn.className = `conn ${st}`;
  });

  // Keyboard shortcuts never fire while typing, so every letter works in search.
  document.addEventListener("keydown", (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " ") (e.preventDefault(), transport.toggle());
    else if (e.key === "ArrowLeft") (e.preventDefault(), transport.seekBy(-10));
    else if (e.key === "ArrowRight") (e.preventDefault(), transport.seekBy(10));
    else if (e.key === "n" || e.key === "N") transport.skip();
    else if (e.key === "f" || e.key === "F") fullscreen(frame);
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
