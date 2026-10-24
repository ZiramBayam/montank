// Room code is issued and validated by the backend. The client only parses it
// from invitation URLs before passing it to the WebSocket connection.
const ROOM_RE = /^PF-[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{4}$/;

export const isRoomCode = (c) => typeof c === "string" && ROOM_RE.test(c);

export function roomFromUrl() {
  const r = new URLSearchParams(window.location.search).get("room") || "";
  return isRoomCode(r) ? r : "";
}
