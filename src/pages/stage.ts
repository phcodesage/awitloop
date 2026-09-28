import type { RoomState } from "../../shared/protocol";
import { positionAt } from "../../shared/protocol";
import { SyncedPlayer } from "../lib/player";
import { RoomClient, createRoom, roomExists } from "../lib/room";
import { brand, clear, cleanTitle, fmtTime, h, icon, joinUrl, qrSvg, toast } from "../lib/ui";
import { fullscreen } from "./host";

/** /tv with no code: make a room so a TV never needs on-screen typing. */
export async function StageBoot(root: HTMLElement) {
  root.appendChild(h("div", { class: "boot" }, brand("lg"), h("p", { class: "muted" }, "Setting up your room…")));
  try {
    const code = await createRoom();
    location.replace(`/tv/${code}`);
  } catch {
    clear(root);
    root.appendChild(h("div", { class: "boot" }, brand("lg"), h("p", null, "Couldn't reach Awitloop. Check the TV's internet connection."), h("button", { class: "btn btn-accent btn-lg", onclick: () => location.reload(), autofocus: true }, "Try again")));
  }
}

/** Full-bleed TV stage. Designed for 10-foot viewing and a TV remote. */
export async function Stage(root: HTMLElement, code: string) {
  document.title = `Awitloop · ${code}`;
  document.documentElement.classList.add("tv");

  if (!(await roomExists(code))) {
    root.appendChild(h("div", { class: "boot" }, brand("lg"), h("p", null, `Room ${code} has ended or doesn't exist.`), h("a", { class: "btn btn-accent btn-lg", href: "/tv" }, "Start a new room")));
    return;
  }

  const room = new RoomClient(code, "stage", "TV");
  room.onToast((t) => toast(t));
  const url = joinUrl(code);

  const videoHost = h("div", { class: "video" });
  const startBtn = h("button", { class: "btn btn-accent btn-xl", type: "button", autofocus: true }, icon("play", 22), h("span", null, "Start the party"));
  const welcome = h(
    "div",
    { class: "tv-welcome" },
    brand("lg"),
    h("h1", null, "Press ", h("span", { class: "key" }, "OK"), " to start"),
    h("p", { class: "muted" }, "TVs need one button press before they're allowed to play sound."),
    startBtn,
  );

  const idleQueue = h("div", { class: "tv-idle-queue" });
  const idle = h(
    "div",
    { class: "tv-idle" },
    h("div", { class: "tv-idle-left" }, brand("lg"), h("h1", { class: "tv-idle-title" }, "Scan to join", h("br"), "and pick a song."), h("div", { class: "tv-code" }, h("span", { class: "muted" }, "Room"), h("b", { class: "mono" }, code)), h("div", { class: "muted mono small" }, url.replace(/^https?:\/\//, "")), idleQueue),
    h("div", { class: "tv-idle-qr", html: qrSvg(url, 8) }),
  );

  const lowerSinger = h("div", { class: "lt-singer" });
  const lowerTitle = h("div", { class: "lt-title" });
  const lowerTime = h("div", { class: "lt-time mono" });
  const lowerThird = h("div", { class: "lower-third" }, h("span", { class: "lt-mark" }, icon("mic", 20)), h("div", null, lowerSinger, lowerTitle), lowerTime);

  const nextList = h("div", { class: "next-list" });
  const upNext = h("div", { class: "up-next" }, h("div", { class: "kicker" }, "Up next"), nextList);
  const cornerQr = h("div", { class: "corner-qr" }, h("div", { class: "cq-code", html: qrSvg(url, 3) }), h("div", null, h("div", { class: "kicker" }, "Add songs"), h("b", { class: "mono" }, code)));
  const soundGate = h("button", { class: "gate", type: "button", hidden: true }, h("span", { class: "gate-ic" }, icon("volume", 36)), h("span", null, "Press OK for sound"));
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
      host.appendChild(h("div", { class: "nx" }, h("span", { class: "nx-n mono" }, String(i + 1)), h("div", null, h("div", { class: "nx-title" }, cleanTitle(q.title)), h("div", { class: "nx-singer" }, q.singer)))),
    );
    if (s.queue.length > n) host.appendChild(h("div", { class: "nx-more muted" }, `+${s.queue.length - n} more`));
  };

  room.onState((s) => {
    stage.classList.toggle("is-idle", !s.current);
    stage.classList.toggle("is-paused", s.playback.status === "paused");
    if (s.current) {
      lowerSinger.textContent = s.current.singer;
      lowerTitle.textContent = cleanTitle(s.current.title);
    }
    renderQueue(nextList, s, 4);
    clear(idleQueue);
    if (s.queue.length) {
      idleQueue.appendChild(h("div", { class: "kicker" }, "Up next"));
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
