import Sprite from "./Sprite.jsx";
import "./Avatar.css";

function hashNick(nick) {
  let h = 5381;
  for (const ch of nick.toLowerCase()) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h >>> 0;
}

export default function Avatar({ nick, size = 22, idx = 0 }) {
  const key = `mascotV${hashNick(nick) % 8}`;
  return (
    <span className="avatar" aria-hidden="true">
      <Sprite name={key} size={size} />
      <span className="mkover flick" style={{ animationDelay: `${(idx * 0.37) % 2.9}s` }}>
        <Sprite name={`${key}B`} size={size} />
      </span>
      <span className="mkover bff" style={{ animationDelay: `${(idx * 0.53) % 2.8}s` }}>
        <Sprite name={`${key}C`} size={size} />
      </span>
    </span>
  );
}
