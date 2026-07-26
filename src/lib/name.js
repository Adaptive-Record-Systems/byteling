// Shared name memory — the app and the embed both let the user tell Byte their
// name in chat ("my name's Chris") and prefer it over the login handle, so Byte
// greets and refers to them by their real name instead of a username.

// Pull a stated name out of a chat message, or null if there isn't one.
export function extractName(text) {
  // Order matters: "my name is" must be tried before "my name('s)" so
  // "my name is Chris" captures "Chris", not "Is".
  const m = (text || '').match(/\b(?:my name is|my name'?s|i'?m|i am|call me|it'?s|name'?s)\s+([A-Za-z][A-Za-z'’-]{1,20})\b/i);
  if (!m) return null;
  const raw = m[1];
  // Common words that follow "I'm …" without being a name ("I'm good", "I'm stuck").
  const STOP = new Set(['good', 'fine', 'working', 'here', 'back', 'okay', 'ok', 'done', 'trying', 'not', 'sorry', 'busy', 'looking', 'ready', 'sure', 'glad', 'happy', 'tired', 'confused', 'stuck', 'curious', 'interested', 'just', 'still', 'also', 'really', 'doing', 'going', 'gonna', 'about', 'the', 'so', 'now', 'great', 'well', 'right', 'thinking', 'wondering', 'hoping']);
  if (STOP.has(raw.toLowerCase())) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// A first name to greet by, derived from a login "full_name" — but never a
// username/email handle (e.g. "cfair1911"), which Byte should not use as a name.
export function firstNameFrom(fullName) {
  const first = (fullName || '').trim().split(/\s+/)[0] || '';
  if (!first || /[\d@_]/.test(first)) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}
