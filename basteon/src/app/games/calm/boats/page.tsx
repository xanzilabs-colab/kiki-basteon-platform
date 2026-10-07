import Link from "next/link";
import { WorryBoatsGame } from "@/components/WorryBoatsGame";
import styles from "../../games.module.css";

export default function WorryBoatsPage() {
  return (
    <main className={`${styles.page} ${styles.boatsPage}`}>
      <div className={`${styles.routePage} ${styles.boatsRoutePage}`}>
        <div className={`${styles.backBar} ${styles.boatsBackBar}`}>
          <Link href="/games/calm" className={styles.backLink}>← Back</Link>
        </div>
        <WorryBoatsGame fullScreen />
      </div>
    </main>
  );
}
