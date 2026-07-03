'use strict';

const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Stop words removed during lexical normalization
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'for', 'with', 'by', 'at', 'to', 'of', 'in', 'on',
  'and', 'or', 'is', 'it', 'its', 'this', 'that', 'from', 'as', 'be',
  'are', 'was', 'were', 'been', 'has', 'have', 'had', 'not', 'no',
]);

// ---------------------------------------------------------------------------
// Model-number-like patterns: digits optionally followed by unit or slash
// ---------------------------------------------------------------------------
const MODEL_NUM_RE = /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|g|kg|oz|lb|f\/?\d\.?\d*|x|hz|ghz|w|v|a|mah|usb|hdmi|wifi|bt|mp|px|dpi|fps)\b/gi;
const DIGIT_SEQ_RE = /\b\d{2,}\b/g;
const FRACTION_RE = /f\/?\d\.?\d*/gi;

// ---------------------------------------------------------------------------
// Normalize a product title for lexical comparison
// ---------------------------------------------------------------------------
function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return [];
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s./]/g, ' ')    // keep letters, digits, periods, slashes
    .split(/\s+/)
    .filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

// ---------------------------------------------------------------------------
// Extract model-number-like tokens from a string
// ---------------------------------------------------------------------------
function extractModelTokens(text) {
  if (!text || typeof text !== 'string') return new Set();
  const lower = text.toLowerCase();
  const tokens = new Set();

  for (const m of lower.matchAll(MODEL_NUM_RE)) tokens.add(m[0].trim());
  for (const m of lower.matchAll(FRACTION_RE)) tokens.add(m[0].trim());
  for (const m of lower.matchAll(DIGIT_SEQ_RE)) tokens.add(m[0]);

  return tokens;
}

// ---------------------------------------------------------------------------
// Jaccard similarity between two sets
// ---------------------------------------------------------------------------
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Phase 1: Fast lexical filter
// Returns null when below threshold (no match) or a similarity score object
// ---------------------------------------------------------------------------
function phase1Lexical(sourceProduct, candidate) {
  const sourceTitle = sourceProduct.title || '';
  const candidateTitle = candidate.title || '';

  const srcTokens = new Set(normalizeTitle(sourceTitle));
  const canTokens = new Set(normalizeTitle(candidateTitle));

  const jaccard = jaccardSimilarity(srcTokens, canTokens);

  // Brand overlap
  let brandOverlap = false;
  if (sourceProduct.brand && candidate.title) {
    const brandLower = sourceProduct.brand.toLowerCase();
    brandOverlap = candidate.title.toLowerCase().includes(brandLower);
  }

  // Model-number overlap
  const srcModels = extractModelTokens(sourceTitle);
  const canModels = extractModelTokens(candidateTitle);
  const modelOverlap = srcModels.size > 0 && canModels.size > 0
    ? jaccardSimilarity(srcModels, canModels)
    : 0;

  // Quick reject
  if (jaccard < 0.3) return null;

  return { jaccard, brandOverlap, modelOverlap };
}

// ---------------------------------------------------------------------------
// Fallback scoring when LLM is unavailable
// ---------------------------------------------------------------------------
function fallbackScore(lexical) {
  if (!lexical) return { match: false, confidence: 0, reasoning: 'Lexical filter below threshold' };
  if (lexical.jaccard > 0.7) {
    return { match: true, confidence: 0.6, reasoning: 'High lexical similarity (fallback)' };
  }
  if (lexical.jaccard > 0.5) {
    return { match: false, confidence: 0.3, reasoning: 'Moderate lexical similarity — needs human review (fallback)' };
  }
  return { match: false, confidence: 0, reasoning: `Low lexical similarity ${lexical.jaccard.toFixed(2)} (fallback)` };
}

// ---------------------------------------------------------------------------
// Phase 2: LLM judge via OpenCode CLI
// ---------------------------------------------------------------------------
function askLLM(sourceTitle, candidateTitle) {
  // Safety: escape quotes so the shell pipeline isn't broken
  const safeSource = sourceTitle.replace(/"/g, '\\"');
  const safeCandidate = candidateTitle.replace(/"/g, '\\"');

  const prompt = `Are these the same retail product? Consider brand, model number, and specifications.
Known product: "${safeSource}"
Found product: "${safeCandidate}"
Answer with only: YES/NO/CONFIDENCE:X.X`;

  const command = `echo ${JSON.stringify(prompt)} | opencode run --agent chief --model deepseek-v4-flash-free`;

  const stdout = execSync(command, { timeout: 15000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Parse the LLM response into structured result
// ---------------------------------------------------------------------------
function parseLLMResponse(response) {
  const upper = response.toUpperCase();

  // Extract confidence from pattern CONFIDENCE:X.X or similar
  let confidence = 0.5; // default middle-ground
  const confMatch = response.match(/CONFIDENCE\s*:\s*(\d+(?:\.\d+)?)/i);
  if (confMatch) {
    const parsed = parseFloat(confMatch[1]);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) confidence = parsed;
  }

  const isYes = /^YES\b/.test(upper);
  const isNo = /^NO\b/.test(upper);

  if (isYes) return { match: true, confidence, reasoning: response };
  if (isNo) return { match: false, confidence: 1 - confidence, reasoning: response };

  // Ambiguous — treat as moderate match
  return { match: confidence >= 0.5, confidence, reasoning: response };
}

// ---------------------------------------------------------------------------
// Phase 2 orchestrator
// ---------------------------------------------------------------------------
async function phase2LLM(sourceProduct, candidate, lexical) {
  const sourceTitle = sourceProduct.title || '';
  const candidateTitle = candidate.title || '';

  try {
    const raw = askLLM(sourceTitle, candidateTitle);
    const result = parseLLMResponse(raw);

    // Boost confidence if lexical signals agree
    if (result.match && lexical.brandOverlap) {
      result.confidence = Math.min(1, result.confidence + 0.15);
    }
    if (result.match && lexical.modelOverlap > 0.5) {
      result.confidence = Math.min(1, result.confidence + 0.1);
    }

    return result;
  } catch (err) {
    // OpenCode CLI unavailable or timed out — use fallback
    return fallbackScore(lexical);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match a candidate product against a known product.
 * Two-phase approach: fast lexical filter → LLM judge.
 *
 * @param {Object} sourceProduct - Our known product
 * @param {string} sourceProduct.id
 * @param {string} sourceProduct.title
 * @param {string} [sourceProduct.brand]
 * @param {string} [sourceProduct.upc]
 * @param {Object} candidate - Product found at another store
 * @param {string} candidate.title
 * @param {number} [candidate.price]
 * @param {string} [candidate.url]
 * @param {string} [candidate.storeId]
 * @returns {Promise<{match: boolean, confidence: number, reasoning: string}>}
 */
async function matchProduct(sourceProduct, candidate) {
  // --- input guard ---
  if (!sourceProduct || !candidate) {
    return { match: false, confidence: 0, reasoning: 'Missing source or candidate product' };
  }
  if (!sourceProduct.title && !candidate.title) {
    return { match: false, confidence: 0, reasoning: 'Neither product has a title' };
  }
  if (!sourceProduct.title || !candidate.title) {
    return { match: false, confidence: 0, reasoning: 'One product is missing a title' };
  }

  // Phase 1
  const lexical = phase1Lexical(sourceProduct, candidate);
  if (!lexical) {
    return { match: false, confidence: 0, reasoning: 'Lexical similarity below 0.3 threshold' };
  }

  // Phase 2
  return phase2LLM(sourceProduct, candidate, lexical);
}

/**
 * Batch match: find all stores that might carry this product.
 * Results sorted by confidence descending.
 *
 * @param {Object} sourceProduct - Our known product
 * @param {Array<Object>} candidates - Products found at other stores
 * @returns {Promise<Array<{candidate: Object, match: boolean, confidence: number, reasoning: string}>>}
 */
async function batchMatch(sourceProduct, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    candidates.map(c => matchProduct(sourceProduct, c))
  );

  const output = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = results[i];
    output.push({
      candidate: candidates[i],
      ...(r.status === 'fulfilled'
        ? r.value
        : { match: false, confidence: 0, reasoning: `Error: ${r.reason?.message || r.reason}` }),
    });
  }

  output.sort((a, b) => b.confidence - a.confidence);
  return output;
}

module.exports = { matchProduct, batchMatch };
