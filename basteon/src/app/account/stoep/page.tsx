import Link from "next/link";
import { ArrowRight, Flower2, Gamepad2, Map, Sparkles } from "lucide-react";
import styles from "@/app/games/games.module.css";

const stoepGames = [
  { href: "/games/calm/five-things", title: "Five Things", description: "Look around or use the quiet garden to notice what is here right now.", icon: Flower2, accent: "Grounding" },
  { href: "/games/calm/rake", title: "Sand Rake", description: "Rake soft lines in the sand and let the moment settle.", icon: Sparkles, accent: "Calm" },
  { href: "/games/calm/boats", title: "Worry Boats", description: "Name the worry, launch it, and let it drift away.", icon: Map, accent: "Release" },
  { href: "/games/play", title: "Play with a buddy", description: "Find a quick light round and enjoy a short two-player game.", icon: Gamepad2, accent: "Buddy" },
];

export default function StoepPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.eyebrow}>Stoep</p>
        <h1 className={styles.title}>Unwind and play.</h1>
        <p className={styles.subtitle}>
          Pick the reset that feels safest right now. Every option is gentle, quick, and private.
        </p>

        <div className={styles.grid}>
          {stoepGames.map(({ href, title, description, icon: Icon, accent }) => (
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