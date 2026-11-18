function toHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export async function extractLogoColorSuggestions(imageUrl: string): Promise<string[]> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not load the logo for colour suggestions."));
    image.src = imageUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Colour suggestions are unavailable in this browser.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map<number, { red: number; green: number; blue: number; count: number }>();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, count: 0 };
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const suggestions = [...buckets.values()]
    .sort((first, second) => second.count - first.count)
    .map((bucket) => toHex(bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count))
    .filter((color, index, colors) => colors.indexOf(color) === index)
    .slice(0, 5);
  if (!suggestions.length) throw new Error("No visible colours could be sampled from this logo.");
  return suggestions;
}
