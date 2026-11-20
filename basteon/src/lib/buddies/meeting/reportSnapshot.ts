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
  const width = 1080;
  const height = 1350;
  const map = { left: 48, top: 320, width: 984, height: 560 };
  const tiles = reportMapTiles(alert.lat, alert.lng, 4, 3);
  const images = await Promise.all(tiles.map(async (tile) => ({ tile, image: await loadTile(tile.src) })));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the report image.");

  context.fillStyle = "#f1f3f5";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  roundedRect(context, 18, 18, width - 36, height - 36, 38);
  context.fill();

  context.fillStyle = "#4a2472";
  context.beginPath();
  context.arc(88, 88, 31, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.font = "700 26px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("K", 88, 97);

  context.textAlign = "left";
  context.fillStyle = "#29231f";
  context.font = "700 28px Arial, sans-serif";
  context.fillText("Anonymous neighbour", 142, 83, 570);
  context.fillStyle = "#756d66";
  context.font = "18px Arial, sans-serif";
  context.fillText(`${titleCase(alert.kind)} · ${formatAge(alert.created_at)}`, 142, 116, 570);
  context.fillStyle = "#eee8f6";
  roundedRect(context, 794, 62, 234, 44, 22);
  context.fill();
  context.fillStyle = "#4a2472";
  context.font = "600 17px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(titleCase(alert.kind), 911, 90, 210);

  context.textAlign = "left";
  context.fillStyle = "#29231f";
  context.font = "25px Arial, sans-serif";
  const detail = wrapText(context, alert.detail || "Community report", 956, 3);
  detail.forEach((line, index) => context.fillText(line, 62, 192 + index * 36));

  context.save();
  roundedRect(context, map.left, map.top, map.width, map.height, 22);
  context.clip();
  context.fillStyle = "#e5e7eb";
  context.fillRect(map.left, map.top, map.width, map.height);
  for (const { tile, image } of images) {
    context.drawImage(image, map.left + map.width / 2 + tile.left, map.top + map.height / 2 + tile.top, 256, 256);
  }
  context.restore();

  context.save();
  context.shadowColor = "rgba(35,20,48,.34)";
  context.shadowBlur = 12;
  context.shadowOffsetY = 4;
  context.fillStyle = "#4a2472";
  context.beginPath();
  context.arc(map.left + map.width / 2, map.top + map.height / 2, 20, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(map.left + map.width / 2, map.top + map.height / 2, 8, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255,255,255,.96)";
  roundedRect(context, map.left + 16, map.top + map.height - 98, map.width - 32, 82, 20);
  context.fill();
  context.fillStyle = "#29231f";
  context.font = "700 20px Arial, sans-serif";
  context.fillText((alert.location_label || "Nearby area").slice(0, 74), map.left + 38, map.top + map.height - 62, map.width - 100);
  context.fillStyle = "#756d66";
  context.font = "16px Arial, sans-serif";
  context.fillText(
    distanceLabel ? `${distanceLabel} from your location · Tap to view pin` : "Tap to view pin",
    map.left + 38,
    map.top + map.height - 34,
    map.width - 76,
  );
  context.fillStyle = "rgba(255,255,255,.9)";
  roundedRect(context, map.left + map.width - 240, map.top + 14, 224, 28, 14);
  context.fill();
  context.fillStyle = "#4b5563";
  context.font = "14px Arial, sans-serif";
  context.textAlign = "right";
  context.fillText(reportMapAttribution, map.left + map.width - 28, map.top + 34, 204);

  context.textAlign = "left";
  context.strokeStyle = "#e7e9ed";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(56, 916);
  context.lineTo(width - 56, 916);
  context.stroke();

  context.fillStyle = "#eee8f6";
  roundedRect(context, 56, 942, 466, 72, 22);
  context.fill();
  context.fillStyle = "#4a2472";
  context.font = "700 21px Arial, sans-serif";
  context.fillText(`👍  Helpful · ${alert.upvotes}`, 84, 987, 414);

  context.fillStyle = "#f0f1f4";
  roundedRect(context, 558, 942, 466, 72, 22);
  context.fill();
  context.fillStyle = "#4a2472";
  context.fillText(`💬  Comments · ${alert.comment_count ?? 0}`, 586, 987, 410);

  context.strokeStyle = "#e7e9ed";
  context.beginPath();
  context.moveTo(56, 1050);
  context.lineTo(width - 56, 1050);
  context.stroke();
  context.fillStyle = "#756d66";
  context.font = "16px Arial, sans-serif";
  context.fillText("Shared anonymously with your Kiki safety community.", 58, 1092, 900);
  context.font = "15px Arial, sans-serif";
  context.fillText("Always use your judgement and contact local emergency services if you are in immediate danger.", 58, 1128, 940);
  context.fillText("Shared from Kiki", 58, 1288);
  context.fillStyle = "#4a2472";
  context.font = "700 18px Arial, sans-serif";
  context.textAlign = "right";
  context.fillText("KIKI · SAFETY NETWORK", width - 58, 1288);

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
