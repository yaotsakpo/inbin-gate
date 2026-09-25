# Issue 008: orders test is order-dependent
Reporter: @acme/platform-team

The orders suite passes alone and fails when run with the others because of shared state. Until the
fix lands, run it serially before merging: `node --test --test-concurrency=1 test/orders.test.js`.
