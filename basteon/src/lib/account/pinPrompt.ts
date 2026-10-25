type Prompt = (
  message: string,
  initialValue?: string,
  options?: {
    title?: string;
    inputLabel?: string;
    placeholder?: string;
    submitLabel?: string;
    inputType?: "text" | "password";
    inputMode?: "text" | "numeric";
    maxLength?: number;
  },
) => Promise<string | null>;

export async function requestAccountPin(prompt: Prompt, action: string): Promise<string | undefined | null> {
  const response = await fetch("/api/account/security/pin", { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as { configured?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error ?? "Your security settings could not be checked.");
  if (typeof result.configured !== "boolean") throw new Error("Your security settings could not be checked.");
  if (!result.configured) return undefined;

  const pin = await prompt(
    `Enter your Kiki PIN to ${action}.`,
    "",
    {
      title: "Confirm with your Kiki PIN",
      inputLabel: "4 to 6 digit PIN",
      placeholder: "Enter PIN",
      submitLabel: "Continue",
      inputType: "password",
      inputMode: "numeric",
      maxLength: 6,
    },
  );
  if (pin === null) return null;
  if (!/^\d{4,6}$/.test(pin)) throw new Error("Enter your 4 to 6 digit Kiki PIN.");
  return pin;
}
