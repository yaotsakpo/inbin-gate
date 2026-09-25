// Browser stand-in. The real classifier (gate/consequences.mjs) reads the repository's git state,
// which a static page cannot; without a repo, decide() falls back to the read-only and safe-git rules.
export function consequences() { return []; }
export function coveredByDefault() { return false; }
