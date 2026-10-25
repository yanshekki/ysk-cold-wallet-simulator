import { wordlist as BIP39_WORDLIST } from '@scure/bip39/wordlists/english';
import {
  combineSlip39,
  isSlip39Mnemonic,
  isSlip39Word,
  isValidBip39Mnemonic,
  SLIP39_WORDLIST,
} from '@cws/sdk';

const BIP39_COUNTS = [12, 15, 18, 21, 24] as const;
const SLIP39_COUNTS = [20, 33] as const;

export type ImportScheme = 'bip39' | 'slip39' | 'unknown';

export type ImportWord = {
  index: number;
  word: string;
  ok: boolean;
  suggestion?: string;
};

export type ImportShareView = {
  text: string;
  words: ImportWord[];
  count: number;
  valid: boolean;
};

export type ImportAnalysis = {
  scheme: ImportScheme;
  shares: ImportShareView[];
  have: number;
  need: number;
  checksumOk: boolean;
  ready: boolean;
  lastSuggestions: string[];
};

export function sanitizePaste(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/share\s*\d+\s*:?/g, '\n\n')
    .replace(/[,\uFF0C;]/g, ' ')
    .replace(/(^|\s)\d+[.)]\s+/gm, '$1')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitShares(raw: string): string[] {
  const cleaned = sanitizePaste(raw);
  if (!cleaned) {
    return [];
  }
  return cleaned
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function tokensOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function nextBip39Need(have: number): number {
  for (const count of BIP39_COUNTS) {
    if (have <= count) {
      return count;
    }
  }
  return 24;
}

function nextSlip39Need(have: number): number {
  for (const count of SLIP39_COUNTS) {
    if (have <= count) {
      return count;
    }
  }
  return 33;
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length] ?? b.length;
}

export function closestWord(word: string, list: readonly string[]): string | undefined {
  const needle = word.toLowerCase();
  if (!needle) {
    return undefined;
  }
  const prefix = list.find((item) => item.startsWith(needle) && item !== needle);
  if (prefix && needle.length >= 2) {
    return prefix;
  }
  if (needle.length < 3) {
    return undefined;
  }
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of list) {
    if (Math.abs(candidate.length - needle.length) > 2) {
      continue;
    }
    const distance = levenshtein(needle, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      if (distance === 1) {
        return candidate;
      }
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

function prefixSuggestions(word: string, list: readonly string[]): string[] {
  if (word.length < 2) {
    return [];
  }
  return list.filter((item) => item.startsWith(word) && item !== word).slice(0, 6);
}

function inspectShare(text: string, list: readonly string[], inList: (word: string) => boolean): ImportShareView {
  const tokens = tokensOf(text);
  const words: ImportWord[] = tokens.map((word, index) => {
    const ok = inList(word);
    return {
      index,
      word,
      ok,
      suggestion: ok ? undefined : closestWord(word, list),
    };
  });
  return { text, words, count: tokens.length, valid: false };
}

function canCombine(shares: string[]): boolean {
  if (shares.length === 0 || !shares.every(isSlip39Mnemonic)) {
    return false;
  }
  try {
    combineSlip39(shares);
    return true;
  } catch {
    return false;
  }
}

export function analyzeImport(parts: readonly string[]): ImportAnalysis {
  const shares = parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (shares.length === 0) {
    return {
      scheme: 'unknown',
      shares: [],
      have: 0,
      need: 12,
      checksumOk: false,
      ready: false,
      lastSuggestions: [],
    };
  }

  const slipValid = shares.map(isSlip39Mnemonic);
  const bipValid = shares.length === 1 && isValidBip39Mnemonic(shares[0] ?? '');
  const firstCount = tokensOf(shares[0] ?? '').length;
  const looksSlip =
    shares.length > 1 ||
    slipValid.some(Boolean) ||
    SLIP39_COUNTS.includes(firstCount as (typeof SLIP39_COUNTS)[number]);
  const looksBip = BIP39_COUNTS.includes(firstCount as (typeof BIP39_COUNTS)[number]) || bipValid;

  let scheme: ImportScheme = 'unknown';
  if (looksSlip && !bipValid) {
    scheme = 'slip39';
  } else if (looksBip && !looksSlip) {
    scheme = 'bip39';
  } else if (bipValid) {
    scheme = 'bip39';
  } else if (looksSlip) {
    scheme = 'slip39';
  }

  if (scheme === 'slip39') {
    const views = shares.map((text, index) => {
      const view = inspectShare(text, SLIP39_WORDLIST, isSlip39Word);
      view.valid = slipValid[index] ?? false;
      return view;
    });
    const last = views[views.length - 1];
    const lastWord = last?.words[last.words.length - 1]?.word ?? '';
    const have = last?.count ?? 0;
    const ready = canCombine(shares);
    return {
      scheme,
      shares: views,
      have,
      need: nextSlip39Need(have || 20),
      checksumOk: ready,
      ready,
      lastSuggestions: prefixSuggestions(lastWord, SLIP39_WORDLIST),
    };
  }

  if (scheme === 'bip39') {
    const text = shares[0] ?? '';
    const view = inspectShare(text, BIP39_WORDLIST, (word) => BIP39_WORDLIST.includes(word));
    const lastWord = view.words[view.words.length - 1]?.word ?? '';
    return {
      scheme,
      shares: [view],
      have: view.count,
      need: nextBip39Need(view.count),
      checksumOk: bipValid,
      ready: bipValid,
      lastSuggestions: prefixSuggestions(lastWord, BIP39_WORDLIST),
    };
  }

  const text = shares[0] ?? '';
  const view = inspectShare(text, BIP39_WORDLIST, (word) => BIP39_WORDLIST.includes(word));
  const lastWord = view.words[view.words.length - 1]?.word ?? '';
  return {
    scheme: 'unknown',
    shares: [view],
    have: view.count,
    need: nextBip39Need(view.count || 1),
    checksumOk: false,
    ready: false,
    lastSuggestions: prefixSuggestions(lastWord, BIP39_WORDLIST),
  };
}

export function replaceToken(text: string, index: number, next: string): string {
  const tokens = tokensOf(text);
  if (index < 0 || index >= tokens.length) {
    return text;
  }
  tokens[index] = next;
  return tokens.join(' ');
}

export function applyLastSuggestion(text: string, suggestion: string): string {
  const tokens = tokensOf(text);
  if (tokens.length === 0) {
    return suggestion;
  }
  tokens[tokens.length - 1] = suggestion;
  return `${tokens.join(' ')} `;
}
