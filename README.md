# Awitloop

**Turn any TV into a karaoke room. Phones are the songbook.**

*awit* (Filipino: song) + *loop*. Put Awitloop on the big screen, everyone scans the QR code, and songs play back to back. Every screen stays on the same line of lyrics.

**Live:** https://awitloop.rechceltoledo.workers.dev

| Route | What it is |
| --- | --- |
| `/` | Landing page. Start a room or join with a code |
| `/r/CODE` | Host console for a laptop: player on the left, songbook on the right |
| `/tv` | Open on a smart TV. Creates a room and shows a QR code, so you never type on the TV |
| `/tv/CODE` | Full-screen TV stage view |
| `/m/CODE` | Phone remote: search (including voice), queue, reorder, skip |

## What's fixed compared to the usual web karaoke apps

These come straight from user feedback on similar apps:

| Complaint | What Awitloop does |
| --- | --- |
| "Songs are out of sync across users" | The room keeps one server clock. Each screen estimates its offset from that clock (NTP-style, using the lowest-latency ping) and seeks whenever it drifts more than 250 ms. The seek lead is learned per device, so slow TVs land on time too. In testing, two screens stayed within **~2 ms** of each other. |
| "Skip button is non-functional" | Skip is a room action carrying the id of the song the sender saw. If two people tap at once, only one song gets skipped. A Durable Object alarm also advances the queue if every screen is asleep. |
| "Can't type the letter *u* in search" | Keyboard shortcuts ignore key presses in text fields, and the YouTube player's own shortcuts are disabled (`disablekb`). |
| "Video won't play on LG" / "Doesn't work on Samsung TV" | There's a legacy build (Chromium 53+) for webOS/Tizen browsers. The stage page has a "Press OK to start" screen, because TVs block sound until a button is pressed. It also handles the remote's media keys. |
| "Song chosen from phone didn't show on TV" | Every change sends a full, versioned snapshot over WebSocket. Clients reconnect automatically, and poll over HTTP while the socket is down. |
| "Screen is half" | The stage view is sized in `vw`/`vh` and fills any panel edge to edge. |
| "Queued song takes minutes to start" | Changes are pushed, not polled. New songs start 1.2 s after they're queued, which gives every screen time to buffer. |
| Songs that silently never play | Search drops uploads that block embedding (Sing King and others) before anyone can queue them. If one gets through anyway, it's skipped and a toast says why. |
| "Light theme not working as intended" | Both themes define every color token. Light mode follows your system setting, and the toggle is remembered. |
| "Voice search next patch" | Voice search is built in, using the Web Speech API (en-PH / fil-PH). |
| "The YouTube player is visible" | Player chrome is hidden: no controls, no related videos, no annotations, `youtube-nocookie` host. |

## Stack

- **Cloudflare Workers** serve the static app and the `/api/*` routes.
- **Durable Objects** (SQLite-backed, WebSocket Hibernation): one object per room is the single source of truth for queue and playback.
- **Search** goes through YouTube's InnerTube endpoint, so no API key is needed. Results are cached at the edge, and each video is checked for embeddability.
- **Frontend**: Vite + vanilla TypeScript, about 21 KB gzipped, with `@vitejs/plugin-legacy` for old TV browsers. Design tokens come from [Musico](https://musico.framer.website/): ink black `#0b0b0b` and ember orange `#dc6d28`, with Inter and Fragment Mono.

```
phone ─┐                       ┌─ TV stage (/tv/CODE)
phone ─┼── WebSocket ── Room ──┼─ host console (/r/CODE)
phone ─┘   (Durable Object)    └─ any other screen
```

Clients never advance the queue on their own. They send intents (`add`, `skip`, `seek`, `ended`…) and render the snapshot that comes back.

## Develop

```bash
npm install
npm run build          # typecheck + vite build → dist/
npx wrangler dev       # worker + assets on http://localhost:8787
# or, for frontend hot reload, run `npx wrangler dev` and `npm run dev` side by side
```

Deploy:

```bash
npm run deploy
```

Handy for debugging sync: open the browser console on any playing screen and run `__awitloop.drift()`. It returns the number of seconds this screen is ahead of (+) or behind (−) the room.

## Keyboard (host console)

`Space` play/pause · `←`/`→` ±10 s · `N` skip · `F` fullscreen · `/` focus search

## FAQ

- **Internet?** Yes. Songs stream from YouTube.
- **Mic?** Use whatever you have. Awitloop handles songs and lyrics.
- **Which TVs?** Any TV with a browser: LG webOS, Samsung Tizen, Android TV, or a laptop over HDMI.

## License

MIT. Songs play through the YouTube embedded player. Awitloop isn't affiliated with YouTube.
