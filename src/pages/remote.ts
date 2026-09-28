import type { RoomState } from "../../shared/protocol";
import { positionAt } from "../../shared/protocol";
import { SyncedPlayer } from "../lib/player";
import { RoomClient, roomExists } from "../lib/room";
import { Songbook } from "../lib/songbook";
import { rememberRoom } from "../lib/pwa";
import { bootMessage, brand, clear, cleanTitle, disc, fmtTime, getName, h, icon, led, setName, themeToggle, toast } from "../lib/ui";

/** Phone remote: the songbook, plus a mini transport for whoever's holding the mic. */
export async function Remote(root: HTMLElement, code: string) {
  document.title = `Songbook · ${code}`;

  const exists = await roomExists(code);
  if (exists === null) return bootMessage(root, "You're offline. Connect to the internet to join the room.", { label: "Try again", onClick: () => location.reload() });
  if (!exists) return bootMessage(root, `Room ${code} has ended or doesn't exist.`, { label: "Go home", href: "/" });
  rememberRoom(code, "remote");

  let name = getName();
  if (!name) name = await askName(root);

  const room = new RoomClient(code, "remote", name);
  room.onToast((t, err) => toast(t, err ? "error" : "info"));

  const nameBtn = h("button", { class: "name-btn", type: "button", title: "Change your name" }, icon("mic", 14), h("span", null, name));
  nameBtn.addEventListener("click", async () => {
    const n = await askName(document.body, name);
    name = n;
    (nameBtn.lastChild as HTMLElement).textContent = n;
    room.setName(n);
  });

  const songbook = Songbook(room, { singer: () => name, compact: true });

  const npThumb = h("img", { class: "mini-thumb", alt: "" }) as HTMLImageElement;
  const npDisc = disc("disc-mini-player", npThumb);
  const npTitle = h("div", { class: "mini-title" }, "Nothing playing");
  const npSub = h("div", { class: "mini-sub" }, "Queue a song to start");
  const npFill = h("div", { class: "mini-fill" });
  const npTime = led("", "led-sm mini-time");
  const playBtn = h("button", { class: "ctrl ctrl-hot", type: "button", title: "Play / pause" });
  const skipBtn = h("button", { class: "ctrl", type: "button", title: "Skip" }, icon("skip", 16));
  playBtn.addEventListener("click", () => room.send({ t: room.state?.playback.status === "playing" ? "pause" : "play" }));
  skipBtn.addEventListener("click", () => {
    const cur = room.state?.current;
    if (!cur) return;
    room.send({ t: "skip", currentId: cur.id });
    toast(`Skipped ${cleanTitle(cur.title)}`);
  });
  /*
   * Phones are remotes by default: the host screen or TV plays the sound. "Play here"
   * opens a synced player on this phone, for singing along without a TV nearby.
   */
  const where = h("span", { class: "where-text" });
  const hereBtn = h("button", { class: "btn btn-ghost btn-sm here-btn", type: "button" });
  const phoneGate = h("button", { class: "gate", type: "button", hidden: true }, h("span", { class: "gate-ic" }, icon("volume", 24)), h("span", null, "Tap for sound"));
  const phoneVideo = h("div", { class: "video" });
  const phoneScreen = h("div", { class: "phone-screen", hidden: true }, phoneVideo, phoneGate);
  let phonePlayer: SyncedPlayer | null = null;

  const paintWhere = (s: RoomState | null) => {
    const stage = s?.members.some((m) => m.role === "stage");
    const host = s?.members.some((m) => m.role === "host");
    if (phonePlayer) where.textContent = "Playing on this phone";
    else if (stage) where.textContent = "Sound is playing on the TV";
    else if (host) where.textContent = "Sound is playing on the host's screen";
    else where.textContent = "No screen is playing sound right now";
    clear(hereBtn);
    hereBtn.appendChild(icon(phonePlayer ? "mute" : "volume", 14));
    hereBtn.appendChild(h("span", null, phonePlayer ? "Stop" : "Play here"));
  };

  hereBtn.addEventListener("click", () => {
    if (phonePlayer) {
      phonePlayer.destroy();
      phonePlayer = null;
      phoneScreen.hidden = true;
      phoneGate.hidden = true;
    } else {
      phoneScreen.hidden = false;
      phonePlayer = new SyncedPlayer(phoneVideo, room, {
        muted: () => false,
        onNeedsGesture: (needs) => (phoneGate.hidden = !needs),
      });
      phonePlayer.unlock();
      const s = room.state;
      if (s?.members.some((m) => m.role === "stage" || m.role === "host")) {
        toast("Use headphones if you're in the same room as the TV, or you'll hear an echo.");
      }
    }
    paintWhere(room.state);
  });
  phoneGate.addEventListener("click", () => phonePlayer?.unlock());

  const mini = h(
    "div",
    { class: "mini-player" },
    h("div", { class: "mini-progress" }, npFill),
    phoneScreen,
    h("div", { class: "where" }, icon("volume", 14), where, hereBtn),
    h("div", { class: "mini-row" }, npDisc, h("div", { class: "mini-text", onclick: () => songbook.setTab("queue") }, npTitle, npSub), npTime, playBtn, skipBtn),
  );

  const conn = h("span", { class: "conn" });
  document.body.classList.add("has-mini");
  root.appendChild(
    h(
      "div",
      { class: "remote" },
      h("header", { class: "remote-bar" }, brand(), h("div", { class: "bar-right" }, conn, h("span", { class: "room-code static" }, led(code)), nameBtn, themeToggle())),
      h("main", { class: "remote-main" }, songbook.el),
      mini,
    ),
  );

  let status = "";
  room.onState((s) => {
    paintWhere(s);
    mini.classList.toggle("idle", !s.current);
    if (s.current) {
      npThumb.src = s.current.thumb;
      npTitle.textContent = cleanTitle(s.current.title);
      npSub.textContent = s.queue.length ? `${s.current.singer} is singing, ${s.queue.length} up next` : `${s.current.singer} is singing`;
    } else {
      npTitle.textContent = "Nothing playing";
      npSub.textContent = s.queue.length ? `${s.queue.length} in queue` : "Queue a song to start";
    }
    npDisc.classList.toggle("spinning", s.playback.status === "playing");
    if (s.playback.status !== status) {
      status = s.playback.status;
      clear(playBtn);
      playBtn.appendChild(icon(status === "playing" ? "pause" : "play", 18));
    }
  });
  room.onStatus((st) => {
    conn.textContent = st === "online" ? "" : "Reconnecting…";
    conn.className = `conn ${st}`;
  });
  window.setInterval(() => {
    const s = room.state;
    const d = s?.current?.duration ?? 0;
    const p = s ? positionAt(s.playback, room.now()) : 0;
    npFill.style.width = d ? `${Math.min(100, (p / d) * 100)}%` : "0%";
    if (s?.current && d) npTime.textContent = `${fmtTime(p)} / ${fmtTime(d)}`;
    else npTime.textContent = "";
  }, 1000);
}

function askName(host: HTMLElement, current = ""): Promise<string> {
  return new Promise((resolve) => {
    const input = h("input", { class: "name-input", maxlength: 24, placeholder: "e.g. Tita Baby", value: current, autocomplete: "nickname", "aria-label": "Your name" }) as HTMLInputElement;
    const sheet = h(
      "div",
      { class: "sheet-backdrop" },
      h(
        "form",
        {
          class: "sheet",
          onsubmit: (e: Event) => {
            e.preventDefault();
            const n = input.value.trim().slice(0, 24) || "Guest";
            setName(n);
            sheet.remove();
            resolve(n);
          },
        },
        disc("disc-sheet", icon("mic", 22)),
        h("h2", null, "Who's singing?"),
        h("p", { class: "muted" }, "Your name shows on the TV when your song comes up."),
        input,
        h("button", { class: "btn btn-primary btn-lg block", type: "submit" }, "Let's go"),
      ),
    );
    host.appendChild(sheet);
    window.setTimeout(() => input.focus(), 50);
  });
}
