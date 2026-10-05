import Link from "next/link";
import styles from "../../games.module.css";

export default function SandRakePage() {
  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <div className={styles.routeCard}>
          <p className={styles.eyebrow}>Calm game</p>
          <h1>Sand Rake</h1>
          <p>Soft raking, warm sand, and a quick reset. This is a placeholder for the full canvas-based rake game from the Kiki Pack 1 prompt.</p>
          <div className={styles.list}>
            <Link href="/games/calm" className={styles.link}>Back to calm games</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
