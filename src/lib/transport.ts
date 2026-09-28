import { positionAt } from "../../shared/protocol";
import type { RoomClient } from "./room";
import { clear, fmtTime, h, icon } from "./ui";

/** Play/pause/seek/skip + a seekable progress bar driven purely by the room clock. */
export function Transport(room: RoomClient, opts: { big?: boolean } = {}) {
  const playBtn = h("button", { class: "ctrl ctrl-main", type: "button", title: "Play / pause (Space)" });
  const skipBtn = h("button", { class: "ctrl", type: "button", title: "Skip (N)" }, icon("skip", 18));
  const restartBtn = h("button", { class: "ctrl", type: "button", title: "Restart song" }, icon("restart", 18));
  const back = h("button", { class: "ctrl ctrl-text", type: "button", title: "Back 10s (←)" }, "−10s");
  const fwd = h("button", { class: "ctrl ctrl-text", type: "button", title: "Forward 10s (→)" }, "+10s");

  const fill = h("div", { class: "progress-fill" });
  const knob = h("div", { class: "progress-knob" });
  const bar = h("div", { class: "progress", role: "slider", "aria-label": "Seek", tabindex: 0 }, h("div", { class: "progress-track" }, fill, knob));
  const cur = h("span", { class: "time" }, "0:00");
  const dur = h("span", { class: "time" }, "0:00");

  const el = h(
    "div",
    { class: "transport" + (opts.big ? " big" : "") },
    h("div", { class: "progress-row" }, cur, bar, dur),
    h("div", { class: "ctrl-row" }, restartBtn, back, playBtn, fwd, skipBtn),
  );

  let status = "";
  const paintPlay = () => {
    const s = room.state?.playback.status ?? "idle";
    if (s === status) return;
    status = s;
    clear(playBtn);
    playBtn.appendChild(icon(s === "playing" ? "pause" : "play", 22));
  };

  const position = () => (room.state ? positionAt(room.state.playback, room.now()) : 0);
  const toggle = () => room.send({ t: room.state?.playback.status === "playing" ? "pause" : "play" });
  const seekBy = (d: number) => room.state?.current && room.send({ t: "seek", position: position() + d });
  const skip = () => room.send({ t: "skip", currentId: room.state?.current?.id ?? null });

  playBtn.addEventListener("click", toggle);
  skipBtn.addEventListener("click", skip);
  restartBtn.addEventListener("click", () => room.send({ t: "restart" }));
  back.addEventListener("click", () => seekBy(-10));
  fwd.addEventListener("click", () => seekBy(10));

  bar.addEventListener("click", (e) => {
    const s = room.state;
    if (!s?.current?.duration) return;
    const r = bar.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, ((e as MouseEvent).clientX - r.left) / r.width));
    room.send({ t: "seek", position: f * s.current.duration });
  });
  bar.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") (e.preventDefault(), seekBy(-5));
    if (e.key === "ArrowRight") (e.preventDefault(), seekBy(5));
  });

  const frame = () => {
    const s = room.state;
    paintPlay();
    const d = s?.current?.duration ?? 0;
    const p = Math.min(position(), d || Infinity);
    const f = d ? Math.max(0, Math.min(1, p / d)) : 0;
    fill.style.width = `${f * 100}%`;
    knob.style.left = `${f * 100}%`;
    cur.textContent = fmtTime(s?.current ? p : 0);
    dur.textContent = fmtTime(d);
    el.classList.toggle("disabled", !s?.current && !s?.queue.length);
  };
  window.setInterval(frame, 250);
  room.onState(frame);

  return { el, toggle, seekBy, skip };
}
