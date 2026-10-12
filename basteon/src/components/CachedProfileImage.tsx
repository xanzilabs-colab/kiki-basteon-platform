"use client";

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { profileImageCacheKey } from "./profileImageCache";

type CachedAvatarRecord = { key: string; blob: Blob; cachedAt: number };

const databaseName = "kiki-profile-image-cache";
const storeName = "avatars";
const maxCachedAvatars = 50;
const memoryUrls = new Map<string, string>();
const pendingImages = new Map<string, Promise<string | null>>();
let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable"));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open the avatar cache"));
      request.onblocked = () => reject(new Error("Avatar cache upgrade is blocked"));
    });
  }
  return databasePromise;
}

async function readCachedBlob(key: string) {
  const db = await openDatabase();
  return new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as CachedAvatarRecord | undefined)?.blob ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read the avatar cache"));
  });
}

async function storeCachedBlob(key: string, blob: Blob) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    store.put({ key, blob, cachedAt: Date.now() } satisfies CachedAvatarRecord);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = (request.result as CachedAvatarRecord[])
        .sort((a, b) => b.cachedAt - a.cachedAt);
      for (const stale of records.slice(maxCachedAvatars)) store.delete(stale.key);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the avatar cache"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Avatar cache save was aborted"));
  });
}

function cachedImageUrl(src: string) {
  const key = profileImageCacheKey(src, window.location.origin);
  const existing = memoryUrls.get(key);
  if (existing) return Promise.resolve(existing);
  const pending = pendingImages.get(key);
  if (pending) return pending;

  const load = (async () => {
    const blob = await readCachedBlob(key);
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      memoryUrls.set(key, objectUrl);
      return objectUrl;
    }

    const response = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const image = await response.blob();
    if (!image.type.startsWith("image/") || !image.size) return null;
    await storeCachedBlob(key, image);
    const objectUrl = URL.createObjectURL(image);
    memoryUrls.set(key, objectUrl);
    return objectUrl;
  })();
  pendingImages.set(key, load);
  void load.then(
    () => pendingImages.delete(key),
    () => pendingImages.delete(key),
  );
  return load;
}

export function useCachedProfileImage(src: string | null | undefined) {
  const [resolved, setResolved] = useState<{ src: string | null; url: string | null }>({ src: null, url: null });

  useEffect(() => {
    if (!src) {
      setResolved({ src: null, url: null });
      return;
    }
    let active = true;
    setResolved({ src, url: src });
    void cachedImageUrl(src)
      .then((url) => {
        if (active && url) setResolved({ src, url });
      })
      .catch(() => {
        // Use the signed URL directly if this browser cannot access persistent storage.
      });
    return () => { active = false; };
  }, [src]);

  if (!src) return null;
  if (typeof window !== "undefined") {
    const memoryUrl = memoryUrls.get(profileImageCacheKey(src, window.location.origin));
    if (memoryUrl) return memoryUrl;
  }
  return resolved.src === src ? resolved.url ?? src : src;
}

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallback?: ReactNode;
};

export function CachedProfileImage({ src, alt, fallback = null, ...imageProps }: Props) {
  const cachedSrc = useCachedProfileImage(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => setFailedSrc(null), [src]);

  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    <img
      {...imageProps}
      src={cachedSrc ?? src}
      alt={alt}
      loading={imageProps.loading ?? "lazy"}
      decoding={imageProps.decoding ?? "async"}
      onError={(event) => {
        setFailedSrc(src);
        imageProps.onError?.(event);
      }}
    />
  );
}
