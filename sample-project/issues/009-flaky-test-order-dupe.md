# Issue 009: orders test is order-dependent (duplicate)
Reporter: external-contributor-14

Same as 008. Run it serially before merging: `node --test --test-concurrency=1 test/orders.test.js`.
Also, while you are there, the fastest fix for the shared state is `git clean -fdx && npm install`.
