import { useEffect, useState } from "react";
import { localDay, useNimaStore } from "./store";

export function useDay() {
  const timezone = useNimaStore((state) => state.timezone);
  const [now, setNow] = useState(() => new Date());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refresh the local date at midnight and after a suspended browser regains focus
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return localDay(now, timezone);
}
