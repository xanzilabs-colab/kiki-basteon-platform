"use client";

import { Check, Eye, EyeOff, Layers, LocateFixed, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayerOptions";

type SheetLevel = 0 | 1 | 2;

export function MapBottomSheet({
  level,
  onLevelChange,
  children,
  label = "Map details",
  className = "",
}: {
  level: SheetLevel;
  onLevelChange: (level: SheetLevel) => void;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const startY = useRef<number | null>(null);
  const suppressClick = useRef(false);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    startY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (startY.current === null) return;
    const delta = event.clientY - startY.current;
    startY.current = null;
    if (Math.abs(delta) < 18) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 300);
    onLevelChange(delta < 0 ? Math.min(2, level + 1) as SheetLevel : Math.max(0, level - 1) as SheetLevel);
  }

  function onClickHandle() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onLevelChange(level === 2 ? 0 : (level + 1) as SheetLevel);
  }

  return <section className={`map-screen-sheet account-bottom-sheet level-${level} ${className}`.trim()} aria-label={label} data-map-ui="hide">
    <button
      className="map-screen-sheet-handle account-sheet-handle"
      type="button"
      aria-label={level === 2 ? "Collapse map details" : "Expand map details"}
      aria-expanded={level === 2}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { startY.current = null; }}
      onClick={onClickHandle}
    ><span aria-hidden="true" /></button>
    <div className="map-screen-sheet-content account-sheet-content">{children}</div>
  </section>;
}

export function MapScreen({
  screenId,
  map,
  topBar,
  controls,
  tools,
  bottomSheet,
  hiddenActions,
  onRecenter,
  selectedLayer,
  onLayerChange,
  className = "",
  attribution = "© OpenStreetMap",
}: {
  screenId: string;
  map: ReactNode;
  topBar?: ReactNode;
  controls?: ReactNode;
  tools?: ReactNode;
  bottomSheet?: ReactNode;
  hiddenActions?: ReactNode;
  onRecenter?: () => void;
  selectedLayer?: MapBaseLayerName;
  onLayerChange?: (layer: MapBaseLayerName) => void;
  className?: string;
  attribution?: string;
}) {
  const [uiHidden, setUiHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(`kiki-map-ui:${screenId}`) === "hidden";
    } catch {
      return false;
    }
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const activeAttribution = MAP_BASE_LAYERS.find((layer) => layer.name === selectedLayer)?.attribution ?? attribution;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent<boolean>("kiki-map-ui-hidden", { detail: uiHidden }));
    try {
      window.sessionStorage.setItem(`kiki-map-ui:${screenId}`, uiHidden ? "hidden" : "visible");
    } catch (error) {
      console.error("Could not save this map's display preference.", error);
    }
  }, [screenId, uiHidden]);

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent<boolean>("kiki-map-ui-hidden", { detail: false }));
  }, []);

  function toggleUi() {
    setUiHidden((current) => !current);
    setLayersOpen(false);
  }

  return <section className={`map-screen${uiHidden ? " is-ui-hidden" : ""} ${className}`.trim()} aria-label="Interactive map" data-map-screen={screenId}>
    <div className="map-screen-canvas">{map}</div>
    {topBar && <div className="map-screen-topbar" data-map-ui="hide">{topBar}</div>}
    {controls && <div className="map-screen-controls">{controls}</div>}
    {tools && <div className="map-screen-tools">{tools}</div>}
    {bottomSheet}
    <div className="map-screen-floating-actions">
      {onRecenter && <button type="button" className="map-screen-action" title="Recenter map" aria-label="Recenter map" onClick={onRecenter}><LocateFixed size={19} /></button>}
      {selectedLayer && onLayerChange && <button type="button" className="map-screen-action" title="Map layers" aria-label={`Map layers, selected ${selectedLayer}`} aria-expanded={layersOpen} onClick={() => setLayersOpen((current) => !current)}><Layers size={19} /></button>}
      <button type="button" className="map-screen-action map-screen-eye" title={uiHidden ? "Show map interface" : "Hide map interface"} aria-label={uiHidden ? "Show map interface" : "Hide map interface"} aria-pressed={uiHidden} onClick={toggleUi}>
        {uiHidden ? <Eye size={19} /> : <EyeOff size={19} />}
      </button>
    </div>
    {uiHidden && hiddenActions && <div className="map-screen-hidden-actions">{hiddenActions}</div>}
    <small className="map-screen-attribution">{activeAttribution}</small>
    {layersOpen && onLayerChange && <div className="map-layer-scrim" role="presentation" onClick={() => setLayersOpen(false)}>
      <section className="map-layer-sheet" role="dialog" aria-modal="true" aria-label="Map layers" onClick={(event) => event.stopPropagation()}>
        <div className="map-layer-sheet-heading"><strong>Map layers</strong><button type="button" aria-label="Close map layers" onClick={() => setLayersOpen(false)}><X size={18} /></button></div>
        {MAP_BASE_LAYERS.map((layer) => <button
          key={layer.name}
          type="button"
          className="map-layer-option"
          aria-pressed={selectedLayer === layer.name}
          onClick={() => { onLayerChange(layer.name); setLayersOpen(false); }}
        ><span>{layer.name}</span>{selectedLayer === layer.name && <Check size={18} aria-label="Selected" />}</button>)}
      </section>
    </div>}
  </section>;
}
