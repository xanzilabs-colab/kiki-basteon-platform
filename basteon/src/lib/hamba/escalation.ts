export type TripEscalationChannel = "push" | "whatsapp";

export type TripEscalation = { tripId: string; ownerId: string; reason: string; liveLink?: string };

export interface TripEscalationAdapter {
  channel: TripEscalationChannel;
  deliver(escalation: TripEscalation): Promise<void>;
}

// WhatsApp delivery is intentionally not configured until a provider and credentials are supplied.
export const tripEscalationAdapters: TripEscalationAdapter[] = [];