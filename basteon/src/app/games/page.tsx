import Link from "next/link";
import { ArrowRight, Flower2, Gamepad2, Map, Sparkles } from "lucide-react";
import styles from "./games.module.css";

const games = [
  { href: "/games/calm/five-things", title: "Five Things", description: "Ground yourself by noticing what is real, safe, and present.", icon: Flower2, accent: "Stoep" },
  { href: "/games/calm", title: "Calm games", description: "Short, gentle solo games designed to help you settle back into the moment.", icon: Sparkles, accent: "Solo" },
  { href: "/games/play", title: "Play with a buddy", description: "Find an open nearby player and enjoy a light two-player round.", icon: Map, accent: "Buddy" },
];

export default function GamesPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.backBar}>
          <Link href="/account" className={styles.backLink}>← Back</Link>
        </div>
        <p className={styles.eyebrow}>Stoep</p>
        <h1 className={styles.title}>Unwind and play.</h1>
        <p className={styles.subtitle}>
          Choose a quiet reset, a gentle distraction, or a quick bridge with a buddy.
        </p>

        <div className={styles.grid}>
          {games.map(({ href, title, description, icon: Icon, accent }) => (
            <Link key={title} href={href} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.badge}><Icon size={18} /></span>
                <span className={styles.muted}>{accent}</span>
              </div>
              <h2>{title}</h2>
              <p>{description}</p>
              <small>Open <ArrowRight size={14} style={{ display: "inline-block", verticalAlign: "middle" }} /></small>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
