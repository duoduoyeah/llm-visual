/* trace-model.js — the generation-trace data structure.
   The contract between producers (nanochat dump scripts, HF, vLLM) and the
   renderer. Reference fixture while designing: example-prompt-output.md

   Two things live here:
     1. the shape (JSDoc typedefs — no runtime cost, just describes the JSON)
     2. the derivations every renderer needs (generation order, line layout)

   Loaded as a plain <script src>, so these are globals — no module syntax.

   JSDoc typedef syntax, for reference:

     @typedef  {Object} Name          declare a shape
     @property {string} foo           required field
     @property {string} [foo]         optional field
     @property {number|null} foo      union
     @property {Token[]} foo          array of another typedef
     @property {Object.<string,string>} foo    map
     @property {"a"|"b"} foo          enum
*/

/**
 * One token in a sequence.
 *
 * @typedef  {Object} Token
 * @property {number} id    Tokenizer vocab id. Not unique within a sequence —
 *                          the same word appears many times. Not used for
 *                          layout; carried for tooltips and debugging.
 *                          TODO: special tokens are flagged off `id` later.
 * @property {string} char  The token's text, verbatim. Whitespace and newlines
 *                          are preserved, never stripped.
 * @property {number} rope  Position fed into RoPE. Determines *where* the token
 *                          is drawn: line = floor(rope / offset),
 *                          column = rope % offset.
 *
 *                          UNIQUE within the sequence — no two tokens share a
 *                          rope value. This makes it the token's identity too.
 *
 *                          SPARSE — gaps are normal and expected. A line may
 *                          end at 126 and the next begin at 256; 127..255 are
 *                          simply absent. Renderers must not assume rope values
 *                          are contiguous, and must not treat a gap as an error.
 * @property {number} step  Generation step k this token was produced at.
 *                          Determines *when* it appears. 0 = prompt.
 */

/**
 * One generation run. "Sequence", "file", "row" and "message" all mean this
 * same thing — one file holds exactly one sequence.
 *
 * Storage order is not meaningful — position comes from `rope`, time comes
 * from `step`. A list is the right structure precisely because both axes are
 * carried by the tokens themselves.
 *
 * @typedef  {Object} Sequence
 * @property {string} name      Label for the sequence picker.
 * @property {number} offset    RoPE stride per line. Default 256.
 * @property {Token[]} tokens   Every token, prompt included.
 */

const DEFAULT_OFFSET = 256;

/**
 * Tokens in the order they were generated.
 * Ties (same step) keep rope order, so parallel emissions read left-to-right.
 *
 * @param {Sequence} seq
 * @returns {Token[]}
 */
function generationOrder(seq) {
  return [...seq.tokens].sort((a, b) => a.step - b.step || a.rope - b.rope);
}

/**
 * Highest step in the sequence — the last frame of a step-by-step render.
 *
 * @param {Sequence} seq
 * @returns {number}
 */
function lastStep(seq) {
  return seq.tokens.reduce((m, t) => Math.max(m, t.step), 0);
}

/**
 * Every token generated at or before step k — i.e. what the sequence looked
 * like when the model had taken k steps.
 *
 * @param {Sequence} seq
 * @param {number} k
 * @returns {Token[]}
 */
function tokensAtStep(seq, k) {
  return seq.tokens.filter((t) => t.step <= k);
}

/** @param {Sequence} seq @returns {number} */
function offsetOf(seq) {
  return seq.offset ?? DEFAULT_OFFSET;
}

/** Line the token is drawn on. @param {Token} t @param {number} offset */
function lineOf(t, offset) {
  return Math.floor(t.rope / offset);
}

/** Column within that line. @param {Token} t @param {number} offset */
function columnOf(t, offset) {
  return t.rope % offset;
}

/**
 * Tokens bucketed into lines, each line sorted by column. Empty lines are
 * preserved as empty arrays so line indices stay meaningful.
 *
 * This is the layout both renderers consume: the step-by-step view walks it
 * per frame, the static image draws it once and colors by step.
 *
 * @param {Sequence} seq
 * @param {Token[]} [tokens]  Defaults to all of them; pass tokensAtStep(seq, k)
 *                            to lay out a single frame.
 * @returns {Token[][]}
 */
function layoutLines(seq, tokens) {
  const offset = offsetOf(seq);
  const src = tokens ?? seq.tokens;
  const lines = [];
  for (const t of src) {
    const i = lineOf(t, offset);
    while (lines.length <= i) lines.push([]);
    lines[i].push(t);
  }
  for (const line of lines) {
    line.sort((a, b) => columnOf(a, offset) - columnOf(b, offset));
  }
  return lines;
}
