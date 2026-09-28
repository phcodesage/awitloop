import type { ClientMsg, Role, RoomState, ServerMsg } from "../../shared/protocol";

type Listener = (s: RoomState) => void;
export type ConnStatus = "connecting" | "online" | "offline";

/**
 * Realtime connection to a room.
 *  - Reconnects with backoff and resends `hello`, so a TV that dozes off or a
 *    phone that switches networks rejoins by itself.
 *  - Estimates the server clock (NTP style, keeps the lowest-RTT sample), which
 *    is what lets every screen agree on "where in the song are we".
 *  - Falls back to HTTP polling while the socket is down so the queue on screen
 *    never silently goes stale.
 */
export class RoomClient {
  state: RoomState | null = null;
  memberId = "";
  status: ConnStatus = "connecting";

  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: ConnStatus) => void>();
  private toastListeners = new Set<(t: string, isError: boolean) => void>();
  private outbox: ClientMsg[] = [];
  private retry = 0;
  private offset = 0;
  private bestRtt = Infinity;
  private samples: { rtt: number; offset: number; at: number }[] = [];
  private pingTimer = 0;
  private watchdog = 0;
  /** Last time anything arrived on the socket. A silent "open" socket is a dead one. */
  private lastHeard = 0;
  private pollTimer = 0;
  private closed = false;

  constructor(
    readonly code: string,
    private role: Role,
    private name: string,
  ) {
    this.connect();
    // Phones that sleep or switch apps often come back with a socket that still
    // reports OPEN but is dead. On wake, re-check the clock and require an answer fast.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (!this.ws || this.ws.readyState > 1) return this.connect();
      const asked = Date.now();
      this.burstPing();
      window.setTimeout(() => {
        if (this.lastHeard < asked) this.reconnectNow();
      }, 3000);
    });
    this.watchdog = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastHeard > 25000) this.reconnectNow();
    }, 5000);
    window.addEventListener("online", () => this.connect());
  }

  /** Server epoch ms, as best we can tell. */
  now(): number {
    return Date.now() + this.offset;
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== "ping") this.outbox.push(msg);
  }

  setName(name: string) {
    this.name = name;
    this.send({ t: "hello", name, role: this.role });
  }

  onState(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.state) fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onStatus(fn: (s: ConnStatus) => void) {
    this.statusListeners.add(fn);
    fn(this.status);
  }

  onToast(fn: (t: string, isError: boolean) => void) {
    this.toastListeners.add(fn);
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.watchdog);
    this.ws?.close();
  }

  /** Drop a socket we no longer trust and dial again immediately. */
  private reconnectNow() {
    const old = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try {
        old.close();
      } catch {
        /* already gone */
      }
    }
    this.setStatus("connecting");
    this.retry = 0;
    this.connect();
  }

  private setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
    clearInterval(this.pollTimer);
    if (s === "offline") this.pollTimer = window.setInterval(() => this.poll(), 4000);
  }

  private connect() {
    if (this.closed) return;
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${this.code}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.lastHeard = Date.now();
      this.setStatus("online");
      ws.send(JSON.stringify({ t: "hello", name: this.name, role: this.role } satisfies ClientMsg));
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
      this.burstPing();
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 10000);
    };

    ws.onmessage = (ev) => {
      this.lastHeard = Date.now();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handle(msg);
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.setStatus("offline");
      if (ev.code === 4404) return;
      const delay = Math.min(10000, 500 * 2 ** this.retry++) + Math.random() * 300;
      window.setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private handle(msg: ServerMsg) {
    switch (msg.t) {
      case "welcome":
        this.memberId = msg.memberId;
        break;
      case "pong": {
        const t = Date.now();
        const rtt = t - msg.c;
        this.samples.push({ rtt, offset: msg.s - (msg.c + rtt / 2), at: t });
        this.samples = this.samples.filter((x) => t - x.at < 5 * 60_000).slice(-12);
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.offset;
        this.bestRtt = best.rtt;
        break;
      }
      case "state":
        // A snapshot also carries serverNow; use it only until real pings land.
        if (this.bestRtt === Infinity) this.offset = msg.serverNow - Date.now();
        if (this.state && msg.state.version < this.state.version && msg.state.code === this.state.code) break;
        this.state = msg.state;
        this.listeners.forEach((fn) => fn(msg.state));
        break;
      case "toast":
        this.toastListeners.forEach((fn) => fn(msg.text, false));
        break;
      case "error":
        this.toastListeners.forEach((fn) => fn(msg.text, true));
        break;
    }
  }

  private ping() {
    this.send({ t: "ping", c: Date.now() });
  }

  private burstPing() {
    for (let i = 0; i < 5; i++) window.setTimeout(() => this.ping(), i * 250);
  }

  private async poll() {
    try {
      const res = await fetch(`/api/rooms/${this.code}/state`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { state: RoomState; serverNow: number };
      this.handle({ t: "state", state: data.state, serverNow: data.serverNow });
    } catch {
      /* still offline */
    }
    this.connect();
  }
}

export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("Could not create a room");
  return ((await res.json()) as { code: string }).code;
}

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`/api/rooms/${code}/state`, { cache: "no-store" });
  return res.ok;
}
