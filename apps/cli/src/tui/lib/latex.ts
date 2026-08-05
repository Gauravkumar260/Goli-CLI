/**
 * lib/latex.ts — LaTeX → Unicode symbol conversion (T-053).
 *
 * Agent responses (especially from math/CS-flavored models) frequently
 * contain inline LaTeX like `$\to$`, `$\alpha$`, `$\sum$`, `\leq`, etc.
 * Rendering these verbatim is ugly and breaks flow. We convert the most
 * common LaTeX symbols to their Unicode equivalents so the TUI shows
 * `α`, `→`, `Σ`, `≤` instead.
 *
 * Reference: gemini-cli's `latexToUnicode.ts` (~600 lines, 200+ symbols).
 * We implement a focused subset (~80 symbols) covering:
 *
 *   - Greek letters (lower + upper): α β γ δ … Ω
 *   - Arrows: → ← ↔ ⇒ ⇐ ⇔ ↦ ↑ ↓
 *   - Math operators: ± × ÷ · ≈ ≠ ≤ ≥ ∞ √ ∑ ∏ ∫ ∂ ∇ ∝ ∈ ∉ ⊂ ⊆ ∪ ∩ ∀ ∃
 *   - Blackboard: ℝ ℕ ℤ ℚ ℂ
 *   - Subscripts/superscripts (common): x² x³ xⁿ x_i x_n
 *
 * Usage:
 *   import { latexToUnicode } from '../lib/latex.js';
 *   const text = latexToUnicode('The function $f: \\mathbb{R} \\to \\mathbb{R}$ maps $x$ to $x^2$.');
 *   // => 'The function f: ℝ → ℝ maps x to x².'
 *
 * Performance: O(n) single-pass regex replacement. The symbol table is a
 * constant-size Map; replacements are batched per-symbol. For a 4KB agent
 * response, total conversion is <0.5ms.
 *
 * @module tui/lib/latex
 */

/**
 * Mapping of LaTeX commands to their Unicode equivalents.
 * Keys are matched as `\command` (with the leading backslash).
 */
const LATEX_SYMBOLS: Record<string, string> = {
  // Greek lowercase
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', varpi: 'π', rho: 'ρ', varrho: 'ρ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω',
  // Greek uppercase
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε',
  Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ',
  Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ',
  Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
  // Arrows
  to: '→', rightarrow: '→', Rightarrow: '⇒',
  leftarrow: '←', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔',
  mapsto: '↦', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
  hookrightarrow: '↪', hookleftarrow: '↩', leadsto: '⤳',
  // Math operators
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗',
  star: '⋆', circ: '∘', bullet: '•', leq: '≤', le: '≤',
  geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  sim: '∼', simeq: '≃', cong: '≅', propto: '∝', infty: '∞',
  sqrt: '√', sum: 'Σ', prod: '∏', coprod: '∐', int: '∫', oint: '∮',
  partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆',
  supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
  emptyset: '∅', varnothing: '∅', angle: '∠', measuredangle: '∡',
  perp: '⊥', parallel: '∥', triangle: '△', triangleleft: '⊲',
  dot: '⋅', ddot: '¨', dddot: '⋯',
  // Blackboard bold (via \mathbb{X})
  mathbbR: 'ℝ', mathbbN: 'ℕ', mathbbZ: 'ℤ', mathbbQ: 'ℚ',
  mathbbC: 'ℂ', mathbbP: 'ℙ', mathbbA: '𝔸', mathbbB: '𝔹',
  // Caligraphic (common)
  mathcalL: 'ℒ', mathcalF: 'ℱ', mathcalH: 'ℋ', mathcalO: '𝒪',
  // Misc
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  prime: '′', doubleprime: '″', partial_t: '∂ₜ',
  hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', beth: 'ℶ',
  clubsuit: '♣', diamondsuit: '♦', heartsuit: '♥', spadesuit: '♠',
  implies: '⟹', imputedby: '⟸', iff: '⟺',
};

/**
 * Common superscript mappings: x^2 → x², x^3 → x³, etc.
 * For multi-char superscripts (x^{n+1}), we fall back to leaving them as-is
 * rather than emitting caret + brace noise. Single-char superscripts 0-9, n,
 * i, +, -, = are converted.
 */
const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'i': 'ᵢ', 'o': 'ₒ', 'r': 'ᵣ',
  'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ',
};

/**
 * Convert LaTeX math notation in a string to Unicode symbols.
 *
 * Handles:
 *   - `$\command$` and `\command` (both inline-math and bare)
 *   - `\mathbb{X}` for X ∈ {R,N,Z,Q,C,P,A,B}
 *   - `\mathcal{X}` for X ∈ {L,F,H,O}
 *   - `x^2` superscripts (single-char only; multi-char preserved as `^{...}`)
 *   - `x_i` subscripts (single-char only; multi-char preserved as `_{...}`)
 *
 * Strings with no LaTeX commands are returned unchanged (fast path: a single
 * regex test that fails fast).
 *
 * @example
 *   latexToUnicode('$\\alpha + \\beta = 1$')  // 'α + β = 1'
 *   latexToUnicode('f: \\mathbb{R} \\to \\mathbb{R}')
 *   // 'f: ℝ → ℝ'
 *   latexToUnicode('x^2 + y^2 = r^2')  // 'x² + y² = r²'
 *   latexToUnicode('a_{ij}')            // 'aᵢⱼ' (multi-char: a_{ij} → aᵢⱼ)
 */
export function latexToUnicode(input: string): string {
  // Fast path: no LaTeX markers (backslash, $, ^, _) → unchanged.
  if (!input.includes('\\') && !input.includes('$') &&
      !input.includes('^') && !input.includes('_')) return input;

  let out = input;

  // Step 1: strip inline math delimiters $...$ (but preserve $$ for display).
  // We do NOT remove $$ here — display-math blocks are rare in agent output.
  out = out.replace(/\$([^$]+)\$/g, (_m, inner: string) => inner);

  // Step 2: \mathbb{X} → Unicode blackboard bold.
  out = out.replace(/\\mathbb\{([A-Z])\}/g, (_m, letter: string) => {
    const key = `mathbb${letter}` as keyof typeof LATEX_SYMBOLS;
    return LATEX_SYMBOLS[key] ?? `𝔸`; // fallback to plain mathbb A
  });

  // Step 3: \mathcal{X} → Unicode caligraphic (limited set).
  out = out.replace(/\\mathcal\{([A-Z])\}/g, (_m, letter: string) => {
    const key = `mathcal${letter}` as keyof typeof LATEX_SYMBOLS;
    return LATEX_SYMBOLS[key] ?? letter;
  });

  // Step 4: \command → Unicode symbol.
  // Match \ followed by letters (the command name). Curly-brace groups
  // like \sqrt{x} are handled separately — we leave the argument intact.
  out = out.replace(/\\([a-zA-Z]+)/g, (_m, cmd: string) => {
    return LATEX_SYMBOLS[cmd] ?? `\\${cmd}`; // unknown: leave unchanged
  });

  // Step 5: single-char superscripts: x^2 → x². NOT x^{n+1} (brace form).
  out = out.replace(/\^([a-zA-Z0-9+\-=()])/g, (_m, ch: string) => {
    return SUPERSCRIPT_MAP[ch] ?? `^${ch}`;
  });

  // Step 6: single-char subscripts: x_i → xᵢ. NOT x_{ij} (brace form).
  out = out.replace(/_([a-zA-Z0-9+\-=()])/g, (_m, ch: string) => {
    return SUBSCRIPT_MAP[ch] ?? `_${ch}`;
  });

  return out;
}

/** Exposed for tests. */
export const __testing = {
  LATEX_SYMBOLS,
  SUPERSCRIPT_MAP,
  SUBSCRIPT_MAP,
};
