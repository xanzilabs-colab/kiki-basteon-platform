"use client";

import {
  Check,
  Droplet,
  HeartPulse,
  Info,
  Leaf,
  LockKeyhole,
  Pill,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useAppDialog } from "@/components/AppDialogProvider";
import { requestAccountPin } from "@/lib/account/pinPrompt";
import styles from "./medical.module.css";

type Medical = {
  blood_type: string;
  allergies: string[];
  conditions: string[];
  medications: string[];
  notes: string;
};

type ListKey = "allergies" | "conditions" | "medications";

const bloodTypes = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const suggestions: Record<ListKey, string[]> = {
  allergies: ["Penicillin", "Peanuts", "Shellfish", "Latex", "Bee stings", "Eggs", "Aspirin"],
  conditions: ["Asthma", "Diabetes (Type 1)", "Diabetes (Type 2)", "Epilepsy", "High blood pressure", "Heart condition", "Sickle cell"],
  medications: ["Insulin", "Inhaler", "Antihistamine", "Blood thinner", "EpiPen", "Beta blocker"],
};
const emptyMedical: Medical = { blood_type: "", allergies: [], conditions: [], medications: [], notes: "" };

function toList(value: string | null | undefined) {
  return value?.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function preview(values: string[]) {
  return values.length ? values.join(" · ") : "Nothing listed";
}

export default function MedicalPage() {
  const { prompt } = useAppDialog();
  const [medical, setMedical] = useState<Medical>(emptyMedical);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(emptyMedical));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(medical) !== savedSnapshot;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/account/profile/medical", { cache: "no-store" });
        const result = await response.json() as {
          medical?: { blood_type?: string | null; allergies?: string | null; conditions?: string | null; medications?: string | null; notes?: string | null };
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Medical information could not be loaded.");
        const next: Medical = {
          blood_type: result.medical?.blood_type ?? "",
          allergies: toList(result.medical?.allergies),
          conditions: toList(result.medical?.conditions),
          medications: toList(result.medical?.medications),
          notes: result.medical?.notes ?? "",
        };
        if (active) {
          setMedical(next);
          setSavedSnapshot(JSON.stringify(next));
        }
      } catch (cause) {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Medical information could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function addItem(key: ListKey, rawValue: string, input: HTMLInputElement) {
    const value = rawValue.trim().replace(/\s+/g, " ");
    if (!value || value.length > 40) return;
    setMedical((current) => current[key].some((item) => item.toLowerCase() === value.toLowerCase())
      ? current
      : { ...current, [key]: [...current[key], value] });
    input.value = "";
    setError("");
    setMessage("");
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLInputElement>, key: ListKey) {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    addItem(key, event.currentTarget.value, event.currentTarget);
  }

  function removeItem(key: ListKey, index: number) {
    setMedical((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
    setError("");
    setMessage("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const pin = await requestAccountPin(prompt, "save your medical information");
      if (pin === null) return;
      const response = await fetch("/api/account/profile/medical", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...medical,
          allergies: medical.allergies.join("\n"),
          conditions: medical.conditions.join("\n"),
          medications: medical.medications.join("\n"),
          pin,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Medical information could not be saved.");
      setSavedSnapshot(JSON.stringify(medical));
      setMessage("Medical ID saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Medical information could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const completedFields = [
    Boolean(medical.blood_type),
    medical.allergies.length > 0,
    medical.conditions.length > 0,
    medical.medications.length > 0,
    Boolean(medical.notes.trim()),
  ].filter(Boolean).length;
  const completion = Math.round(completedFields / 5 * 100);
  const progressStyle = { "--medical-progress": `${completion}%` } as CSSProperties;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>MY SAFETY</span>
        <h1>Medical ID</h1>
        <p>What responders need to know if you can’t tell them yourself. Keep it short and current.</p>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading ? (
        <div className={styles.loading} role="status">Loading your Medical ID…</div>
      ) : loadError ? (
        <p className={styles.error} role="alert">{loadError}</p>
      ) : (
        <>
          <section className={styles.previewCard} aria-label="Medical ID preview">
            <div className={styles.previewHeading}>
              <span className={styles.previewIcon}><HeartPulse size={21} /></span>
              <span><strong>Emergency details</strong><small>Preview updates as you edit</small></span>
              <span className={styles.progressRing} style={progressStyle} aria-label={`${completion}% complete`}><span>{completion}%</span></span>
            </div>
            <div className={styles.previewGrid}>
              <div><small>Blood type</small><strong className={medical.blood_type ? styles.bloodPreview : styles.emptyValue}>{medical.blood_type || "—"}</strong></div>
              <div><small>Allergies</small><strong className={medical.allergies.length ? "" : styles.emptyValue}>{preview(medical.allergies)}</strong></div>
              <div className={styles.previewWide}><small>Conditions</small><strong className={medical.conditions.length ? "" : styles.emptyValue}>{preview(medical.conditions)}</strong></div>
              <div className={styles.previewWide}><small>Medications</small><strong className={medical.medications.length ? "" : styles.emptyValue}>{preview(medical.medications)}</strong></div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <span className={`${styles.sectionIcon} ${styles.rose}`}><Droplet size={18} /></span>
              <span><strong>Blood type</strong><small>Select if known</small></span>
            </div>
            <div className={styles.panel}>
              <div className={styles.bloodTypes} role="group" aria-label="Blood type">
                {bloodTypes.map((type) => (
                  <button key={type} type="button" aria-pressed={medical.blood_type === type} className={medical.blood_type === type ? styles.selectedBlood : ""} onClick={() => { setMedical((current) => ({ ...current, blood_type: current.blood_type === type ? "" : type })); setMessage(""); }}>
                    {type}
                  </button>
                ))}
              </div>
              <p className={styles.helpText}><Info size={15} />Not sure? Leave this blank; responders can test.</p>
            </div>
          </section>

          <ItemSection
            kind="allergies"
            title="Allergies"
            subtitle="Food, medicine, insect, latex…"
            placeholder="Add an allergy"
            icon={<Leaf size={18} />}
            items={medical.allergies}
            onAdd={(value, input) => addItem("allergies", value, input)}
            onRemove={(index) => removeItem("allergies", index)}
            onKeyDown={(event) => handleItemKeyDown(event, "allergies")}
            onEdit={() => { setMessage(""); setError(""); }}
          />
          <ItemSection
            kind="conditions"
            title="Medical conditions"
            subtitle="What a medic should know first"
            placeholder="Add a condition"
            icon={<HeartPulse size={18} />}
            items={medical.conditions}
            onAdd={(value, input) => addItem("conditions", value, input)}
            onRemove={(index) => removeItem("conditions", index)}
            onKeyDown={(event) => handleItemKeyDown(event, "conditions")}
            onEdit={() => { setMessage(""); setError(""); }}
          />
          <ItemSection
            kind="medications"
            title="Medications"
            subtitle="Include the dose if you can"
            placeholder="Add a medication"
            icon={<Pill size={18} />}
            items={medical.medications}
            onAdd={(value, input) => addItem("medications", value, input)}
            onRemove={(index) => removeItem("medications", index)}
            onKeyDown={(event) => handleItemKeyDown(event, "medications")}
            onEdit={() => { setMessage(""); setError(""); }}
          />

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <span className={`${styles.sectionIcon} ${styles.neutral}`}><Info size={18} /></span>
              <span><strong>Anything else</strong><small>Mobility, language, or other helpful details</small></span>
            </div>
            <div className={styles.panel}>
              <textarea
                className={styles.notes}
                maxLength={300}
                value={medical.notes}
                onChange={(event) => { setMedical((current) => ({ ...current, notes: event.target.value })); setMessage(""); setError(""); }}
                placeholder="Anything that would help a responder help you faster."
                aria-label="Other medical information"
              />
              <div className={styles.characterCount}>{medical.notes.length}/300</div>
            </div>
          </section>

          <section className={`${styles.section} ${styles.privacySection}`}>
            <div className={styles.sectionHeading}>
              <span className={`${styles.sectionIcon} ${styles.violet}`}><LockKeyhole size={18} /></span>
              <span><strong>Your information stays private</strong><small>Only your account can view or update this profile.</small></span>
            </div>
            <div className={styles.privacyNote}>
              <ShieldCheck size={17} />
              <p>This Medical ID is saved separately from your SOS alert and is not automatically attached to an alert.</p>
            </div>
          </section>

          <div className={styles.saveBar}>
            {message && <p role="status"><Check size={15} />{message}</p>}
            <button type="button" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? "Saving…" : dirty ? "Save Medical ID" : "Up to date"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ItemSection({
  kind,
  title,
  subtitle,
  placeholder,
  icon,
  items,
  onAdd,
  onRemove,
  onKeyDown,
  onEdit,
}: {
  kind: ListKey;
  title: string;
  subtitle: string;
  placeholder: string;
  icon: ReactNode;
  items: string[];
  onAdd: (value: string, input: HTMLInputElement) => void;
  onRemove: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onEdit: () => void;
}) {
  const inputId = `medical-${kind}-input`;
  const categoryClass = kind === "allergies" ? styles.amber : kind === "conditions" ? styles.teal : styles.pink;
  const visibleSuggestions = suggestions[kind].filter((suggestion) => !items.some((item) => item.toLowerCase() === suggestion.toLowerCase()));

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <span className={`${styles.sectionIcon} ${categoryClass}`}>{icon}</span>
        <span><strong>{title}</strong><small>{subtitle}</small></span>
        {items.length > 0 && <span className={styles.count}>{items.length}</span>}
      </div>
      <div className={styles.panel}>
        <div className={styles.chips} aria-live="polite">
          {items.length === 0
            ? <span className={styles.emptyItems}>Nothing added yet.</span>
            : items.map((item, index) => (
              <span className={`${styles.chip} ${categoryClass}`} key={`${item}-${index}`}>
                <span className={styles.chipLabel}>{item}</span>
                <button type="button" aria-label={`Remove ${item}`} onClick={() => { onRemove(index); onEdit(); }}><X size={13} /></button>
              </span>
            ))}
        </div>
        <form className={styles.addRow} onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem("medical-item") as HTMLInputElement | null; if (input) { onAdd(input.value, input); onEdit(); } }}>
          <label className={styles.visuallyHidden} htmlFor={inputId}>{placeholder}</label>
          <input id={inputId} name="medical-item" maxLength={40} placeholder={placeholder} autoComplete="off" onKeyDown={onKeyDown} />
          <button type="submit" aria-label={placeholder}><Plus size={19} /></button>
        </form>
        {visibleSuggestions.length > 0 && (
          <div className={styles.suggestions} aria-label={`${title} suggestions`}>
            {visibleSuggestions.map((suggestion) => (
              <button type="button" key={suggestion} onClick={(event) => {
                const input = event.currentTarget.closest(`.${styles.panel}`)?.querySelector(`#${inputId}`);
                if (input instanceof HTMLInputElement) {
                  onAdd(suggestion, input);
                  onEdit();
                }
              }}>{suggestion}</button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
