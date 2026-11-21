import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../../../../supabase/migrations/20261117000000_gauteng_demo_data_support.sql", import.meta.url)),
  "utf8",
);
const seed = readFileSync(
  fileURLToPath(new URL("../../../../../scripts/demo-gauteng-seed.sql", import.meta.url)),
  "utf8",
);
const rollback = readFileSync(
  fileURLToPath(new URL("../../../../../scripts/demo-gauteng-rollback.sql", import.meta.url)),
  "utf8",
);

describe("Gauteng demo data", () => {
  it("returns explicit demo metadata while keeping demo spots out of reviewed meeting candidates", () => {
    expect(migration).toContain("add column if not exists is_demo boolean not null default false");
    expect(migration).toContain("s.is_demo and s.review_status = 'pending'");
    expect(migration).toContain("not a.is_demo");
    expect(migration).toContain("a.is_demo");
    expect(migration).toContain("grant execute on function public.list_safe_places_near");
    expect(migration).toContain("grant execute on function public.list_community_alerts_near");
    expect(migration).toContain("and resolved_at is null and not is_demo");
    expect(migration).toContain("where id = p_id and not is_demo");
  });

  it("seeds exactly 40 pending, unverified spots and 50 explicitly fictional reports", () => {
    expect(seed).toContain("generate_series(1, 40)");
    expect(seed).toContain("generate_series(1, 50)");
    expect(seed).toContain("(21, 'Fourways'");
    expect(seed).toContain("(34, 'Hatfield'");
    expect(seed).toContain("(40, 'Heidelberg'");
    expect(seed).toContain("'pending',");
    expect(seed).toContain("'Fictional placeholder for a judge demo. Not a real venue or a verified safe spot.'");
    expect(seed).toContain("'DEMO DATA - Fictional sample only; no real incident reported.'");
    expect(seed).toContain("did not create exactly 40 safe-spot samples");
    expect(seed).toContain("did not create exactly 50 community-report samples");
    expect(seed).not.toContain("insert into public.community_intel_records");
  });

  it("keeps all 40 area centers within Gauteng coordinate bounds", () => {
    const coordinates = [...seed.matchAll(/\(\d+, '[^']+', (-?\d+\.\d+)(?:::\s*double precision)?,\s*(\d+\.\d+)(?:::\s*double precision)?\)/g)];
    expect(coordinates).toHaveLength(80);
    for (const [, lat, lng] of coordinates) {
      expect(Number(lat)).toBeGreaterThan(-27);
      expect(Number(lat)).toBeLessThan(-25);
      expect(Number(lng)).toBeGreaterThan(27);
      expect(Number(lng)).toBeLessThan(29);
    }
  });

  it("limits rollback deletes to the seed ID ranges and explicit demo markers", () => {
    expect(rollback).toContain("where is_demo");
    expect(rollback).toContain("left(location_label, 11) = 'DEMO ONLY -'");
    expect(rollback).toContain("left(name, 11) = '[DEMO ONLY]'");
    expect(rollback).toContain("'00000000-0000-4000-8000-000000000040'::uuid");
    expect(rollback).toContain("'00000000-0000-4000-8000-000000000150'::uuid");
    expect(rollback).toContain("s.is_demo");
  });
});
