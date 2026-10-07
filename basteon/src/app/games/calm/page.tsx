import Link from "next/link";
import styles from "../games.module.css";

const calmGames = [
  { href: "/games/calm/five-things", title: "Five Things", blurb: "Grounding in the moment, with a quiet garden that responds to what you notice." },
  { href: "/games/calm/boats", title: "Worry Boats", blurb: "Write a worry, launch it, and let it drift away." },
];

export default function CalmGamesPage() {
  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <div className={styles.backBar}>
          <Link href="/games" className={styles.backLink}>← Back</Link>
        </div>
        <div className={styles.routeCard}>
          <p className={styles.eyebrow}>Calm games</p>
          <h1>Choose a small reset.</h1>
          <div className={styles.list}>
            {calmGames.map((game) => (
              <Link key={game.href} href={game.href} className={styles.link}>{game.title}</Link>
            ))}
          </div>
          <p className={styles.muted}>Each one is designed to be quick, quiet, and never stored.</p>
        </div>
      </div>
    </main>
  );
}


