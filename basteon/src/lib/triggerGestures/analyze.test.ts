import { describe, expect, it } from "vitest";
import { analyze, profileTrust, recommend, validateMapping, type Sample } from "./analyze";

const repeated = (prompted: number, signature: string, gaps = [100, 120]): Sample[] =>
  Array.from({ length: 3 }, () => ({ prompted, sig: signature, presses: signature.length, gaps }));

describe("trigger gesture analysis", () => {
  it("grades a Volkano-like stable toggle gesture and flags volume as avoid", () => {
    const result = analyze([
      ...repeated(1, "T"),
      ...repeated(2, "P"),
      ...repeated(3, "U"),
      ...repeated(4, "TTTT"),
      ...repeated(5, "TTTTT"),
    ]);
    expect(result.gestures.find(({ taps }) => taps === 1)?.grade).toBe("C");
    expect(result.gestures.find(({ taps }) => taps === 2)?.grade).toBe("B");
    expect(result.gestures.find(({ taps }) => taps === 3)?.grade).toBe("C");
    expect(result.gestures.find(({ taps }) => taps === 3)?.notes).toContain(
      "Changes your volume and may not work at maximum or minimum volume."
    );
  });

  it("reports indistinguishable gestures and tap counts with no events", () => {
    const result = analyze([
      ...repeated(1, "T"),
      ...repeated(2, "T"),
      ...repeated(3, ""),
    ]);
    expect(result.indistinguishable).toEqual([{ sig: "T", taps: [1, 2] }]);
    expect(result.unseen).toEqual([3]);
    expect(result.gestures[0].grade).toBe("C");
  });

  it("clamps calibrated timing to the supported range", () => {
    expect(analyze(repeated(3, "TTT", [10])).timing).toEqual({ gapMs: 350, settleMs: 600 });
    expect(analyze(repeated(3, "TTT", [2_000])).timing).toEqual({ gapMs: 900, settleMs: 1_150 });
  });

  it("recommends only distinct low-risk gestures for alert actions", () => {
    const gestures = analyze([
      ...repeated(1, "T"),
      ...repeated(2, "NN"),
      ...repeated(3, "NNN"),
      ...repeated(4, "NNNN"),
      ...repeated(5, "NNNNN"),
      ...repeated(6, "NNNNNN"),
    ]).gestures;
    const mapping = recommend(gestures);
    const alertSignatures = [mapping.sos, mapping.medical, mapping.duress].filter(Boolean);
    expect(new Set(Object.values(mapping)).size).toBe(Object.values(mapping).length);
    expect(alertSignatures.every((sig) => (gestures.find((item) => item.sig === sig)?.risk ?? 1) <= 0.65)).toBe(true);
    expect(mapping.cancel).toBeDefined();
  });

  it("rejects undetected and duplicate assignments and exposes profile trust", () => {
    const gestures = analyze([...repeated(3, "NNN"), ...repeated(4, "NNNN")]).gestures;
    expect(validateMapping({ sos: "bad", cancel: "NNN", medical: "NNN" }, gestures)).toEqual([
      "sos: that gesture was not detected during testing.",
      "medical and cancel use the same gesture.",
    ]);
    expect(profileTrust(gestures, { sos: "NNN" }, true)).toBe("incomplete");
    expect(profileTrust(gestures, { sos: "NNN", cancel: "NNNN" }, false)).toBe("unverified");
    expect(profileTrust(gestures, { sos: "NNN", cancel: "NNNN" }, true)).toBe("ready");
  });
});
