function roleFromPath() {
  const p = window.location.pathname.replace(/\/+$/, "");
  if (p === "/play") return "play";
  if (p === "/host") return "host";
  if (p === "/stage") return "stage";
  if (p === "/leaderboard") return "leaderboard";
  if (p === "" || p === "/") return "welcome";
  return "stage";
}

export default roleFromPath;
