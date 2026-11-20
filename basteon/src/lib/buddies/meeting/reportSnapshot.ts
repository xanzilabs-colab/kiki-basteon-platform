import { reportMapAttribution, reportMapTiles } from "./reportMap";
import type { CommunityAlert } from "./client";

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function loadTile(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A report map tile could not be loaded."));
    image.src = url;
  });
}

export async function createCommunityAlertSnapshot(alert: CommunityAlert, distanceLabel: string | null) {
  const width = 900;
  const height = 574;
  const map = { left: 30, top: 185, width: 840, height: 224 };
  const tiles = reportMapTiles(alert.lat, alert.lng, 5, 2);
  const images = await Promise.all(tiles.map(async (tile) => ({ tile, image: await loadTile(tile.src) })));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the report image.");

  context.fillStyle = "#f3f4f6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff";
  roundedRect(context, 16, 16, width - 32, height - 32, 24);
  context.fill();

  context.fillStyle = "#4a2472";
  context.beginPath();
  context.arc(67, 68, 23, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.font = "700 20px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("K", 67, 75);

  context.textAlign = "left";
  context.fillStyle = "#29231f";
  context.font = "700 23px Arial, sans-serif";
  context.fillText("Anonymous neighbour", 104, 63);
  context.fillStyle = "#756d66";
  context.font = "16px Arial, sans-serif";
  context.fillText(`${titleCase(alert.kind)} · ${formatAge(alert.created_at)}`, 104, 91);
  context.fillStyle = "#eee8f6";
  roundedRect(context, 680, 48, 180, 34, 17);
  context.fill();
  context.fillStyle = "#4a2472";
  context.font = "600 15px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(titleCase(alert.kind), 770, 70);

  context.textAlign = "left";
  context.fillStyle = "#29231f";
  context.font = "17px Arial, sans-serif";
  const detail = wrapText(context, alert.detail || "Community report", 810, 3);
  detail.forEach((line, index) => context.fillText(line, 40, 135 + index * 24));

  context.save();
  roundedRect(context, map.left, map.top, map.width, map.height, 18);
  context.clip();
  context.fillStyle = "#e5e7eb";
  context.fillRect(map.left, map.top, map.width, map.height);
  for (const { tile, image } of images) {
    context.drawImage(image, map.left + map.width / 2 + tile.left, map.top + map.height / 2 + tile.top, 256, 256);
  }
  context.restore();

  context.fillStyle = "#4a2472";
  context.beginPath();
  context.arc(map.left + map.width / 2, map.top + map.height / 2, 14, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(map.left + map.width / 2, map.top + map.height / 2, 5, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255,255,255,.96)";
  roundedRect(context, map.left + 12, map.top + map.height - 70, map.width - 24, 56, 14);
  context.fill();
  context.fillStyle = "#29231f";
  context.font = "700 16px Arial, sans-serif";
  context.fillText((alert.location_label || "Nearby area").slice(0, 74), map.left + 25, map.top + map.height - 45);
  context.fillStyle = "#756d66";
  context.font = "13px Arial, sans-serif";
  context.fillText(
    distanceLabel ? `${distanceLabel} from your location · Tap to view pin` : "Tap to view pin",
    map.left + 25,
    map.top + map.height - 25,
  );
  context.fillStyle = "rgba(255,255,255,.9)";
  roundedRect(context, map.left + map.width - 178, map.top + 10, 166, 20, 10);
  context.fill();
  context.fillStyle = "#4b5563";
  context.font = "11px Arial, sans-serif";
  context.textAlign = "right";
  context.fillText(reportMapAttribution, map.left + map.width - 20, map.top + 24, 150);

  context.textAlign = "left";
  context.fillStyle = "#4a2472";
  context.font = "600 16px Arial, sans-serif";
  context.fillText(`👍  Helpful · ${alert.upvotes}`, 42, 454);
  context.fillText(`💬  Comments · ${alert.comment_count ?? 0}`, 280, 454);
  context.fillStyle = "#756d66";
  context.font = "13px Arial, sans-serif";
  context.fillText("Shared from Kiki", 42, 510);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not export the report image.");
  return new File([blob], `kiki-community-report-${alert.id}.png`, { type: "image/png" });
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAge(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
