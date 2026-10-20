import assert from "node:assert/strict";
import { test } from "node:test";
import { usdcAmount, transactionError, minimumUsdcBid, displayUsdc } from "../../lib/protocol";

test("payable Arc USDC amounts use 18 decimals, including fractional prices", () => {
  assert.equal(usdcAmount("1"), BigInt("1000000000000000000"));
  assert.equal(usdcAmount("0.000001"), BigInt("1000000000000"));
  assert.equal(usdcAmount("123.456789"), BigInt("123456789000000000000"));
});

test("free mints require explicit opt-in and payments reject malformed amounts", () => {
  assert.equal(usdcAmount("0", true), BigInt(0));
  for (const value of ["0", "-1", "1e3", "0.0000001", "1000001", "NaN", "1,000", ""]) assert.throws(() => usdcAmount(value));
});

test("wallet rejection is recognized through wrapped provider errors", () => {
  assert.match(transactionError({ cause: { cause: { code: 4001 } } }), /cancelled/i);
});

test("minimum bids round upward to input precision and tiny rewards remain visible", () => {
  assert.equal(minimumUsdcBid(usdcAmount("1.000001"), usdcAmount("1")), usdcAmount("1.050002"));
  assert.equal(minimumUsdcBid(BigInt(0), usdcAmount("1")), usdcAmount("1"));
  assert.equal(displayUsdc(BigInt(1)), "0.000000000000000001");
});
