/**
 * Small, dependency-free profanity filter. It is intentionally conservative:
 * whole-word matching after undoing common character substitutions.
 * Extend BLOCKED_WORDS (lower case) to suit your community.
 */
const BLOCKED_WORDS = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole',
  'dick', 'dickhead', 'cunt', 'pussy', 'slut', 'whore', 'cock', 'wanker', 'twat', 'prick',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'rape', 'rapist', 'porn', 'nazi',
];

const SUBSTITUTIONS: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't',
};

const blocked = new Set(BLOCKED_WORDS);

function deobfuscate(token: string): string {
  return token
    .toLowerCase()
    .split('')
    .map((c) => SUBSTITUTIONS[c] ?? c)
    .join('')
    .replace(/(.)\1{2,}/g, '$1$1');
}

function isBlockedToken(token: string): boolean {
  const plain = deobfuscate(token).replace(/[^a-z]/g, '');
  if (!plain) return false;
  if (blocked.has(plain)) return true;
  // Collapse doubled letters too ("fuuck" -> "fuck").
  return blocked.has(plain.replace(/(.)\1+/g, '$1'));
}

export function containsProfanity(text: string): boolean {
  if (text.split(/[\s_.\-]+/).some(isBlockedToken)) return true;
  // Catch "f u c k" style spacing.
  const joined = text.replace(/[\s_.\-]+/g, '');
  return joined.length <= 24 && isBlockedToken(joined);
}

/** Replaces blocked words with asterisks, keeping the rest of the message. */
export function censor(text: string): string {
  return text.replace(/[^\s]+/g, (token) => (isBlockedToken(token) ? '*'.repeat(Math.min(token.length, 8)) : token));
}
