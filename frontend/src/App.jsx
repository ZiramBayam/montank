import { useState } from "react";
import roleFromPath from "./route.js";
import Stage from "./stage/Stage.jsx";
import Play from "./play/Play.jsx";
import Host from "./host/Host.jsx";
import Welcome from "./Welcome.jsx";
import { BusProvider } from "./state/Bus.jsx";

export default function App() {
  const [role] = useState(roleFromPath);
  const C =
    role === "play" ? Play : role === "host" ? Host : role === "welcome" ? Welcome : Stage;
  return (
    <BusProvider role={role}>
      <C />
    </BusProvider>
  );
}
