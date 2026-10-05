import Link from "next/link";
import { SandRakeGame } from "@/components/SandRakeGame";
import styles from "../../games.module.css";

export default function SandRakePage() {
  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <SandRakeGame />
        <div className={styles.list}><Link href="/games/calm" className={styles.link}>Back to calm games</Link></div>
      </div>
    </main>
  );
}
