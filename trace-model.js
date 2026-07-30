const DEFAULT_OFFSET = 256;

function generationOrder(seq) {
  return [...seq.tokens].sort((a, b) => a.step - b.step || a.rope - b.rope);
}

function lastStep(seq) {
  return seq.tokens.reduce((m, t) => Math.max(m, t.step), 0);
}

function tokensAtStep(seq, k) {
  return seq.tokens.filter((t) => t.step <= k);
}

function offsetOf(seq) {
  return seq.offset ?? DEFAULT_OFFSET;
}

function lineOf(t, offset) {
  return Math.floor(t.rope / offset);
}

function columnOf(t, offset) {
  return t.rope % offset;
}

function ropeLines(seq, tokens) {
  const offset = offsetOf(seq);
  const lines = [];
  for (const t of tokens) {
    const i = lineOf(t, offset);
    while (lines.length <= i) lines.push([]);
    lines[i].push(t);
  }
  for (const line of lines) {
    line.sort((a, b) => columnOf(a, offset) - columnOf(b, offset));
  }
  return lines;
}

function flowLines(tokens) {
  const ordered = [...tokens].sort((a, b) => a.rope - b.rope);
  const lines = [[]];
  for (const t of ordered) {
    lines[lines.length - 1].push(t);
    if (t.char.includes("\n")) lines.push([]);
  }
  if (lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}

function layoutLines(seq, tokens) {
  const src = tokens ?? seq.tokens;
  if (seq.model === "ar") return flowLines(src);
  if (seq.model === "lclm") return ropeLines(seq, src);
  throw new Error(
    `sequence "${seq.name}" has model=${JSON.stringify(seq.model)}; expected "ar" or "lclm"`,
  );
}
