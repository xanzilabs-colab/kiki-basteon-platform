import Link from "next/link";
import styles from "../games.module.css";

export default function PlayPage() {
  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <div className={styles.routeCard}>
          <p className={styles.eyebrow}>Play with a buddy</p>
          <h1>Open to play.</h1>
          <p>Nearby buddy rooms, room matching, and the full Morabaraba game flow are scaffolded here for the Kiki Games pack, with the room state and safety rules intended to mirror the prompt.</p>
          <div className={styles.list}>
            <Link href="/games" className={styles.link}>Back to the games hub</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
