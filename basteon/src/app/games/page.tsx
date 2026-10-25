import GamesClient from "./GamesClient";
import { getAccountMenuFeatures } from "@/lib/account/menuFeatures";

export default function GamesPage() {
  return <GamesClient {...getAccountMenuFeatures()} />;
}
