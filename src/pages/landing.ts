import { isRoomCode } from "../../shared/protocol";
import { createRoom, roomExists } from "../lib/room";
import { brand, h, icon, themeToggle, toast } from "../lib/ui";

export function Landing(root: HTMLElement) {
  document.title = "Awitloop · Turn any screen into a karaoke room";

  const startBtn = h("button", { class: "btn btn-accent btn-lg", type: "button" }, icon("play", 16), h("span", null, "Start a room"));
  startBtn.addEventListener("click", async () => {
    startBtn.setAttribute("disabled", "");
    try {
      const code = await createRoom();
      location.href = `/r/${code}`;
    } catch {
      toast("Couldn't create a room. Try again?", "error");
      startBtn.removeAttribute("disabled");
    }
  });

  const codeInput = h("input", {
    class: "code-input",
    maxlength: 5,
    placeholder: "ROOM CODE",
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: false,
    "aria-label": "Room code",
  }) as HTMLInputElement;
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  const joinForm = h(
    "form",
    {
      class: "join",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const code = codeInput.value.trim().toUpperCase();
        if (!isRoomCode(code) || !(await roomExists(code))) {
          toast("That room doesn't exist. Check the code on the TV.", "error");
          return;
        }
        location.href = `/m/${code}`;
      },
    },
    codeInput,
    h("button", { class: "btn btn-ghost", type: "submit" }, "Join"),
  );

  const features: [string, string, string][] = [
    ["users", "Every screen, same second", "A shared clock keeps the TV, the laptop, and your cousin's tablet on the same syllable. Drift gets corrected before you can hear it."],
    ["phone", "Phones are the songbook", "Scan the QR and you're in. No app and no login. Anyone can queue, reorder, or skip."],
    ["mic", "Say it, sing it", "Voice search on your phone. Say “Bituing Walang Ningning” and it's queued."],
    ["tv", "Built for real TVs", "Tested against the old browsers on LG webOS and Samsung Tizen. Full-bleed stage view, big type, and a one-button start for the TV remote."],
    ["skip", "Skip means skip", "Skips go through the room, not one device. If two people tap at once, only one song gets skipped."],
    ["fire", "No dead air", "The next song starts the moment one ends. If a video can't be embedded, it moves on and says why."],
  ];

  const faq: [string, string][] = [
    ["Do I need an internet connection?", "Yes. Songs stream from YouTube, so the TV and the phones need to be online. They don't need to be on the same Wi-Fi."],
    ["Do I need a microphone?", "Only if you want to be loud. Awitloop handles the songs and lyrics. Use any mic or speaker setup you already have."],
    ["Which TVs work?", "Anything with a web browser: LG webOS, Samsung Tizen, Android TV, a Chromecast with Google TV, or a laptop over HDMI. Open awitloop on the TV and press OK once to turn on sound."],
    ["Where do the songs come from?", "YouTube. We look for karaoke uploads first (Sing King, KaraFun, and others), and you can switch that off for any song."],
    ["Does it cost anything?", "No. Awitloop is free and open source."],
  ];

  root.appendChild(
    h(
      "div",
      { class: "landing" },
      h("header", { class: "topbar wrap" }, brand("lg"), h("nav", { class: "topnav" }, h("a", { href: "#how" }, "How it works"), h("a", { href: "#faq" }, "FAQ"), themeToggle())),
      h(
        "section",
        { class: "hero wrap" },
        h("div", { class: "hero-glow", "aria-hidden": "true" }),
        h("p", { class: "eyebrow" }, h("span", { class: "dot" }), "Free · No app · Works on smart TVs"),
        h("h1", { class: "hero-title" }, "Every living room", h("br"), "is a ", h("span", { class: "accent" }, "KTV"), " now."),
        h("p", { class: "hero-sub" }, "Put Awitloop on the big screen and everyone queues songs from their phone. Playback stays in sync on every screen, and skip works every time."),
        h("div", { class: "hero-cta" }, startBtn, joinForm),
        h("p", { class: "hero-tv" }, icon("tv", 16), h("span", null, "On a smart TV? Open ", h("b", { class: "mono" }, `${location.host}/tv`), " in its browser. It makes a room and shows a QR code.")),
      ),
      h(
        "section",
        { class: "wrap section", id: "features" },
        h("p", { class: "kicker" }, "Why it's better"),
        h("h2", { class: "section-title" }, "We read the comments, then fixed what they said."),
        h(
          "div",
          { class: "feature-grid" },
          ...features.map(([ic, t, d]) => h("article", { class: "feature" }, h("div", { class: "feature-ic" }, icon(ic, 22)), h("h3", null, t), h("p", null, d))),
        ),
      ),
      h(
        "section",
        { class: "wrap section", id: "how" },
        h("p", { class: "kicker" }, "How it works"),
        h("h2", { class: "section-title" }, "Three steps to the first high note."),
        h(
          "ol",
          { class: "steps" },
          h("li", null, h("span", { class: "step-n mono" }, "01"), h("h3", null, "Open it on the big screen"), h("p", null, "Use a laptop over HDMI, or the TV's own browser at /tv.")),
          h("li", null, h("span", { class: "step-n mono" }, "02"), h("h3", null, "Everyone scans the QR"), h("p", null, "Phones become remotes. Search, queue, reorder, or skip.")),
          h("li", null, h("span", { class: "step-n mono" }, "03"), h("h3", null, "Sing"), h("p", null, "Songs play back to back. Every screen stays on the same line of lyrics.")),
        ),
      ),
      h(
        "section",
        { class: "wrap section", id: "faq" },
        h("p", { class: "kicker" }, "FAQ"),
        h("h2", { class: "section-title" }, "Questions from the comments."),
        h("div", { class: "faq" }, ...faq.map(([q, a]) => h("details", null, h("summary", null, q, h("span", { class: "plus" }, icon("plus", 16))), h("p", null, a)))),
      ),
      h(
        "section",
        { class: "wrap cta-band" },
        h("h2", null, "The mic is warm."),
        h("p", null, "Start a room in one tap. No sign-up."),
        (() => {
          const b = h("button", { class: "btn btn-light btn-lg", type: "button" }, "Start a room");
          b.addEventListener("click", () => startBtn.click());
          return b;
        })(),
      ),
      h(
        "footer",
        { class: "wrap footer" },
        brand(),
        h("span", { class: "muted" }, "Songs play through YouTube. Awitloop isn't affiliated with YouTube."),
        h("a", { class: "muted", href: "https://github.com/phcodesage/awitloop", target: "_blank", rel: "noopener" }, "GitHub"),
      ),
    ),
  );
}
