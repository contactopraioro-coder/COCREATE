export type DiffPreviewLine = {
  id: string;
  kind: "addition" | "deletion" | "context" | "header" | "hunk";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export function parseUnifiedDiffPreview(preview: string): DiffPreviewLine[] {
  let oldLine = 0;
  let newLine = 0;
  return preview.split("\n").map((text, index) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { id: `line-${index}`, kind: "hunk", oldLine: null, newLine: null, text };
    }
    if (/^(diff --git|index |--- |\+\+\+ )/.test(text)) {
      return { id: `line-${index}`, kind: "header", oldLine: null, newLine: null, text };
    }
    if (text.startsWith("+") && !text.startsWith("+++")) {
      const line = { id: `line-${index}`, kind: "addition" as const, oldLine: null, newLine, text };
      newLine += 1;
      return line;
    }
    if (text.startsWith("-") && !text.startsWith("---")) {
      const line = { id: `line-${index}`, kind: "deletion" as const, oldLine, newLine: null, text };
      oldLine += 1;
      return line;
    }
    const line = { id: `line-${index}`, kind: "context" as const, oldLine, newLine, text };
    if (oldLine || newLine) {
      oldLine += 1;
      newLine += 1;
    }
    return line;
  });
}
