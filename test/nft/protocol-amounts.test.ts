import assert from "node:assert/strict";
import { test } from "node:test";
import { usdcAmount, transactionError, minimumUsdcBid, displayUsdc, splitPlatformFee, addPlatformFee, formatFeePercent } from "../../lib/protocol";
import { feePresets, percentToBps, readFeeTerms } from "../../lib/monetization";

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

test("platform deductions preserve exact native USDC totals across both presets", () => {
  const gross = usdcAmount("100");
  assert.deepEqual(splitPlatformFee(gross, 250), { gross, platformFee: usdcAmount("2.5"), net: usdcAmount("97.5") });
  assert.equal(splitPlatformFee(gross, 1000).net, usdcAmount("90"));
  assert.equal(splitPlatformFee(gross, 100).platformFee, usdcAmount("1"));
  assert.deepEqual(splitPlatformFee(BigInt(1), 250), { gross: BigInt(1), platformFee: BigInt(0), net: BigInt(1) });
  assert.equal(splitPlatformFee(BigInt(0), 1000).platformFee, BigInt(0));
  assert.equal(formatFeePercent(250), "2.5%");
});

test("buyer surcharge and creator proceeds fee produce the standard mint split", () => {
  const surcharge = addPlatformFee(usdcAmount("5"), 200);
  const proceeds = splitPlatformFee(usdcAmount("5"), 250);
  assert.deepEqual(surcharge, { base: usdcAmount("5"), platformFee: usdcAmount("0.1"), total: usdcAmount("5.1") });
  assert.equal(proceeds.net, usdcAmount("4.875"));
  assert.equal(proceeds.platformFee + surcharge.platformFee, usdcAmount("0.225"));
  assert.deepEqual(addPlatformFee(BigInt(1), 200), { base: BigInt(1), platformFee: BigInt(0), total: BigInt(1) });
  assert.deepEqual(addPlatformFee(BigInt(0), 200), { base: BigInt(0), platformFee: BigInt(0), total: BigInt(0) });
});

test("deployment terms reject zero wallets, fractional basis points and rates above the contract cap", () => {
  assert.deepEqual(feePresets.standard, { mintFeeBps: 250, mintSurchargeBps: 200, marketplaceFeeBps: 250 });
  assert.equal(percentToBps("2.55"), 255);
  assert.equal(percentToBps("10.00"), 1000);
  for (const value of ["-1", "10.01", "1e1", "NaN", "2.555"]) assert.throws(() => percentToBps(value));
  for (const bps of [-1, 1.5, 1001]) assert.throws(() => splitPlatformFee(BigInt(1), bps));
  assert.equal(readFeeTerms({ feeRecipient: `0x${"1".repeat(40)}`, mintFeeBps: 250, marketplaceFeeBps: 250 }), null);
  assert.equal(readFeeTerms({ feeRecipient: `0x${"0".repeat(40)}`, mintFeeBps: 250, mintSurchargeBps: 200, marketplaceFeeBps: 250 }), null);
});
