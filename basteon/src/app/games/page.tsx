"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Flower2, Gamepad2, Sailboat, Sparkles } from "lucide-react";
import { AccountShell } from "@/components/AccountShell";
import { createClient } from "@/lib/supabase/client";
import styles from "./games.module.css";

type Category = "all" | "grounding" | "calm" | "release" | "buddy";

const filters: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "grounding", label: "Grounding" },
  { id: "calm", label: "Calm" },
  { id: "release", label: "Release" },
  { id: "buddy", label: "Buddy" },
];

const games = [
  { href: "/games/calm/five-things", title: "Five Things", description: "Notice what is around you", category: "grounding" as const, icon: Flower2, action: "Start" },
  { href: "/games/calm/boats", title: "Worry Boats", description: "Name a worry and send it off", category: "release" as const, icon: Sailboat, action: "Launch" },
  { href: "/games/play", title: "Play with a Buddy", description: "A quick, light two-player game", category: "buddy" as const, icon: Gamepad2, action: "Play" },
  { href: "/games/calm", title: "Calm games", description: "Browse all your gentle solo games", category: "calm" as const, icon: Sparkles, action: "Explore" },
];

export default function GamesPage() {
  const router = useRouter();
  const [accountName, setAccountName] = useState("Account");
  const [category, setCategory] = useState<Category>("all");
  const visibleGames = category === "all" ? games : games.filter((game) => game.category === category);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("full_name,role").eq("id", user.id).single();
      if (!profile || profile.role !== "user") { router.replace(profile?.role === "admin" ? "/admin" : "/responder"); return; }
      if (active) setAccountName(profile.full_name ?? user.email ?? "Account");
    })();
    return () => { active = false; };
  }, [router]);

  return (
    <AccountShell name={accountName}>
    <div className={styles.gamesHome}>
      <div className={styles.mobileFrame}>
        <div className={styles.homeContent}>
          <section className={styles.intro}>
            <h1 className={styles.homeTitle}>Unwind &amp; Play</h1>
            <p className={styles.homeSubtitle}>Quick, gentle, and private mental resets.</p>
          </section>

          <div className={styles.filters} role="group" aria-label="Filter games">
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`${styles.filter} ${category === filter.id ? styles.filterActive : ""}`}
                aria-pressed={category === filter.id}
                onClick={() => setCategory(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className={styles.gameList} aria-live="polite">
            {visibleGames.map(({ href, title, description, category: gameCategory, icon: Icon, action }, index) => (
              <Link
                key={href}
                href={href}
                className={`${styles.gameRow} ${styles[gameCategory]}`}
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <span className={styles.gameIcon} aria-hidden="true"><Icon size={22} strokeWidth={2.1} /></span>
                <span className={styles.gameCopy}>
                  <span className={styles.gameCategory}>{gameCategory}</span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <span className={styles.cardAction}>{action}<ArrowRight size={13} /></span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
    </AccountShell>
  );
}

