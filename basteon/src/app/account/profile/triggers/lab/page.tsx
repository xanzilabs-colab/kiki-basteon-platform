import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import TriggerLab from "@/components/TriggerLab";
import styles from "./triggerLab.module.css";

export default function TriggerLabPage() {
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/account/profile/triggers"><ChevronLeft size={18} />Bluetooth triggers</Link>
      <header>
        <span className={styles.eyebrow}>Safe device check</span>
        <h1 className={styles.pageTitle}>Trigger Lab</h1>
      </header>
      <TriggerLab />
    </div>
  );
}
