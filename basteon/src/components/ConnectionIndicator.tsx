export function ConnectionIndicator({ state }: { state: string }) {
  const live = state === "live";
  return (
    <span className="data text-[11px] flex items-center gap-2 uppercase tracking-wider">
      <i className={`w-1.5 h-1.5 rounded-full ${live ? "bg-[var(--ok)]" : "bg-[var(--warn)] pulse"}`} />
      <span className={live ? "text-[var(--ok)]" : "text-[var(--warn)]"}>{live ? "Live" : state === "reconnecting" ? "Reconnecting" : "Connecting"}</span>
    </span>
  );
}