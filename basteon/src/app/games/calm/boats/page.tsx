import { WorryBoatsGame } from "@/components/WorryBoatsGame";
import styles from "../../games.module.css";

export default function WorryBoatsPage() {
  return (
    <main className={`${styles.page} ${styles.boatsPage}`}>
      <div className={styles.boatsRoutePage}>
        <WorryBoatsGame fullScreen />
      </div>
    </main>
  );
}
