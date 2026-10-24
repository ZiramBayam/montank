import { createContext, useContext } from "react";

// Room context hanya berisi ctx + hook, dibagiBus & layar
export const RoomCtx = createContext(null);

export const useBus = () => useContext(RoomCtx);
