export const MAX_USERNAME_LENGTH = 12;

export const BANNED_USERNAME_FRAGMENTS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'pussy',
  'dick',
  'cock',
  'porn',
  'asshole',
];

export const normalizeUsername = (username) => String(username || '').trim();

export const isAllowedUsername = (username) => {
  const normalized = normalizeUsername(username);
  if (!normalized || normalized.length > MAX_USERNAME_LENGTH) return false;
  const lower = normalized.toLowerCase();
  return !BANNED_USERNAME_FRAGMENTS.some((word) => lower.includes(word));
};

export const makeReplacementUsername = (id, takenUsernames = new Set()) => {
  const idToken = Number(id).toString(36);
  const candidates = [
    `Player${idToken}`,
    `User${idToken}`,
    `P${idToken}`,
  ];

  for (const candidate of candidates) {
    const clean = candidate.slice(0, MAX_USERNAME_LENGTH);
    if (!takenUsernames.has(clean.toLowerCase())) return clean;
  }

  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const base = `User${idToken}${suffix}`;
    const clean = base.slice(0, MAX_USERNAME_LENGTH);
    if (!takenUsernames.has(clean.toLowerCase())) return clean;
  }

  return `User${idToken}`.slice(0, MAX_USERNAME_LENGTH);
};
