import Link from "next/link";
import styles from "../../games.module.css";

export default function RoomPage() {
  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <div className={styles.routeCard}>
          <p className={styles.eyebrow}>Morabaraba room</p>
          <h1>Room ready.</h1>
          <p>This is the room shell for the buddy game flow. The full board logic, move validation, question puddles, and live room state are the next implementation layer beyond the current Stoep grounding flow.</p>
          <div className={styles.list}>
            <Link href="/games/play" className={styles.link}>Back to open games</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
