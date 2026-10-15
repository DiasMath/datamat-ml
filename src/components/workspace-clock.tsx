"use client";
import { useEffect, useState } from "react";
const timeZone = "America/Sao_Paulo";
export default function WorkspaceClock() {
  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setClock(new Date());
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time
      className="workspace-clock"
      title="Horário de Brasília (UTC−3)"
      dateTime={clock?.toISOString()}
      aria-label="Data e hora de Brasília"
    >
      {clock ? (
        <>
          <span>
            {new Intl.DateTimeFormat("pt-BR", {
              weekday: "short",
              day: "numeric",
              month: "long",
              timeZone,
            }).format(clock)}
          </span>
          <small>
            {new Intl.DateTimeFormat("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone,
            }).format(clock)}
          </small>
        </>
      ) : (
        <span className="skeleton-bone" />
      )}
    </time>
  );
}
