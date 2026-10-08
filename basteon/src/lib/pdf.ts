import "server-only";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function renderSimpleCredentialPdf(lines: string[]) {
  const safeLines = lines.map((line) => escapePdfText(line.trim())).filter(Boolean);
  const content = [
    "BT",
    "/F1 14 Tf",
    "50 780 Td",
    ...safeLines.flatMap((line, index) => [
      index === 0 ? `(${line}) Tj` : "0 -20 Td",
      index === 0 ? "" : `(${line}) Tj`,
    ]).filter(Boolean),
    "ET",
  ].join("\n");

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(content, "utf8")} >> stream\n${content}\nendstream endobj`,
  ];

  const header = "%PDF-1.4\n";
  const bodyParts: string[] = [];
  const offsets: number[] = [0];
  let cursor = Buffer.byteLength(header, "utf8");
  for (const object of objects) {
    offsets.push(cursor);
    bodyParts.push(`${object}\n`);
    cursor += Buffer.byteLength(`${object}\n`, "utf8");
  }
  const xrefOffset = cursor;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n `),
    `trailer << /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
  ].join("\n");

  return Buffer.from(header + bodyParts.join("") + xref, "utf8");
}

