"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { playAlertSound, unlockAlertSound } from "@/lib/alertSound";
import { createClient } from "@/lib/supabase/client";
import { enablePushNotifications } from "@/lib/usePushNotifications";
import type { Alert, AlertEvent, Device } from "@/lib/types";

const alertQuery = "*, assignee:profiles!alerts_assigned_to_fkey(full_name)";
type RealtimeAlertOptions = { scopeOrganisationIds?: string[] };

function announceAlert(alert: Alert) {
	const medical = alert.type_code === "medical";
	const title = medical ? "Medical alert" : "General alert";
	toast(title.toUpperCase(), { description: `${alert.device?.device_name ?? alert.device_id} needs assistance.` });
	if (localStorage.getItem("basteon-sound") !== "off") playAlertSound();
	if (document.hidden && Notification.permission === "granted") {
		new Notification(title, {
			body: `${alert.device?.device_name ?? alert.device_id} needs assistance.`,
			tag: `basteon-alert-${alert.id}`,
		});
	}

	const previousTitle = document.title;
	document.title = "ALERT - Basteon";
	window.setTimeout(() => { document.title = previousTitle; }, 5000);
}

export function useRealtimeAlerts(options?: RealtimeAlertOptions) {
	const [alerts, setAlerts] = useState<Alert[]>([]);
	const [events, setEvents] = useState<AlertEvent[]>([]);
	const [connection, setConnection] = useState("connecting");
	const [error, setError] = useState("");
	const knownAlertIds = useRef(new Set<string>());
	const knownAlerts = useRef(new Map<string, Alert>());
	const hasInitialSnapshot = useRef(false);

	useEffect(() => {
		const supabase = createClient();
		let active = true;
		const scopedIds = options?.scopeOrganisationIds ?? null;
		const hasScope = Array.isArray(scopedIds);
		const allowed = new Set(scopedIds ?? []);
		const canAccessAlert = (alert: Alert) => {
			if (!hasScope) return true;
			return Boolean(alert.primary_organisation_id && allowed.has(alert.primary_organisation_id));
		};

		const addOrUpdateAlert = (alert: Alert, notify: boolean) => {
			if (!canAccessAlert(alert)) {
				knownAlertIds.current.delete(alert.id);
				knownAlerts.current.delete(alert.id);
				setAlerts((current) => current.filter((item) => item.id !== alert.id));
				return;
			}
			const isNew = !knownAlertIds.current.has(alert.id);
			knownAlertIds.current.add(alert.id);
			knownAlerts.current.set(alert.id, alert);
			setAlerts((current) => [alert, ...current.filter((item) => item.id !== alert.id)]);
			if (notify && isNew) announceAlert(alert);
		};

		const announceTypeChange = (alert: Alert) => {
			const label = alert.type_code === "medical" ? "Medical" : "General";
			toast(`Alert updated to ${label}`, { description: `${alert.device?.device_name ?? alert.device_id} incident type changed.` });
			if (localStorage.getItem("basteon-sound") !== "off") playAlertSound();
			if (document.hidden && Notification.permission === "granted") new Notification(`Alert updated to ${label}`, { body: `${alert.device?.device_name ?? alert.device_id} incident type changed.`, tag: `basteon-alert-type-${alert.id}` });
		};

		const syncAlerts = async () => {
			const { data, error: alertError } = await supabase.from("alerts").select(alertQuery).order("triggered_at", { ascending: false }).limit(200);
			if (!active) return;
			if (alertError) { setError(alertError.message); return; }

			const rawAlerts = (data ?? []) as Alert[];
			const scopedAlerts = rawAlerts.filter(canAccessAlert);
			const deviceIds = [...new Set(scopedAlerts.map((alert) => alert.device_id))];
			const { data: devices, error: deviceError } = deviceIds.length
				? await supabase.from("devices").select("device_id,device_name,user_id").in("device_id", deviceIds)
				: { data: [] as Device[], error: null };
			if (!active) return;
			if (deviceError) { setError(deviceError.message); return; }

			const ownerIds = [...new Set((devices ?? []).map((device) => device.user_id).filter((id): id is string => Boolean(id)))];
			const { data: owners, error: ownerError } = ownerIds.length
				? await supabase.from("profiles").select("id,full_name,phone,home_address,emergency_contact_name,emergency_contact_phone,avatar_path").in("id", ownerIds)
				: { data: [], error: null };
			if (!active) return;
			if (ownerError) { setError(ownerError.message); return; }

			const deviceById = new Map((devices ?? []).map((device) => [device.device_id, device]));
			const ownersWithAvatars = await Promise.all((owners ?? []).map(async (owner) => {
				if (!owner.avatar_path) return owner;
				const { data } = await supabase.storage.from("kiki-profile-images").createSignedUrl(owner.avatar_path, 3_600);
				return { ...owner, avatar_url: data?.signedUrl ?? null };
			}));
			const ownerById = new Map(ownersWithAvatars.map((owner) => [owner.id, owner]));
			const nextAlerts = scopedAlerts.map((alert) => {
				const device = deviceById.get(alert.device_id);
				return { ...alert, device: device ? { ...device, owner: device.user_id ? ownerById.get(device.user_id) ?? null : null } : null };
			});
			setError("");
			const newAlerts = hasInitialSnapshot.current
				? nextAlerts.filter((alert) => !knownAlertIds.current.has(alert.id))
				: [];

			knownAlertIds.current = new Set(nextAlerts.map((alert) => alert.id));
			knownAlerts.current = new Map(nextAlerts.map((alert) => [alert.id, alert]));
			hasInitialSnapshot.current = true;
			setAlerts(nextAlerts);
			newAlerts.forEach(announceAlert);
		};

		const unlock = () => {
			if (localStorage.getItem("basteon-sound") !== "off") void unlockAlertSound();
			void enablePushNotifications();
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
		};

		window.addEventListener("pointerdown", unlock);
		window.addEventListener("keydown", unlock);
		void syncAlerts();

		const channel = supabase
			.channel("ops-alerts")
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, async (payload) => {
				const changed = payload.new as Alert;
				addOrUpdateAlert(changed, true);
				void syncAlerts();
			})
			.on("postgres_changes", { event: "UPDATE", schema: "public", table: "alerts" }, (payload) => {
				const changed = payload.new as Partial<Alert>;
				if (!changed.id) return;
				const previous = knownAlerts.current.get(changed.id);
				const updated = { ...previous, ...changed } as Alert;
				if (!canAccessAlert(updated)) {
					knownAlerts.current.delete(changed.id);
					knownAlertIds.current.delete(changed.id);
					setAlerts((current) => current.filter((alert) => alert.id !== changed.id));
					return;
				}
				const typeChanged = previous && changed.type_source === "upgrade" && changed.type_code !== previous.type_code;
				knownAlerts.current.set(changed.id, updated);
				if (typeChanged) announceTypeChange(updated);
				setAlerts((current) => current.map((alert) => alert.id === changed.id ? updated : alert));
			})
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "alert_events" }, (payload) => {
				setEvents((current) => [...current, payload.new as AlertEvent]);
			})
			.subscribe((status) => {
				setConnection(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" ? "reconnecting" : "connecting");
				if (status === "SUBSCRIBED") void syncAlerts();
			});

		const syncTimer = window.setInterval(() => void syncAlerts(), 2000);

		return () => {
			active = false;
			window.clearInterval(syncTimer);
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
			void supabase.removeChannel(channel);
		};
	}, [options?.scopeOrganisationIds]);

	const refresh = async () => {
		const supabase = createClient();
		const { data, error: alertError } = await supabase.from("alerts").select(alertQuery).order("triggered_at", { ascending: false }).limit(200);
		if (alertError) { setError(alertError.message); return; }
		const scopedIds = options?.scopeOrganisationIds ?? null;
		const hasScope = Array.isArray(scopedIds);
		const allowed = new Set(scopedIds ?? []);
		const next = ((data ?? []) as Alert[]).filter((alert) => !hasScope || Boolean(alert.primary_organisation_id && allowed.has(alert.primary_organisation_id)));
		setAlerts(next);
	};

	return { alerts, setAlerts, events, setEvents, connection, error, refresh };
}