// Impor mentah semua sprite; nama file -> markup svg
const FILES = import.meta.glob("../assets/sprites/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const SPRITES = {};
for (const [path, markup] of Object.entries(FILES)) {
  const vb = markup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  SPRITES[path.split("/").pop().replace(".svg", "")] = {
    markup,
    ar: vb ? +vb[2] / +vb[1] : 1, // rasio aspek tinggi/lebar
  };
}

export default function Sprite({ name, size = 24, className = "" }) {
  const sp = SPRITES[name];
  if (!sp) return null;
  return (
    <span
      className={`sprite ${className}`}
      aria-hidden="true"
      style={{ width: size, height: Math.round(size * sp.ar), display: "inline-block" }}
      dangerouslySetInnerHTML={{ __html: sp.markup }}
    />
  );
}
