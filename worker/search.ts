import type { Song } from "../shared/protocol";

// Keyless YouTube search through the same InnerTube endpoint youtube.com uses.
// Results are cached at the edge so a busy room doesn't hammer YouTube.

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
const CLIENT = { clientName: "WEB", clientVersion: "2.20260901.00.00", hl: "en", gl: "PH" };
/** InnerTube "Type: Video" filter; drops channels, playlists and shorts shelves. */
const VIDEOS_ONLY = "EgIQAQ%3D%3D";
const KARAOKE_WORDS = /karaoke|videoke|instrumental|minus one|sing ?along|backing track/i;

export async function searchSongs(query: string, karaokeOnly: boolean, ctx: ExecutionContext): Promise<Song[]> {
  const q = query.trim().slice(0, 120);
  if (!q) return [];
  const full = karaokeOnly && !KARAOKE_WORDS.test(q) ? `${q} karaoke` : q;

  const cache = caches.default;
  const key = new Request(`https://cache.awitloop/search/v2?q=${encodeURIComponent(full.toLowerCase())}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const res = await fetch(INNERTUBE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    body: JSON.stringify({ context: { client: CLIENT }, query: full, params: VIDEOS_ONLY }),
  });
  if (!res.ok) throw new Error(`YouTube search failed (${res.status})`);
  const parsed = parse(await res.json());
  const flags = await Promise.all(parsed.map((s) => embeddable(s.videoId, ctx)));
  const songs = parsed.filter((_, i) => flags[i]).slice(0, 24);

  const out = Response.json(songs, { headers: { "cache-control": "public, max-age=21600" } });
  ctx.waitUntil(cache.put(key, out.clone()));
  return songs;
}

/**
 * Many big karaoke channels (Sing King among them) disable embedding, which is
 * the classic "song won't play on the TV" bug. oEmbed answers 401 for those, so
 * we drop them before anyone can queue them. Unknown answers are kept.
 */
async function embeddable(videoId: string, ctx: ExecutionContext): Promise<boolean> {
  const cache = caches.default;
  const key = new Request(`https://cache.awitloop/embed/${videoId}`);
  const hit = await cache.match(key);
  if (hit) return (await hit.text()) === "1";
  let ok = true;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) ok = false;
    else if (!res.ok) return true; // don't cache transient failures
  } catch {
    return true;
  }
  ctx.waitUntil(cache.put(key, new Response(ok ? "1" : "0", { headers: { "cache-control": "public, max-age=604800" } })));
  return ok;
}

export async function suggest(query: string): Promise<string[]> {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const url = `https://suggestqueries-clients6.youtube.com/complete/search?client=firefox&ds=yt&hl=en&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as [string, string[]];
    return (data[1] ?? []).slice(0, 8);
  } catch {
    return [];
  }
}

function parse(json: any): Song[] {
  const sections =
    json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
  const songs: Song[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const v = item?.videoRenderer;
      if (!v?.videoId || seen.has(v.videoId)) continue;
      // Live streams have no length and can't be sung along to.
      const length: string | undefined = v.lengthText?.simpleText;
      if (!length) continue;
      seen.add(v.videoId);
      songs.push({
        videoId: v.videoId,
        title: text(v.title),
        channel: text(v.ownerText),
        duration: toSeconds(length),
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      });
      if (songs.length >= 32) return songs; // + oEmbed checks stays under the 50-subrequest cap
    }
  }
  return songs;
}

function text(node: any): string {
  if (!node) return "";
  if (typeof node.simpleText === "string") return node.simpleText;
  return (node.runs ?? []).map((r: any) => r.text).join("");
}

function toSeconds(length: string): number {
  return length.split(":").reduce((acc, part) => acc * 60 + (parseInt(part, 10) || 0), 0);
}
