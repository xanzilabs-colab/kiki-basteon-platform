import Link from "next/link";
import styles from "../../games.module.css";

export default function WorryBoatsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <div className={styles.routeCard}>
          <p className={styles.eyebrow}>Calm game</p>
          <h1>Worry Boats</h1>
          <p>Write a worry, launch it, and let it drift away. This is the Worry Boats route scaffold for the full game flow from the prompt.</p>
          <div className={styles.list}>
            <Link href="/games/calm" className={styles.link}>Back to calm games</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
