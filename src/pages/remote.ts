import { positionAt } from "../../shared/protocol";
import { RoomClient, roomExists } from "../lib/room";
import { Songbook } from "../lib/songbook";
import { brand, clear, cleanTitle, fmtTime, getName, h, icon, setName, themeToggle, toast } from "../lib/ui";

/** Phone remote: the songbook, plus a mini transport for whoever's holding the mic. */
export async function Remote(root: HTMLElement, code: string) {
  document.title = `Songbook · ${code}`;

  if (!(await roomExists(code))) {
    root.appendChild(h("div", { class: "boot" }, brand("lg"), h("p", null, `Room ${code} has ended or doesn't exist.`), h("a", { class: "btn btn-accent", href: "/" }, "Go home")));
    return;
  }

  let name = getName();
  if (!name) name = await askName(root);

  const room = new RoomClient(code, "remote", name);
  room.onToast((t, err) => toast(t, err ? "error" : "info"));

  const nameBtn = h("button", { class: "pill pill-btn", type: "button", title: "Change your name" }, icon("mic", 13), h("span", null, name));
  nameBtn.addEventListener("click", async () => {
    const n = await askName(document.body, name);
    name = n;
    (nameBtn.lastChild as HTMLElement).textContent = n;
    room.setName(n);
  });

  const songbook = Songbook(room, { singer: () => name, compact: true });

  const npThumb = h("img", { class: "mini-thumb", alt: "" }) as HTMLImageElement;
  const npTitle = h("div", { class: "mini-title" }, "Nothing playing");
  const npSub = h("div", { class: "mini-sub" }, "Queue a song to start");
  const npFill = h("div", { class: "mini-fill" });
  const playBtn = h("button", { class: "ctrl ctrl-main sm", type: "button", title: "Play / pause" });
  const skipBtn = h("button", { class: "ctrl sm", type: "button", title: "Skip" }, icon("skip", 16));
  playBtn.addEventListener("click", () => room.send({ t: room.state?.playback.status === "playing" ? "pause" : "play" }));
  skipBtn.addEventListener("click", () => {
    const cur = room.state?.current;
    if (!cur) return;
    room.send({ t: "skip", currentId: cur.id });
    toast(`Skipped ${cleanTitle(cur.title)}`);
  });
  const mini = h(
    "div",
    { class: "mini-player" },
    h("div", { class: "mini-progress" }, npFill),
    h("div", { class: "mini-row" }, npThumb, h("div", { class: "mini-text", onclick: () => songbook.setTab("queue") }, npTitle, npSub), playBtn, skipBtn),
  );

  const conn = h("span", { class: "conn" });
  document.body.classList.add("has-mini");
  root.appendChild(
    h(
      "div",
      { class: "remote" },
      h("header", { class: "remote-bar" }, brand(), h("div", { class: "bar-right" }, conn, h("span", { class: "pill mono" }, code), nameBtn, themeToggle())),
      h("main", { class: "remote-main" }, songbook.el),
      mini,
    ),
  );

  let status = "";
  room.onState((s) => {
    mini.classList.toggle("idle", !s.current);
    if (s.current) {
      npThumb.src = s.current.thumb;
      npTitle.textContent = cleanTitle(s.current.title);
      npSub.textContent = `${s.current.singer} · ${s.queue.length} up next`;
    } else {
      npTitle.textContent = "Nothing playing";
      npSub.textContent = s.queue.length ? `${s.queue.length} in queue` : "Queue a song to start";
    }
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
    if (s?.current && d) npSub.textContent = `${s.current.singer} · ${fmtTime(p)} / ${fmtTime(d)}`;
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
        h("div", { class: "sheet-ic" }, icon("mic", 24)),
        h("h2", null, "Who's singing?"),
        h("p", { class: "muted" }, "Your name shows on the TV when your song comes up."),
        input,
        h("button", { class: "btn btn-accent btn-lg block", type: "submit" }, "Let's go"),
      ),
    );
    host.appendChild(sheet);
    window.setTimeout(() => input.focus(), 50);
  });
}
