import type { RoomState } from "../../shared/protocol";
import { positionAt } from "../../shared/protocol";
import { SyncedPlayer } from "../lib/player";
import { RoomClient, createRoom, roomExists } from "../lib/room";
import { rememberRoom } from "../lib/pwa";
import { bootMessage, brand, clear, cleanTitle, disc, fmtTime, h, icon, joinUrl, led, qrSvg, toast } from "../lib/ui";
import { fullscreen } from "./host";

/** /tv with no code: make a room so a TV never needs on-screen typing. */
export async function StageBoot(root: HTMLElement) {
  root.appendChild(h("div", { class: "boot" }, brand("lg"), h("p", { class: "muted" }, "Setting up your room…")));
  try {
    const code = await createRoom();
    location.replace(`/tv/${code}`);
  } catch {
    clear(root);
    root.appendChild(h("div", { class: "boot" }, brand("lg"), h("p", null, "Couldn't reach Awitloop. Check the TV's internet connection."), h("button", { class: "btn btn-primary btn-lg", onclick: () => location.reload(), autofocus: true }, "Try again")));
  }
}

/** Full-bleed TV stage. Designed for 10-foot viewing and a TV remote. */
export async function Stage(root: HTMLElement, code: string) {
  document.title = `Awitloop · ${code}`;
  document.documentElement.classList.add("tv");

  const exists = await roomExists(code);
  if (exists === null) return bootMessage(root, "The TV is offline. Check its internet connection.", { label: "Try again", onClick: () => location.reload() });
  if (!exists) {
    root.appendChild(h("div", { class: "boot" }, brand("lg"), h("p", null, `Room ${code} has ended or doesn't exist.`), h("a", { class: "btn btn-primary btn-lg", href: "/tv" }, "Start a new room")));
    return;
  }

  rememberRoom(code, "stage");
  const room = new RoomClient(code, "stage", "TV");
  room.onToast((t) => toast(t));
  const url = joinUrl(code);

  const videoHost = h("div", { class: "video" });
  const touch = !!window.matchMedia?.("(pointer: coarse)").matches;
  const startBtn = h("button", { class: "tv-start", type: "button", autofocus: true, "aria-label": "Start" }, disc("disc-start", h("span", { class: "tv-ok" }, touch ? "TAP" : "OK")));
  const welcome = h(
    "div",
    { class: "tv-welcome" },
    startBtn,
    h("div", { class: "tv-welcome-copy" }, brand("lg"), h("h1", null, touch ? "Tap the disc to start." : "Press OK on your remote to start."), h("p", null, touch ? "Your browser needs one tap before it's allowed to play sound." : "The TV needs one button press before it's allowed to play sound.")),
  );

  const idleQueue = h("div", { class: "tv-idle-queue" });
  const idle = h(
    "div",
    { class: "tv-idle" },
    disc("disc-tv", h("span", { class: "qr", html: qrSvg(url, 8) })),
    h(
      "div",
      { class: "tv-idle-copy" },
      brand("lg"),
      h("h1", { class: "tv-idle-title" }, "Scan the disc with your phone and pick a song."),
      h("p", { class: "tv-code" }, h("span", null, "Room"), led(code, "led-xl")),
      h("p", { class: "tv-url" }, url.replace(/^https?:\/\//, "")),
      idleQueue,
    ),
  );

  const lowerSinger = h("div", { class: "lt-singer" });
  const lowerTitle = h("div", { class: "lt-title" });
  const lowerTime = led("", "lt-time");
  const ltDisc = disc("disc-lt", icon("mic", 18));
  const lowerThird = h("div", { class: "lower-third" }, ltDisc, h("div", { class: "lt-text" }, lowerSinger, lowerTitle), lowerTime);

  const nextList = h("div", { class: "next-list" });
  const upNext = h("div", { class: "up-next" }, h("p", { class: "panel-title" }, "Up next"), nextList);
  const cornerQr = h("div", { class: "corner-qr" }, h("div", { class: "cq-code", html: qrSvg(url, 3) }), h("div", null, h("p", null, "Add a song"), led(code)));
  const soundGate = h("button", { class: "gate", type: "button", hidden: true }, h("span", { class: "gate-ic" }, icon("volume", 36)), h("span", null, "Press OK to turn on sound"));
  const connBanner = h("div", { class: "tv-conn", hidden: true }, "Reconnecting…");

  const stage = h("div", { class: "tv-stage is-idle" }, videoHost, idle, lowerThird, upNext, cornerQr, soundGate, connBanner, welcome);
  root.appendChild(stage);

  const player = new SyncedPlayer(videoHost, room, {
    muted: () => false,
    onNeedsGesture: (needs) => {
      soundGate.hidden = !needs;
      if (needs) soundGate.focus();
    },
  });

  const begin = () => {
    welcome.remove();
    player.unlock();
    fullscreen(stage);
  };
  startBtn.addEventListener("click", begin);
  soundGate.addEventListener("click", () => player.unlock());
  window.setTimeout(() => startBtn.focus(), 50);

  // TV remotes: OK/Enter, and LG/Samsung media keys (415 play, 19 pause, 417 ff, 412 rew, 10252 play/pause).
  document.addEventListener("keydown", (e) => {
    const k = e.keyCode;
    const s = room.state;
    if (document.body.contains(welcome)) {
      if (e.key === "Enter" || k === 13 || k === 415 || k === 10252) (e.preventDefault(), begin());
      return;
    }
    if (!soundGate.hidden && (e.key === "Enter" || k === 13)) return player.unlock();
    if (!s) return;
    if (k === 415 || k === 10252 || e.key === "MediaPlayPause" || e.key === " ") room.send({ t: s.playback.status === "playing" ? "pause" : "play" });
    else if (k === 19 || e.key === "MediaPause") room.send({ t: "pause" });
    else if (k === 417 || e.key === "MediaTrackNext" || e.key === "MediaFastForward") room.send({ t: "skip", currentId: s.current?.id ?? null });
    else if (k === 412 || e.key === "MediaRewind") room.send({ t: "seek", position: positionAt(s.playback, room.now()) - 10 });
  });

  room.onStatus((st) => (connBanner.hidden = st !== "offline"));

  const renderQueue = (host: HTMLElement, s: RoomState, n: number) => {
    clear(host);
    s.queue.slice(0, n).forEach((q, i) =>
      host.appendChild(h("div", { class: "nx" }, led(String(i + 1), "nx-n"), h("div", null, h("div", { class: "nx-title" }, cleanTitle(q.title)), h("div", { class: "nx-singer" }, q.singer)))),
    );
    if (s.queue.length > n) host.appendChild(h("div", { class: "nx-more muted" }, `+${s.queue.length - n} more`));
  };

  room.onState((s) => {
    ltDisc.classList.toggle("spinning", s.playback.status === "playing");
    stage.classList.toggle("is-idle", !s.current);
    stage.classList.toggle("is-paused", s.playback.status === "paused");
    if (s.current) {
      lowerSinger.textContent = s.current.singer;
      lowerTitle.textContent = cleanTitle(s.current.title);
    }
    renderQueue(nextList, s, 4);
    clear(idleQueue);
    if (s.queue.length) {
      idleQueue.appendChild(h("p", { class: "panel-title" }, "Up next"));
      const l = h("div", { class: "next-list" });
      renderQueue(l, s, 3);
      idleQueue.appendChild(l);
    }
  });

  // Overlays show at the start and end of each song and while paused, then get out of the lyrics' way.
  window.setInterval(() => {
    const s = room.state;
    if (!s?.current) return;
    const pos = positionAt(s.playback, room.now());
    const d = s.current.duration;
    const intro = pos < 9;
    const outro = d > 0 && d - pos < 25;
    stage.classList.toggle("show-lt", intro || s.playback.status === "paused");
    stage.classList.toggle("show-next", (outro || s.playback.status === "paused") && s.queue.length > 0);
    lowerTime.textContent = d ? `${fmtTime(pos)} / ${fmtTime(d)}` : fmtTime(pos);
  }, 500);
}
