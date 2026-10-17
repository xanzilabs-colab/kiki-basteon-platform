import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import TriggerLab from "@/components/TriggerLab";
import styles from "./triggerLab.module.css";

export default async function TriggerLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const deviceRef = typeof params.deviceRef === "string" ? params.deviceRef : "";

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/account/profile/triggers"><ChevronLeft size={18} />Bluetooth triggers</Link>
      <header>
        <span className={styles.eyebrow}>Safe device check</span>
        <h1 className={styles.pageTitle}>Trigger Lab</h1>
      </header>
      <TriggerLab requestedDeviceRef={deviceRef} />
    </div>
  );
}
