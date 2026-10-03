export function StatsCards({ values }: { values: { label: string; value: string | number }[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 border border-[var(--line)] bg-[var(--surface)] divide-x divide-[var(--line)]">
      {values.map((v) => (
        <div key={v.label} className="p-4">
          <p className="label">{v.label}</p>
          <p className="data text-2xl font-medium mt-2">{v.value}</p>
        </div>
      ))}
    </div>
  );
}