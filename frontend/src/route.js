function roleFromPath() {
  const p = window.location.pathname.replace(/\/+$/, "");
  if (p === "/play") return "play";
  if (p === "/host") return "host";
  return "stage";
}

export default roleFromPath;
