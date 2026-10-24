// Konstanta fase demo (PRD bagian 2) — dipisah dari Bus.jsx untuk fast refresh
export const PHASE = {
  LOBBY: "LOBBY_OPEN",
  RAW: "ROUND_1_RAW",
  SHIELD: "ROUND_2_SHIELD",
  OVER: "GAME_OVER",
};

export const ROUND_MS = { [PHASE.RAW]: 45_000, [PHASE.SHIELD]: 45_000 };
