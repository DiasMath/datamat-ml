import type { CSSProperties } from "react";

function Bone({
  width = "100%",
  height = 14,
}: {
  width?: string;
  height?: number;
}) {
  return (
    <span
      className="skeleton-bone"
      style={{ width, height } as CSSProperties}
    />
  );
}
export default function Skeleton({
  variant = "list",
  label = "Carregando dados da operação",
}: {
  variant?: "list" | "today" | "analytics" | "detail" | "settings" | "pricing";
  label?: string;
}) {
  if (variant === "today")
    return (
      <div
        className="skeleton-layout skeleton-today today-dashboard"
        role="status"
        aria-label={label}
      >
        <span className="sr-only">{label}…</span>
        <div className="today-toolbar" aria-hidden="true">
          <Bone width="35%" height={16} />
          <Bone width="18%" height={28} />
        </div>
        <div className="today-metrics" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="today-metric" key={i}>
              <Bone width="65%" height={12} />
              <Bone width="50%" height={24} />
              <Bone width="75%" height={10} />
            </div>
          ))}
        </div>
        <div className="today-main-grid" aria-hidden="true">
          <section className="panel">
            <Bone width="40%" height={18} />
            <div className="today-focus">
              <Bone width="70%" height={32} />
            </div>
            {Array.from({ length: 5 }, (_, i) => (
              <div className="today-queue-row" key={i}>
                <Bone width="36px" height={36} />
                <div style={{ flex: 1 }}>
                  <Bone width="70%" />
                  <Bone width="50%" height={10} />
                </div>
              </div>
            ))}
          </section>
          <section className="panel today-skeleton-chart">
            <Bone width="50%" height={18} />
            <Bone height={220} />
          </section>
        </div>
      </div>
    );
  const cards = ["analytics", "settings", "detail", "pricing"].includes(
    variant,
  );
  return (
    <div
      className={`skeleton-layout skeleton-${variant}`}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true">
        {variant === "detail" && (
          <div className="skeleton-detail">
            <Bone width="25%" />
            <Bone width="65%" height={32} />
            <Bone width="45%" />
            <Bone height={42} />
          </div>
        )}
        {cards && (
          <div className="stats-grid">
            {Array.from({ length: variant === "settings" ? 2 : 4 }, (_, i) => (
              <div className="stat-card" key={i}>
                <Bone width="65%" />
                <Bone width="45%" height={30} />
                <Bone width="85%" />
              </div>
            ))}
          </div>
        )}
        <div className={cards ? "today-grid" : ""}>
          {Array.from({ length: cards ? 2 : 1 }, (_, i) => (
            <section className="panel" key={i}>
              <div className="panel-heading">
                <Bone width="42%" height={20} />
                <Bone width="18%" height={28} />
              </div>
              {variant === "analytics" ? (
                <div className="skeleton-chart">
                  {[35, 55, 45, 75, 60, 90, 65].map((h, n) => (
                    <span
                      className="skeleton-bone"
                      style={{ height: `${h}%` }}
                      key={n}
                    />
                  ))}
                </div>
              ) : (
                Array.from({ length: 6 }, (_, n) => (
                  <div className="skeleton-row" key={n}>
                    <div>
                      <Bone width={n % 2 ? "68%" : "82%"} />
                      <Bone width="45%" height={10} />
                    </div>
                    <Bone width="17%" height={22} />
                  </div>
                ))
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
