import type { RoomState } from "../../shared/protocol";
import type { RoomClient } from "./room";

/* Minimal typings for the YouTube IFrame API. */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
/** Beyond this, a screen is considered out of sync and hard-seeks. */
const DRIFT_TOLERANCE = 0.25;
/** Minimum gap between corrective seeks, so a slow TV never stutters in a loop. */
const SEEK_COOLDOWN_MS = 4000;

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}

export interface SyncedPlayerOptions {
  /** Muted screens (e.g. host preview while a TV is on stage) stay in sync silently. */
  muted: () => boolean;
  /** Called when the browser refuses to autoplay with sound. */
  onNeedsGesture: (needs: boolean) => void;
  onTick?: (position: number, duration: number) => void;
}

/**
 * A YouTube player that follows the room clock instead of its own.
 * It never decides what plays; it only converges on the room snapshot.
 */
export class SyncedPlayer {
  private yt: any = null;
  private ready = false;
  private loadedId: string | null = null;
  private loadedItemId: string | null = null;
  private reportedEnd: string | null = null;
  private reportedDuration: string | null = null;
  private tickTimer = 0;
  private startWatch = 0;
  private lastSeekAt = 0;
  /**
   * Seeking takes a moment, so we aim slightly ahead. The lead is learned per
   * device: a sluggish TV ends up with a bigger lead than a laptop.
   */
  private seekLead = 0.12;
  private pendingMeasure = 0;
  // Optimistic: many browsers allow sound after an earlier click. watchAutoplay() corrects us.
  unlocked = true;

  constructor(
    private host: HTMLElement,
    private room: RoomClient,
    private opts: SyncedPlayerOptions,
  ) {
    const mount = document.createElement("div");
    const shield = document.createElement("div");
    shield.className = "video-shield";
    host.appendChild(mount);
    host.appendChild(shield);
    loadApi().then(() => {
      this.yt = new window.YT.Player(mount, {
        width: "100%",
        height: "100%",
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1, // our own shortcuts; also stops YouTube from eating keystrokes
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          cc_load_policy: 0,
          origin: location.origin,
        },
        events: {
          onReady: () => {
            this.ready = true;
            this.sync();
          },
          onStateChange: (e: any) => this.onStateChange(e.data),
          onError: (e: any) => this.onError(e.data),
        },
      });
    });
    room.onState(() => this.sync());
    // Handy for debugging sync from the console: __awitloop.drift()
    (window as any).__awitloop = this;
    this.tickTimer = window.setInterval(() => this.tick(), 500);
  }

  /** Must be called from a click/tap/OK-press to allow sound. */
  unlock() {
    this.unlocked = true;
    this.opts.onNeedsGesture(false);
    if (!this.ready) return;
    this.applyMute();
    this.sync(true);
    if (this.room.state?.playback.status === "playing") this.yt.playVideo();
  }

  applyMute() {
    if (!this.ready) return;
    const s = this.room.state;
    if (this.opts.muted() || !this.unlocked) this.yt.mute();
    else {
      this.yt.unMute();
      if (s) this.yt.setVolume(s.volume);
    }
  }

  /** Seconds this screen is ahead (+) or behind (-) the room clock. */
  drift(): number | null {
    const s = this.room.state;
    if (!this.ready || !s?.current || s.playback.status !== "playing") return null;
    return this.yt.getCurrentTime() - this.target(s);
  }

  destroy() {
    clearInterval(this.tickTimer);
    this.yt?.destroy?.();
  }

  private target(s: RoomState): number {
    const p = s.playback;
    if (p.status !== "playing") return p.position;
    return (this.room.now() - p.anchor) / 1000; // may be negative during the start lead
  }

  sync(force = false) {
    const s = this.room.state;
    if (!this.ready || !s) return;
    this.applyMute();

    if (!s.current) {
      if (this.loadedId) {
        this.yt.stopVideo();
        this.loadedId = null;
        this.loadedItemId = null;
      }
      return;
    }

    const target = this.target(s);
    const playing = s.playback.status === "playing";

    if (s.current.id !== this.loadedItemId) {
      this.loadedItemId = s.current.id;
      this.loadedId = s.current.videoId;
      const start = Math.max(0, target);
      if (playing) {
        this.yt.loadVideoById({ videoId: s.current.videoId, startSeconds: start });
        this.watchAutoplay();
      } else {
        this.yt.cueVideoById({ videoId: s.current.videoId, startSeconds: start });
      }
      return;
    }

    const state = this.yt.getPlayerState();
    if (!playing) {
      if (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING) this.yt.pauseVideo();
      if (Math.abs(this.yt.getCurrentTime() - target) > DRIFT_TOLERANCE) this.yt.seekTo(target, true);
      return;
    }

    if (target < 0) {
      // Waiting for the shared start moment; hold at the top.
      if (state === YT_STATE.PLAYING) this.yt.pauseVideo();
      return;
    }

    if (state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING) {
      this.yt.seekTo(target + this.seekLead, true);
      this.yt.playVideo();
      this.watchAutoplay();
      return;
    }

    const drift = this.yt.getCurrentTime() - target;
    const sinceSeek = Date.now() - this.lastSeekAt;

    // Learn from the last correction: if we still landed late or early, shift the lead.
    if (this.pendingMeasure && sinceSeek > 1500 && state === YT_STATE.PLAYING) {
      this.pendingMeasure = 0;
      this.seekLead = Math.max(0, Math.min(1.5, this.seekLead - drift * 0.8));
    }

    if (force || (Math.abs(drift) > DRIFT_TOLERANCE && sinceSeek > SEEK_COOLDOWN_MS && state === YT_STATE.PLAYING)) {
      this.lastSeekAt = Date.now();
      this.pendingMeasure = 1;
      this.yt.seekTo(target + this.seekLead, true);
    }
  }

  private tick() {
    const s = this.room.state;
    if (!this.ready || !s?.current) {
      this.opts.onTick?.(0, 0);
      return;
    }
    const duration = this.yt.getDuration?.() || s.current.duration || 0;
    this.opts.onTick?.(Math.max(0, this.target(s)), duration);

    // Fill in unknown durations so the server can auto-advance even if every screen sleeps.
    if (!s.current.duration && duration > 0 && this.reportedDuration !== s.current.id) {
      this.reportedDuration = s.current.id;
      this.room.send({ t: "duration", currentId: s.current.id, seconds: Math.round(duration) });
    }
    this.sync();
  }

  /** Some TVs/phones silently refuse autoplay. Detect it and ask for one tap. */
  private watchAutoplay() {
    clearTimeout(this.startWatch);
    this.startWatch = window.setTimeout(() => {
      const s = this.room.state;
      if (!s || s.playback.status !== "playing" || this.target(s) < 0) return;
      const st = this.yt.getPlayerState();
      if (st !== YT_STATE.PLAYING && st !== YT_STATE.BUFFERING) {
        // Muted autoplay is always allowed; start silently and ask for a tap for sound.
        this.unlocked = false;
        this.yt.mute();
        this.yt.playVideo();
        this.opts.onNeedsGesture(true);
      }
    }, 2500);
  }

  private onStateChange(state: number) {
    const s = this.room.state;
    if (!s?.current) return;
    if (state === YT_STATE.ENDED && this.reportedEnd !== s.current.id) {
      this.reportedEnd = s.current.id;
      this.room.send({ t: "ended", currentId: s.current.id });
    }
    if (state === YT_STATE.PLAYING && !this.unlocked && !this.opts.muted()) {
      // Playing with sound but we thought we were locked: the browser allowed it.
      if (!this.yt.isMuted()) {
        this.unlocked = true;
        this.opts.onNeedsGesture(false);
      }
    }
  }

  private onError(code: number) {
    const s = this.room.state;
    if (!s?.current) return;
    // 100: removed/private, 101/150: embedding disabled, 2/5: bad id / html5 error.
    this.room.send({ t: "unplayable", currentId: s.current.id, code });
  }
}
