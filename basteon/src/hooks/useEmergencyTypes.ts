"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BUILT_IN_EMERGENCY_TYPES, type EmergencyType } from "@/lib/sos/emergencyTypes";

let cachedTypes: EmergencyType[] | null = null;
let loadingTypes: Promise<EmergencyType[]> | null = null;

async function loadTypes() {
  if (cachedTypes) return cachedTypes;
  if (!loadingTypes) {
    loadingTypes = (async () => {
      const { data, error } = await createClient().from("emergency_types").select("code,label,short_label,icon,tone,life_threat,sort_order,active").eq("active", true).order("sort_order");
      cachedTypes = error || !data?.length ? BUILT_IN_EMERGENCY_TYPES : data as EmergencyType[];
      return cachedTypes;
    })().finally(() => { loadingTypes = null; });
  }
  return loadingTypes;
}

export function useEmergencyTypes() {
  const [types, setTypes] = useState<EmergencyType[]>(cachedTypes ?? BUILT_IN_EMERGENCY_TYPES);
  useEffect(() => { let active = true; void loadTypes().then((rows) => { if (active) setTypes(rows); }); return () => { active = false; }; }, []);
  return types;
}