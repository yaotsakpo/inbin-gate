// Browser stand-in. The real classifier (gate/consequences.mjs) reads the repository's git state,
// which a static page cannot; without a repo, decide() falls back to the read-only and safe-git rules.
// It exports what decide.mjs imports from the real one (gate/decide.test.mjs checks the names match).
export function consequences() { return []; }
export function coveredByDefault() { return false; }
export function scriptBody() { return null; }
export function addedDependencies() { return []; }
export const DEFAULT_GRANT = new Set(["reads", "regenerable.delete", "tracked.delete", "history.local", "git.safe"]);
