"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { playAlertSound, unlockAlertSound } from "@/lib/alertSound";
import { createClient } from "@/lib/supabase/client";
import { enablePushNotifications } from "@/lib/usePushNotifications";
import type { Alert, AlertEvent, Device } from "@/lib/types";

const alertQuery = "*, assignee:profiles!alerts_assigned_to_fkey(full_name)";

function announceAlert(alert: Alert) {
	toast("NEW PANIC ALERT", { description: "A wearable device has activated an emergency alert." });
	if (localStorage.getItem("basteon-sound") !== "off") playAlertSound();
	if (document.hidden && Notification.permission === "granted") {
		new Notification("New panic alert", {
			body: `${alert.device?.device_name ?? alert.device_id} needs assistance.`,
			tag: `basteon-alert-${alert.id}`,
		});
	}

	const previousTitle = document.title;
	document.title = "ALERT - Basteon";
	window.setTimeout(() => { document.title = previousTitle; }, 5000);
}

export function useRealtimeAlerts() {
	const [alerts, setAlerts] = useState<Alert[]>([]);
	const [events, setEvents] = useState<AlertEvent[]>([]);
	const [connection, setConnection] = useState("connecting");
	const [error, setError] = useState("");
	const knownAlertIds = useRef(new Set<string>());
	const hasInitialSnapshot = useRef(false);

	useEffect(() => {
		const supabase = createClient();
		let active = true;

		const addOrUpdateAlert = (alert: Alert, notify: boolean) => {
			const isNew = !knownAlertIds.current.has(alert.id);
			knownAlertIds.current.add(alert.id);
			setAlerts((current) => [alert, ...current.filter((item) => item.id !== alert.id)]);
			if (notify && isNew) announceAlert(alert);
		};

		const syncAlerts = async () => {
			const { data, error: alertError } = await supabase.from("alerts").select(alertQuery).order("triggered_at", { ascending: false }).limit(200);
			if (!active) return;
			if (alertError) { setError(alertError.message); return; }

			const rawAlerts = (data ?? []) as Alert[];
			const deviceIds = [...new Set(rawAlerts.map((alert) => alert.device_id))];
			const { data: devices, error: deviceError } = deviceIds.length
				? await supabase.from("devices").select("device_id,device_name,user_id").in("device_id", deviceIds)
				: { data: [] as Device[], error: null };
			if (!active) return;
			if (deviceError) { setError(deviceError.message); return; }

			const ownerIds = [...new Set((devices ?? []).map((device) => device.user_id).filter((id): id is string => Boolean(id)))];
			const { data: owners, error: ownerError } = ownerIds.length
				? await supabase.from("profiles").select("id,full_name,phone").in("id", ownerIds)
				: { data: [], error: null };
			if (!active) return;
			if (ownerError) { setError(ownerError.message); return; }

			const deviceById = new Map((devices ?? []).map((device) => [device.device_id, device]));
			const ownerById = new Map((owners ?? []).map((owner) => [owner.id, owner]));
			const nextAlerts = rawAlerts.map((alert) => {
				const device = deviceById.get(alert.device_id);
				return { ...alert, device: device ? { ...device, owner: device.user_id ? ownerById.get(device.user_id) ?? null : null } : null };
			});
			setError("");
			const newAlerts = hasInitialSnapshot.current
				? nextAlerts.filter((alert) => !knownAlertIds.current.has(alert.id))
				: [];

			knownAlertIds.current = new Set(nextAlerts.map((alert) => alert.id));
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
				setAlerts((current) => current.map((alert) => alert.id === changed.id ? { ...alert, ...changed } : alert));
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
	}, []);

	const refresh = async () => {
		const supabase = createClient();
		const { data, error: alertError } = await supabase.from("alerts").select(alertQuery).order("triggered_at", { ascending: false }).limit(200);
		if (alertError) { setError(alertError.message); return; }
		setAlerts((data ?? []) as Alert[]);
	};

	return { alerts, setAlerts, events, setEvents, connection, error, refresh };
}