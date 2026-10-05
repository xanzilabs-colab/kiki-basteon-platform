import Link from "next/link";
import { WorryBoatsGame } from "@/components/WorryBoatsGame";
import styles from "../../games.module.css";

export default function WorryBoatsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <WorryBoatsGame />
        <div className={styles.list}><Link href="/games/calm" className={styles.link}>Back to calm games</Link></div>
      </div>
    </main>
  );
}
