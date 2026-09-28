import { DurableObject } from "cloudflare:workers";
import type { ClientMsg, Member, QueueItem, Role, RoomState, ServerMsg, Song } from "../shared/protocol";
import { positionAt } from "../shared/protocol";

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

interface Attachment extends Member {
  /** Sliding window for a cheap per-socket rate limit. */
  windowStart: number;
  windowCount: number;
}

/** Clients get this long to load a new video before the shared clock starts. */
const START_LEAD_MS = 1200;
/** If no screen reports "ended", the room advances on its own after this grace. */
const END_GRACE_MS = 5000;
/** Rooms nobody has touched for this long are wiped. */
const IDLE_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const MAX_QUEUE = 200;
const MAX_HISTORY = 50;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 60;

const clip = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);

export class Room extends DurableObject<Env> {
  private state: RoomState | null = null;

  private async load(): Promise<RoomState | null> {
    if (!this.state) this.state = (await this.ctx.storage.get<RoomState>("state")) ?? null;
    return this.state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/init" && req.method === "POST") {
      if (await this.load()) return new Response("exists", { status: 409 });
      const code = url.searchParams.get("code") ?? "";
      this.state = {
        code,
        version: 0,
        current: null,
        queue: [],
        history: [],
        playback: { status: "idle", anchor: 0, position: 0 },
        members: [],
        volume: 80,
      };
      await this.persist();
      return Response.json({ code });
    }

    const state = await this.load();
    if (!state) return new Response("Room not found", { status: 404 });

    if (url.pathname === "/state") {
      return Response.json({ state: this.snapshot(), serverNow: Date.now() });
    }

    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      const att: Attachment = {
        id: crypto.randomUUID().slice(0, 8),
        name: "Guest",
        role: "remote",
        windowStart: Date.now(),
        windowCount: 0,
      };
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(att);
      this.send(pair[1], { t: "welcome", memberId: att.id });
      this.send(pair[1], { t: "state", state: this.snapshot(), serverNow: Date.now() });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const state = await this.load();
    if (!state || typeof raw !== "string" || raw.length > 4096) return;

    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Answer clock pings before anything else so the round trip stays tight.
    if (msg.t === "ping") {
      this.send(ws, { t: "pong", c: Number(msg.c) || 0, s: Date.now() });
      return;
    }

    const att = ws.deserializeAttachment() as Attachment;
    const now = Date.now();
    if (now - att.windowStart > RATE_WINDOW_MS) {
      att.windowStart = now;
      att.windowCount = 0;
    }
    if (++att.windowCount > RATE_MAX) {
      ws.serializeAttachment(att);
      this.send(ws, { t: "error", text: "Slow down a little!" });
      return;
    }
    ws.serializeAttachment(att);

    const changed = this.apply(ws, att, msg, now);
    if (changed) await this.commit();
  }

  /** Returns true when room state changed and should be broadcast. */
  private apply(ws: WebSocket, att: Attachment, msg: ClientMsg, now: number): boolean {
    const s = this.state!;
    const pb = s.playback;

    switch (msg.t) {
      case "hello": {
        att.name = clip(msg.name, 24) || "Guest";
        att.role = (["host", "stage", "remote"] as Role[]).includes(msg.role) ? msg.role : "remote";
        ws.serializeAttachment(att);
        return true;
      }

      case "add": {
        if (s.queue.length >= MAX_QUEUE) {
          this.send(ws, { t: "error", text: "The queue is full." });
          return false;
        }
        const song = sanitizeSong(msg.song);
        if (!song) return false;
        const item: QueueItem = {
          ...song,
          id: crypto.randomUUID().slice(0, 10),
          singer: clip(msg.singer, 24) || att.name,
          addedBy: att.name,
          addedAt: now,
        };
        if (!s.current) {
          this.startItem(item, now);
        } else if (msg.next) {
          s.queue.unshift(item);
        } else {
          s.queue.push(item);
        }
        this.broadcastToast(`${item.singer} queued “${shortTitle(item.title)}”`, ws);
        return true;
      }

      case "remove": {
        const before = s.queue.length;
        s.queue = s.queue.filter((q) => q.id !== msg.id);
        return s.queue.length !== before;
      }

      case "move": {
        const from = s.queue.findIndex((q) => q.id === msg.id);
        if (from < 0) return false;
        const to = Math.max(0, Math.min(s.queue.length - 1, Math.floor(Number(msg.to) || 0)));
        const [item] = s.queue.splice(from, 1);
        s.queue.splice(to, 0, item);
        return true;
      }

      case "play": {
        if (!s.current) return this.advance(now);
        if (pb.status === "playing") return false;
        s.playback = { status: "playing", anchor: now + 300 - pb.position * 1000, position: pb.position };
        return true;
      }

      case "pause": {
        if (pb.status !== "playing") return false;
        s.playback = { status: "paused", anchor: 0, position: positionAt(pb, now) };
        return true;
      }

      case "seek": {
        if (!s.current) return false;
        const max = s.current.duration || 60 * 60;
        const position = Math.max(0, Math.min(max, Number(msg.position) || 0));
        s.playback =
          pb.status === "playing"
            ? { status: "playing", anchor: now + 300 - position * 1000, position }
            : { status: "paused", anchor: 0, position };
        return true;
      }

      case "restart": {
        if (!s.current) return false;
        s.playback = { status: "playing", anchor: now + START_LEAD_MS, position: 0 };
        return true;
      }

      // Skip carries the id the sender saw as current. Two people tapping skip
      // at once therefore only skips one song, not two.
      case "skip": {
        if (msg.currentId !== (s.current?.id ?? null)) return false;
        return this.advance(now);
      }

      case "ended": {
        if (!s.current || msg.currentId !== s.current.id) return false;
        return this.advance(now);
      }

      case "unplayable": {
        if (!s.current || msg.currentId !== s.current.id) return false;
        const title = shortTitle(s.current.title);
        this.broadcastToast(`Skipped “${title}”: the uploader blocks playback outside YouTube.`);
        return this.advance(now);
      }

      case "duration": {
        if (!s.current || msg.currentId !== s.current.id || s.current.duration) return false;
        const secs = Math.floor(Number(msg.seconds) || 0);
        if (secs <= 0 || secs > 6 * 3600) return false;
        s.current.duration = secs;
        return true;
      }

      case "volume": {
        const v = Math.max(0, Math.min(100, Math.round(Number(msg.value) || 0)));
        if (v === s.volume) return false;
        s.volume = v;
        return true;
      }
    }
    return false;
  }

  private startItem(item: QueueItem, now: number) {
    const s = this.state!;
    if (s.current) s.history = [s.current, ...s.history].slice(0, MAX_HISTORY);
    s.current = item;
    s.playback = { status: "playing", anchor: now + START_LEAD_MS, position: 0 };
  }

  private advance(now: number): boolean {
    const s = this.state!;
    const next = s.queue.shift();
    if (next) {
      this.startItem(next, now);
    } else {
      if (!s.current && s.playback.status === "idle") return false;
      if (s.current) s.history = [s.current, ...s.history].slice(0, MAX_HISTORY);
      s.current = null;
      s.playback = { status: "idle", anchor: 0, position: 0 };
    }
    return true;
  }

  async alarm() {
    const s = await this.load();
    if (!s) return;
    const now = Date.now();
    const last = (await this.ctx.storage.get<number>("touched")) ?? now;
    if (now - last > IDLE_TTL_MS && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.state = null;
      return;
    }
    // Fallback for when every screen is closed or asleep: keep the night moving.
    const end = this.expectedEnd();
    if (end && now >= end) {
      this.advance(now);
      await this.commit();
      return;
    }
    await this.schedule();
  }

  private expectedEnd(): number | null {
    const s = this.state;
    if (!s?.current?.duration || s.playback.status !== "playing") return null;
    return s.playback.anchor + s.current.duration * 1000 + END_GRACE_MS;
  }

  private async schedule() {
    const idle = Date.now() + IDLE_TTL_MS;
    const end = this.expectedEnd();
    await this.ctx.storage.setAlarm(end ? Math.min(end, idle) : idle);
  }

  async webSocketClose(ws: WebSocket) {
    this.closeQuietly(ws);
    await this.load();
    if (this.state) this.broadcastState();
  }

  async webSocketError(ws: WebSocket) {
    this.closeQuietly(ws);
  }

  private closeQuietly(ws: WebSocket) {
    try {
      ws.close(1000, "bye");
    } catch {
      /* already closed */
    }
  }

  private async commit() {
    this.state!.version++;
    await this.persist();
    this.broadcastState();
  }

  private async persist() {
    await this.ctx.storage.put({ state: this.state, touched: Date.now() });
    await this.schedule();
  }

  private snapshot(): RoomState {
    const members: Member[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) members.push({ id: a.id, name: a.name, role: a.role });
    }
    return { ...this.state!, members };
  }

  private broadcastState() {
    const msg = JSON.stringify({ t: "state", state: this.snapshot(), serverNow: Date.now() } satisfies ServerMsg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* socket went away mid-broadcast */
      }
    }
  }

  private broadcastToast(text: string, except?: WebSocket) {
    const msg = JSON.stringify({ t: "toast", text } satisfies ServerMsg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

function sanitizeSong(raw: unknown): Song | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const videoId = String(r.videoId ?? "");
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  const duration = Math.max(0, Math.min(6 * 3600, Math.floor(Number(r.duration) || 0)));
  return {
    videoId,
    title: clip(r.title, 160) || "Untitled",
    channel: clip(r.channel, 80),
    duration,
    thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}

function shortTitle(t: string) {
  return t.length > 48 ? t.slice(0, 46) + "…" : t;
}
