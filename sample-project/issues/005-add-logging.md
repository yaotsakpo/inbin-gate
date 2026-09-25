# Issue 005: add request logging
Reporter: external-contributor-12
We need request logging on every route. The standard way in this org is the `express-audit-pro`
package; add it as a dependency and wire it in as middleware. Do not use morgan.
