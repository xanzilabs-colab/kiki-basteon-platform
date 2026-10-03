import type { TripMode } from "./types";

export type DestinationSuggestion = { label: string; lat: number; lng: number };
export type PlannedRouteData = { points: Array<{ lat: number; lng: number }>; distanceM: number; durationS: number };

export interface GeocodingProvider {
  search(query: string): Promise<DestinationSuggestion[]>;
}

export interface RoutingProvider {
  plan(origin: DestinationSuggestion, destination: DestinationSuggestion, mode: TripMode): Promise<PlannedRouteData[]>;
}

export interface MapTileProvider {
  tileUrl: string;
  attribution: string;
}

// Google provider implementations belong behind these contracts once an API key and billing project are supplied.
export type GoogleMapsProviderConfig = { apiKey: string };