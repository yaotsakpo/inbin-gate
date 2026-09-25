// Browser stand-in. The real module (gate/registry.mjs) asks the npm registry for a package's age and
// weekly downloads; a static page does not, so no package is "established" here and the developer's
// intent or the policy list decide.
export function packagesInCommand() { return []; }
export function established() { return false; }
