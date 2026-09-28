// Wire protocol shared by the Worker (Room Durable Object) and every client.
// The room is the single source of truth: clients never advance the queue on
// their own, they send intents and render whatever snapshot comes back.

export interface Song {
  videoId: string;
  title: string;
  channel: string;
  /** Seconds; 0 when unknown. */
  duration: number;
  thumb: string;
}

export interface QueueItem extends Song {
  id: string;
  singer: string;
  addedBy: string;
  addedAt: number;
}

export type PlaybackStatus = "idle" | "playing" | "paused";

export interface Playback {
  status: PlaybackStatus;
  /**
   * Server epoch ms at which position 0 of the current song would have played.
   * Only meaningful while playing: position = (serverNow - anchor) / 1000.
   */
  anchor: number;
  /** Position in seconds, authoritative while paused. */
  position: number;
}

export interface Member {
  id: string;
  name: string;
  role: Role;
}

export type Role = "host" | "stage" | "remote";

export interface RoomState {
  code: string;
  version: number;
  current: QueueItem | null;
  queue: QueueItem[];
  history: QueueItem[];
  playback: Playback;
  members: Member[];
  /** Volume 0-100 applied by every stage/host screen. */
  volume: number;
}

export type ClientMsg =
  | { t: "hello"; name: string; role: Role }
  | { t: "ping"; c: number }
  | { t: "add"; song: Song; singer: string; next?: boolean }
  | { t: "remove"; id: string }
  | { t: "move"; id: string; to: number }
  | { t: "play" }
  | { t: "pause" }
  | { t: "seek"; position: number }
  | { t: "skip"; currentId: string | null }
  | { t: "restart" }
  | { t: "ended"; currentId: string }
  | { t: "unplayable"; currentId: string; code: number }
  | { t: "volume"; value: number }
  | { t: "duration"; currentId: string; seconds: number };

export type ServerMsg =
  | { t: "state"; state: RoomState; serverNow: number }
  | { t: "pong"; c: number; s: number }
  | { t: "welcome"; memberId: string }
  | { t: "toast"; text: string }
  | { t: "error"; text: string };

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export function isRoomCode(s: string): boolean {
  if (s.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of s) if (ROOM_CODE_ALPHABET.indexOf(ch) < 0) return false;
  return true;
}

export function positionAt(p: Playback, serverNow: number): number {
  if (p.status !== "playing") return p.position;
  return Math.max(0, (serverNow - p.anchor) / 1000);
}
