import { isRoomCode } from "../../shared/protocol";
import { createRoom, roomExists } from "../lib/room";
import { brand, disc, h, icon, led, themeToggle, toast } from "../lib/ui";

export function Landing(root: HTMLElement) {
  document.title = "Awitloop · Karaoke on any screen";

  const start = async (btn: HTMLElement) => {
    btn.setAttribute("disabled", "");
    try {
      const code = await createRoom();
      location.href = `/r/${code}`;
    } catch {
      toast("Couldn't create a room. Check your connection and try again.", "error");
      btn.removeAttribute("disabled");
    }
  };
  const startBtn = h("button", { class: "btn btn-primary btn-lg", type: "button" }, "Start a room");
  startBtn.addEventListener("click", () => start(startBtn));

  const codeInput = h("input", {
    class: "code-input led",
    maxlength: 5,
    placeholder: "·····",
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
          toast("No room with that code. Check the code on the TV.", "error");
          return;
        }
        location.href = `/m/${code}`;
      },
    },
    h("label", { class: "join-label" }, "Have a code?"),
    codeInput,
    h("button", { class: "btn btn-ghost", type: "submit" }, "Join"),
  );

  // Real comments from people who used a similar app, and what Awitloop does about each.
  const fixes: [string, string][] = [
    ["Songs are out of sync across different users in the same room.", "Every screen follows one room clock and corrects itself when it drifts more than a quarter second. Two TVs in the same room stay within milliseconds."],
    ["The skip button is non-functional.", "Skip goes through the room, so it works from any phone. If two people press it together, only one song is skipped."],
    ["Cannot type the letter “u” in the search box.", "Shortcuts are off while you type, so search takes every letter."],
    ["Ayaw magplay ng video sa LG. Doesn't work on our Samsung TV.", "The TV view is built for older LG and Samsung browsers, and handles the remote's OK and play buttons. Uploads that block TV playback are left out of search."],
    ["Chose a song from phone, song didn't show up on TV.", "Every change is pushed to every screen, and a TV that drops off Wi-Fi catches up as soon as it reconnects."],
    ["Sana magkaroon ng voice search.", "Tap the mic on your phone and say the song."],
  ];

  const faq: [string, string][] = [
    ["Do I need an internet connection?", "Yes. Songs stream from YouTube, so the TV and the phones need to be online. They don't need to be on the same Wi-Fi."],
    ["Do I need a microphone?", "Only if you want one. Awitloop plays the song and the lyrics. Plug any mic into your speaker or TV as usual."],
    ["Which TVs work?", "Any TV with a web browser: LG webOS, Samsung Tizen, Android TV, or a laptop connected with HDMI. Open awitloop on the TV and press OK once."],
    ["Where do the songs come from?", "YouTube. Search looks for karaoke versions first. Turn that off in the songbook to find any upload."],
    ["Does it cost anything?", "No. Awitloop is free and open source."],
  ];

  const heroDisc = disc("disc-hero spinning", h("span", { class: "hero-label" }, led("SING", "led-xl"), h("span", null, "side A")));

  root.appendChild(
    h(
      "div",
      { class: "landing" },
      h("header", { class: "topbar wrap" }, brand("lg"), h("nav", { class: "topnav" }, h("a", { href: "#fixed" }, "What's fixed"), h("a", { href: "#setup" }, "Setup"), h("a", { href: "#faq" }, "FAQ"), themeToggle())),
      h(
        "section",
        { class: "hero wrap" },
        h(
          "div",
          { class: "hero-copy" },
          h("h1", { class: "hero-title" }, "Karaoke night on any screen you own."),
          h("p", { class: "hero-sub" }, "Open Awitloop on the TV. Everyone adds songs from their phone, and every screen plays the same line at the same moment."),
          h("div", { class: "hero-cta" }, startBtn, joinForm),
          h("p", { class: "hero-tv" }, icon("tv", 16), h("span", null, "On a smart TV, open ", h("b", null, `${location.host}/tv`), " in its browser.")),
        ),
        h("div", { class: "hero-art", "aria-hidden": "true" }, heroDisc),
      ),
      h(
        "section",
        { class: "wrap section", id: "fixed" },
        h("h2", { class: "section-title" }, "You told us what broke."),
        h("p", { class: "section-sub" }, "These are real comments about karaoke web apps. Here's what Awitloop does about each one."),
        h(
          "div",
          { class: "fixes" },
          ...fixes.map(([said, did]) => h("div", { class: "fix" }, h("blockquote", { class: "fix-said" }, said), h("p", { class: "fix-did" }, did))),
        ),
      ),
      h(
        "section",
        { class: "wrap section", id: "setup" },
        h("h2", { class: "section-title" }, "Set up in three steps."),
        h(
          "ol",
          { class: "steps" },
          h("li", null, led("1", "step-n"), h("h3", null, "Open it on the big screen"), h("p", null, "Use the TV's browser at /tv, or a laptop connected with HDMI.")),
          h("li", null, led("2", "step-n"), h("h3", null, "Scan the disc"), h("p", null, "Every phone that scans the QR code becomes a songbook. No app or account.")),
          h("li", null, led("3", "step-n"), h("h3", null, "Sing"), h("p", null, "Songs play back to back. Anyone can reorder the queue or skip.")),
        ),
      ),
      h(
        "section",
        { class: "wrap section", id: "faq" },
        h("h2", { class: "section-title" }, "Questions"),
        h("div", { class: "faq" }, ...faq.map(([q, a]) => h("details", null, h("summary", null, q, h("span", { class: "plus" }, icon("plus", 16))), h("p", null, a)))),
      ),
      h(
        "footer",
        { class: "wrap footer" },
        brand(),
        h("p", null, "Songs play through YouTube. Awitloop isn't affiliated with YouTube."),
        h("a", { href: "https://github.com/phcodesage/awitloop", target: "_blank", rel: "noopener" }, "Source on GitHub"),
      ),
    ),
  );
}
