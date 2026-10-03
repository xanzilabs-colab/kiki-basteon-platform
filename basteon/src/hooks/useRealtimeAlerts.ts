"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { playAlertSound, unlockAlertSound } from "@/lib/alertSound";
import { createClient } from "@/lib/supabase/client";
import { enablePushNotifications } from "@/lib/usePushNotifications";
import type { Alert, AlertEvent } from "@/lib/types";

const query = "*, device:devices(device_name,user_id,owner:profiles(full_name,phone)), assignee:profiles!alerts_assigned_to_fkey(full_name)";

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
			const { data } = await supabase.from("alerts").select(query).order("triggered_at", { ascending: false }).limit(200);
			if (!active || !data) return;

			const nextAlerts = data as Alert[];
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
				const { data } = await supabase.from("alerts").select(query).eq("id", changed.id).single();
				if (active && data) addOrUpdateAlert(data as Alert, false);
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
		const { data } = await createClient().from("alerts").select(query).order("triggered_at", { ascending: false }).limit(200);
		setAlerts((data ?? []) as Alert[]);
	};

	return { alerts, setAlerts, events, setEvents, connection, refresh };
}