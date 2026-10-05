import { useSyncExternalStore } from "react";
let dek: CryptoKey | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export function setSessionKey(key: CryptoKey) { dek = key; emit(); }
export function getSessionKey(): CryptoKey | null { return dek; }
export function lockSession() { dek = null; emit(); }
export function subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function useIsUnlocked(): boolean { return useSyncExternalStore(subscribe, () => dek !== null, () => false); }