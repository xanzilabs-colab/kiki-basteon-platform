export function StatsCards({
  values,
}: {
  values: { label: string; value: string | number }[];
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 panel overflow-hidden">
      {values.map((v, i) => (
        <div
          key={v.label}
          className="p-5"
          style={{
            borderLeft: i === 0 ? "0" : "1px solid var(--line)",
          }}
        >
          <p className="label">{v.label}</p>
          <p className="data text-[26px] font-medium mt-2 leading-none tracking-[-.01em]">
            {v.value}
          </p>
        </div>
      ))}
    </div>
  );
}