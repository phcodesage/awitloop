import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isRoomCode } from "../shared/protocol";
import { Room } from "./room";
import { searchSongs, suggest } from "./search";

export { Room };

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
  /** Short public host (awitloop.pages.dev). Pages on the long workers.dev host redirect there. */
  CANONICAL_HOST?: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (env.CANONICAL_HOST && url.hostname.endsWith(".workers.dev") && !path.startsWith("/api/")) {
      return Response.redirect(`https://${env.CANONICAL_HOST}${path}${url.search}`, 301);
    }

    try {
      if (path === "/api/rooms" && req.method === "POST") return createRoom(env);

      if (path === "/api/time") return json({ now: Date.now() }, 0);

      if (path === "/api/search") {
        const songs = await searchSongs(url.searchParams.get("q") ?? "", url.searchParams.get("karaoke") !== "0", ctx);
        return json({ songs }, 300);
      }

      if (path === "/api/suggest") return json({ items: await suggest(url.searchParams.get("q") ?? "") }, 3600);

      const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)(\/ws|\/state)?$/);
      if (m) {
        const code = m[1].toUpperCase();
        if (!isRoomCode(code)) return json({ error: "Invalid room code" }, 0, 400);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const sub = m[2] === "/ws" ? "/ws" : "/state";
        return stub.fetch(new Request(`https://room${sub}`, req));
      }

      if (path.startsWith("/api/")) return json({ error: "Not found" }, 0, 404);
      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : "Server error" }, 0, 502);
    }
  },
} satisfies ExportedHandler<Env>;

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch(`https://room/init?code=${code}`, { method: "POST" });
    if (res.ok) return json({ code }, 0);
  }
  return json({ error: "Could not allocate a room, try again." }, 0, 503);
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let out = "";
  for (const b of bytes) out += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return out;
}

function json(body: unknown, maxAge: number, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}
