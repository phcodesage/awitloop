import type { QueueItem, RoomState, Song } from "../../shared/protocol";
import type { RoomClient } from "./room";
import { clear, cleanTitle, fmtTime, getName, getStars, h, icon, isStarred, led, toast, toggleStar } from "./ui";

type Tab = "search" | "queue" | "hits" | "stars";

const HITS: { label: string; q: string }[] = [
  { label: "OPM Classics", q: "OPM classic love songs karaoke" },
  { label: "Birit Queens", q: "birit songs karaoke Regine Morissette" },
  { label: "Trending PH", q: "trending OPM 2026 karaoke" },
  { label: "Power Ballads", q: "power ballads 80s 90s karaoke" },
  { label: "Boy Bands", q: "boyband 90s 2000s karaoke Westlife Backstreet Boys" },
  { label: "Pop Now", q: "pop hits 2026 karaoke" },
  { label: "Rock Anthems", q: "rock anthem karaoke" },
  { label: "K-Pop", q: "kpop karaoke english lyrics" },
  { label: "Disney", q: "disney songs karaoke" },
  { label: "Bisaya", q: "bisaya songs karaoke" },
  { label: "Duets", q: "duet songs karaoke male female" },
  { label: "Party Starters", q: "party songs karaoke upbeat" },
];

interface SongbookOptions {
  /** Default singer name for queued songs. */
  singer: () => string;
  compact?: boolean;
  onQueued?: () => void;
}

/**
 * Search + queue + hits + favorites. Used by both the host console and the phone remote.
 */
export function Songbook(room: RoomClient, opts: SongbookOptions) {
  let tab: Tab = "search";
  let results: Song[] = [];
  let loading = false;
  let lastQuery = "";
  let searchSeq = 0;

  const tabBtns: Record<Tab, HTMLButtonElement> = {} as any;
  const queueCount = led("0", "count");
  const tabs = h(
    "div",
    { class: "tabs", role: "tablist" },
    ...(
      [
        ["search", "search", "Search"],
        ["queue", "queue", "Queue"],
        ["hits", "fire", "Hits"],
        ["stars", "star", "Starred"],
      ] as [Tab, string, string][]
    ).map(([id, ic, label]) => {
      const b = h(
        "button",
        { class: "tab", type: "button", role: "tab", onclick: () => setTab(id) },
        icon(ic, 16),
        h("span", null, label),
        id === "queue" ? queueCount : null,
      );
      tabBtns[id] = b;
      return b;
    }),
  );

  /* search form */
  const input = h("input", {
    class: "search-input",
    type: "search",
    placeholder: "Song, artist, or lyric…",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: false,
    enterkeyhint: "search",
    "aria-label": "Search songs",
  }) as HTMLInputElement;
  const karaokeOnly = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const suggestBox = h("div", { class: "suggest", hidden: true });
  const micBtn = h("button", { class: "icon-btn mic", type: "button", title: "Voice search" }, icon("mic", 18));
  const form = h(
    "form",
    {
      class: "search-form",
      onsubmit: (e: Event) => {
        e.preventDefault();
        runSearch(input.value);
      },
    },
    h("span", { class: "search-ic" }, icon("search", 18)),
    input,
    micBtn,
    h("button", { class: "btn btn-primary", type: "submit" }, "Search"),
  );
  const filter = h("label", { class: "filter" }, karaokeOnly, h("span", null, "Karaoke versions only"));

  const list = h("div", { class: "list", role: "tabpanel" });
  const panel = h("div", { class: "songbook" + (opts.compact ? " compact" : "") }, tabs, h("div", { class: "search-wrap" }, form, suggestBox, filter), list);
  const searchWrap = panel.querySelector(".search-wrap") as HTMLElement;

  /* suggestions */
  let suggestTimer = 0;
  input.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    const q = input.value.trim();
    if (q.length < 2) return hideSuggest();
    suggestTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        const { items } = (await res.json()) as { items: string[] };
        if (input.value.trim() !== q || document.activeElement !== input) return;
        clear(suggestBox);
        for (const s of items.slice(0, 6)) {
          suggestBox.appendChild(
            h(
              "button",
              {
                type: "button",
                class: "suggest-item",
                onmousedown: (e: Event) => e.preventDefault(),
                onclick: () => {
                  input.value = s;
                  runSearch(s);
                },
              },
              icon("search", 14),
              s,
            ),
          );
        }
        suggestBox.hidden = items.length === 0;
      } catch {
        hideSuggest();
      }
    }, 180);
  });
  input.addEventListener("blur", () => window.setTimeout(hideSuggest, 120));
  function hideSuggest() {
    suggestBox.hidden = true;
  }

  /* voice search */
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) micBtn.hidden = true;
  let listening: any = null;
  micBtn.addEventListener("click", () => {
    if (listening) {
      listening.stop();
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language && navigator.language.startsWith("fil") ? "fil-PH" : "en-PH";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    listening = rec;
    micBtn.classList.add("live");
    input.placeholder = "Listening… say a song or artist";
    rec.onresult = (e: any) => {
      const r = e.results[e.results.length - 1];
      input.value = r[0].transcript;
      if (r.isFinal) runSearch(input.value);
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") toast("Allow microphone access to search by voice.", "error");
    };
    rec.onend = () => {
      listening = null;
      micBtn.classList.remove("live");
      input.placeholder = "Song, artist, or lyric…";
    };
    rec.start();
  });

  async function runSearch(q: string) {
    q = q.trim();
    hideSuggest();
    if (!q) return;
    input.blur();
    lastQuery = q;
    setTab("search", false);
    loading = true;
    const seq = ++searchSeq;
    render();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&karaoke=${karaokeOnly.checked ? 1 : 0}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { songs: Song[] };
      if (seq !== searchSeq) return;
      results = data.songs;
    } catch {
      if (seq !== searchSeq) return;
      results = [];
      toast("Search failed. Check your connection and try again.", "error");
    }
    loading = false;
    render();
  }

  function setTab(t: Tab, rerender = true) {
    tab = t;
    for (const k in tabBtns) tabBtns[k as Tab].setAttribute("aria-selected", String(k === t));
    searchWrap.hidden = !(t === "search");
    list.scrollTop = 0;
    if (rerender) render();
  }

  function queue(song: Song, next = false) {
    room.send({ t: "add", song, singer: opts.singer() || getName() || "Guest", next });
    toast(next ? `Up next: ${cleanTitle(song.title)}` : `Queued: ${cleanTitle(song.title)}`);
    opts.onQueued?.();
  }

  function songRow(song: Song) {
    const starBtn = h("button", { class: "icon-btn sm", type: "button", title: "Star" }, icon(isStarred(song.videoId) ? "starFill" : "star", 16));
    if (isStarred(song.videoId)) starBtn.classList.add("on");
    starBtn.addEventListener("click", () => {
      const on = toggleStar(song);
      starBtn.classList.toggle("on", on);
      clear(starBtn);
      starBtn.appendChild(icon(on ? "starFill" : "star", 16));
      if (tab === "stars") render();
    });
    return h(
      "div",
      { class: "song" },
      h("div", { class: "thumb" }, h("img", { src: song.thumb, alt: "", loading: "lazy" }), song.duration ? h("span", { class: "dur" }, fmtTime(song.duration)) : null),
      h("div", { class: "meta" }, h("div", { class: "title", title: song.title }, cleanTitle(song.title)), h("div", { class: "sub" }, song.channel)),
      h(
        "div",
        { class: "actions" },
        starBtn,
        h("button", { class: "icon-btn sm", type: "button", title: "Sing next", onclick: () => queue(song, true) }, icon("next", 16)),
        h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => queue(song) }, icon("plus", 14), h("span", null, "Queue")),
      ),
    );
  }

  function queueRow(item: QueueItem, i: number, s: RoomState) {
    return h(
      "div",
      { class: "song queued" },
      h("div", { class: "num" }, String(i + 1)),
      h("div", { class: "thumb" }, h("img", { src: item.thumb, alt: "", loading: "lazy" }), item.duration ? h("span", { class: "dur" }, fmtTime(item.duration)) : null),
      h("div", { class: "meta" }, h("div", { class: "title" }, cleanTitle(item.title)), h("div", { class: "sub" }, h("b", null, item.singer), h("span", null, item.channel))),
      h(
        "div",
        { class: "actions" },
        i > 0 ? h("button", { class: "icon-btn sm", type: "button", title: "Move to top", onclick: () => room.send({ t: "move", id: item.id, to: 0 }) }, icon("up", 16)) : null,
        h("button", { class: "icon-btn sm danger", type: "button", title: "Remove", onclick: () => room.send({ t: "remove", id: item.id }) }, icon("x", 16)),
      ),
    );
  }

  function empty(title: string, body: string) {
    return h("div", { class: "empty" }, h("div", { class: "empty-title" }, title), h("div", { class: "empty-body" }, body));
  }

  function render() {
    const s = room.state;
    queueCount.textContent = String(s?.queue.length ?? 0);
    queueCount.hidden = !s?.queue.length;
    clear(list);

    if (tab === "search") {
      if (loading) {
        for (let i = 0; i < 6; i++) list.appendChild(h("div", { class: "song skeleton" }, h("div", { class: "thumb" }), h("div", { class: "meta" }, h("div", { class: "bar" }), h("div", { class: "bar short" }))));
        return;
      }
      if (!results.length) {
        list.appendChild(
          lastQuery
            ? empty("No matches", `Nothing for “${lastQuery}”. Try the artist name, or turn off “Karaoke versions only”.`)
            : empty("What are we singing?", "Search any song. We look for karaoke versions first, so the lyrics are on screen."),
        );
        return;
      }
      results.forEach((r) => list.appendChild(songRow(r)));
      return;
    }

    if (tab === "queue") {
      if (!s) return;
      if (s.current) {
        list.appendChild(h("div", { class: "list-label" }, "Now singing"));
        list.appendChild(
          h(
            "div",
            { class: "song now" },
            h("div", { class: "thumb" }, h("img", { src: s.current.thumb, alt: "" }), h("span", { class: "eq" }, h("i"), h("i"), h("i"))),
            h("div", { class: "meta" }, h("div", { class: "title" }, cleanTitle(s.current.title)), h("div", { class: "sub" }, h("b", null, s.current.singer))),
          ),
        );
      }
      list.appendChild(h("div", { class: "list-label" }, "Up next", s.queue.length ? led(String(s.queue.length), "led-sm") : null));
      if (!s.queue.length) list.appendChild(empty("Queue is empty", "Add a song and it starts right away."));
      s.queue.forEach((q, i) => list.appendChild(queueRow(q, i, s)));
      if (s.history.length) {
        list.appendChild(h("div", { class: "list-label" }, "Sung tonight"));
        s.history.slice(0, 15).forEach((q) => list.appendChild(songRow(q)));
      }
      return;
    }

    if (tab === "hits") {
      list.appendChild(
        h(
          "div",
          { class: "chips" },
          ...HITS.map((c) =>
            h("button", { class: "chip", type: "button", onclick: () => ((input.value = c.label), runSearchRaw(c.q)) }, c.label),
          ),
        ),
      );
      list.appendChild(empty("Pick a mood", "Tap a category to load a playlist of sing-along favorites."));
      return;
    }

    if (tab === "stars") {
      const stars = getStars();
      if (!stars.length) list.appendChild(empty("No starred songs yet", "Tap the star on any song to keep it here for next time. Stars stay on this device."));
      stars.forEach((st) => list.appendChild(songRow(st)));
    }
  }

  // Hits queries are already karaoke-tuned, so bypass the input's display text.
  function runSearchRaw(q: string) {
    const label = input.value;
    runSearch(q).then(() => {
      lastQuery = label;
    });
  }

  room.onState(() => {
    if (tab === "queue") render();
    else {
      queueCount.textContent = String(room.state?.queue.length ?? 0);
      queueCount.hidden = !room.state?.queue.length;
    }
  });
  setTab("search");

  return { el: panel, focusSearch: () => input.focus(), setTab };
}
