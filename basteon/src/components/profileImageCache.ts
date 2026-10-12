export function profileImageCacheKey(src: string, baseUrl = "https://kiki.local") {
  const url = new URL(src, baseUrl);
  url.searchParams.delete("token");
  url.hash = "";
  return url.toString();
}
