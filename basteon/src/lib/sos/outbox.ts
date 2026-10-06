"use client";

import { createClient } from "@/lib/supabase/client";

const STORAGE_KEY = "kiki-sos-outbox-v1";

export type SosRequest = {
  request_id: string;
  lat: number;
  lng: number;
  type_code: string;
  type_source: "tap" | "hold_slide";
};

type QueuedSos = SosRequest & { owner_id: string };

function readQueue(): QueuedSos[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is QueuedSos => Boolean(item && typeof item === "object" && typeof item.owner_id === "string" && typeof item.request_id === "string")) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSos[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export async function enqueueSos(request: SosRequest) {
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) return false;
  try {
    const queue = readQueue();
    if (!queue.some((item) => item.request_id === request.request_id)) queue.push({ ...request, owner_id: user.id });
    writeQueue(queue);
    return true;
  } catch {
    return false;
  }
}

export function removeQueuedSos(requestId: string) {
  try {
    writeQueue(readQueue().filter((item) => item.request_id !== requestId));
  } catch {
    // Keep cancel responsive if local storage is unavailable.
  }
}

export async function flushSosOutbox() {
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) return [];
  const queue = readQueue();
  const owned = queue.filter((item) => item.owner_id === user.id);
  const delivered: Array<{ id: string; type: string }> = [];
  const completed = new Set<string>();

  for (const item of owned) {
    try {
      const response = await fetch("/api/account/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!response.ok) continue;
      const result = await response.json() as { id?: string; type_code?: string };
      if (result.id) delivered.push({ id: result.id, type: result.type_code ?? item.type_code });
      completed.add(item.request_id);
    } catch {
      break;
    }
  }

  if (completed.size) writeQueue(queue.filter((item) => !completed.has(item.request_id)));
  return delivered;
}