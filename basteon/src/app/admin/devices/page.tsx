"use client"; import { useEffect, useState } from "react"; import type { Device } from "@/lib/types"; import { createClient } from "@/lib/supabase/client"; import { DeviceTable } from "@/components/DeviceTable"; import { RegisterDeviceDialog } from "@/components/RegisterDeviceDialog";
export default function DevicesPage() { const [devices, setDevices] = useState<Device[]>([]); const refresh = async () => { const { data } = await createClient().from("devices").select("*, owner:profiles(full_name)").order("created_at", { ascending: false }); setDevices((data ?? []) as Device[]); }; useEffect(() => { void refresh(); }, []); return (
  <div className="space-y-4">
    <div className="flex items-end justify-between">
      <div><p className="eyebrow">Fleet</p><h1 className="page-title mt-1">Devices</h1></div>
      <RegisterDeviceDialog refresh={refresh} />
    </div>
    <DeviceTable devices={devices} refresh={refresh} />
  </div>
); }