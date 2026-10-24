// Kode room untuk demo lintas tab (tanpa backend). PRD mode real memakai WS —
// di sini kita hanya menuliskan aturan & storage lokal yang dipakai Welcome + Bus.
const ROOM_RE = /^PF-[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{4}$/;
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa I, O, 0, 1 biar aman diketik
const LIST_KEY = "pf_rooms";

export const isRoomCode = (c) => typeof c === "string" && ROOM_RE.test(c);

export function roomFromUrl() {
  const r = new URLSearchParams(window.location.search).get("room") || "";
  return isRoomCode(r) ? r : "";
}

export const listRooms = () => {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) || "{}");
  } catch {
    return {};
  }
};

export function rememberRoom(code) {
  const rooms = listRooms();
  rooms[code] = Date.now();
  localStorage.setItem(LIST_KEY, JSON.stringify(rooms));
}

export function generateRoomCode() {
  const rooms = listRooms();
  let code = "PF-";
  while (code === "PF-" || code in rooms) {
    code = `PF-${Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("")}`;
  }
  rememberRoom(code);
  return code;
}

/* Penanda tab, dipakai pemilihan engine tab lintas-tab */
export const newTabToken = () => Math.random().toString(36).slice(2);
