import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.KIKI_APP_URL?.trim();
if (!appUrl) {
  throw new Error("Set KIKI_APP_URL to the deployed Kiki HTTPS URL before running Capacitor commands.");
}

const parsedUrl = new URL(appUrl);
if (!["https:", "http:"].includes(parsedUrl.protocol)) {
  throw new Error("KIKI_APP_URL must use HTTPS (HTTP is for local debug builds only).");
}

const config: CapacitorConfig = {
  appId: "za.co.xanzi.kiki",
  appName: "Kiki",
  webDir: "capacitor-shell",
  android: { adjustMarginsForEdgeToEdge: "auto" },
  server: { url: parsedUrl.origin, errorPath: "offline.html" },
};

export default config;
