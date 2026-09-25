import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotal, formatMoney } from "../src/orders.js";
test("total with tax", () => { assert.equal(computeTotal([{ price: 10, qty: 2 }]), 24); });
test("discount over 100", () => { assert.equal(computeTotal([{ price: 60, qty: 2 }]), 132); });
test("formatMoney", () => { assert.equal(formatMoney(3.5), "$3.50"); });
test("formatMoney thousands", () => { assert.equal(formatMoney(1234.5), "$1,234.50"); });
