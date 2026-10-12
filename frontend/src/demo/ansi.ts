import type { Span, Tone } from "./transcript";
import type { RLine } from "./useTimeline";

/** Strip all ANSI escape sequences — used to parse the plain text for the live schematic. */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Map the set of active SGR codes (from the CLI's `col` helper) to one of our terminal tones. */
function toneFor(codes: Set<number>): Tone {
  const bold = codes.has(1);
  if (codes.has(31)) return bold ? "badb" : "bad";
  if (codes.has(32)) return bold ? "okb" : "ok";
  if (codes.has(33)) return "warn";
  if (codes.has(36)) return "stage";
  if (bold) return "bold";
  if (codes.has(2)) return "dim";
  if (codes.has(4)) return "label";
  return "plain";
}

/**
 * Parse an accumulated ANSI stream into terminal lines of tone-tagged spans — the same shape the recorded
 * transcript uses, so the live terminal renders identically. The final line is marked active (caret) while streaming.
 */
export function ansiToLines(buf: string, streaming: boolean): RLine[] {
  const lines: Span[][] = [[]];
  const codes = new Set<number>();
  let run = "";
  let runTone: Tone = "plain";

  const flush = () => {
    if (run) { lines[lines.length - 1]!.push([run, runTone]); run = ""; }
  };

  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i]!;
    if (ch === "\x1b" && buf[i + 1] === "[") {
      // Consume an SGR sequence: ESC [ <codes> m
      const end = buf.indexOf("m", i + 2);
      if (end === -1) break;
      flush();
      const seq = buf.slice(i + 2, end);
      for (const part of seq.split(";")) {
        const n = Number(part || "0");
        if (n === 0) codes.clear();
        else codes.add(n);
      }
      runTone = toneFor(codes);
      i = end;
      continue;
    }
    if (ch === "\n") { flush(); lines.push([]); continue; }
    const tone = toneFor(codes);
    if (tone !== runTone) { flush(); runTone = tone; }
    run += ch;
  }
  flush();

  return lines.map((spans, i) => ({
    key: `live:${i}`,
    spans: spans.length ? spans : [""],
    reveal: 1,
    instant: true,
    active: streaming && i === lines.length - 1,
  }));
}
