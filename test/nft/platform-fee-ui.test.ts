import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toFunctionSelector, zeroAddress, type Address, type Hex } from "viem";
import PlatformFeeBreakdown from "../../components/PlatformFeeBreakdown";
import { usdcAmount } from "../../lib/protocol";
import { readPlatformFeeTerms, type PlatformFeeClient } from "../../lib/platformFeeRead";

const address = `0x${"1".repeat(40)}` as Address;
const treasury = `0x${"2".repeat(40)}` as Address;
const missing = { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", raw: "0x", reason: "execution reverted" } };
const oldCode = `0x63${toFunctionSelector("mintPrice()").slice(2)}1460005700` as Hex;

function client({ bps = BigInt(250), recipient = treasury, failure, code = oldCode }: { bps?: bigint; recipient?: Address; failure?: unknown; code?: Hex } = {}) {
  let codeReads = 0;
  return {
    feeClient: {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (failure) throw failure;
        return functionName === "platformFeeBps" ? bps : recipient;
      },
      getCode: async () => { codeReads++; return code; },
    } as unknown as PlatformFeeClient,
    codeReads: () => codeReads,
  };
}

test("fee terms use the actual deployed rate and recipient, including a zero fee", async () => {
  for (const bps of [BigInt(250), BigInt(0)]) {
    const rpc = client({ bps });
    assert.deepEqual(await readPlatformFeeTerms(rpc.feeClient, address), { legacy: false, bps, recipient: treasury });
    assert.equal(rpc.codeReads(), 0);
  }
});

test("legacy fees require missing getters and verified direct contract bytecode", async () => {
  const rpc = client({ failure: missing });
  assert.deepEqual(await readPlatformFeeTerms(rpc.feeClient, address), { legacy: true, bps: BigInt(0), recipient: null });
  assert.equal(rpc.codeReads(), 1);
  for (const code of ["0x", `${oldCode}f4`, `${oldCode}63${toFunctionSelector("platformFeeBps()").slice(2)}`] as Hex[]) {
    await assert.rejects(readPlatformFeeTerms(client({ failure: missing, code }).feeClient, address), (error) => error === missing);
  }
});

test("RPC failures and partial fee interface failures never become zero fee legacy deployments", async () => {
  const failure = new Error("RPC request timed out");
  const rpc = client({ failure });
  await assert.rejects(readPlatformFeeTerms(rpc.feeClient, address), failure);
  assert.equal(rpc.codeReads(), 0);
  const partial = { ...rpc.feeClient, readContract: async ({ functionName }: { functionName: string }) => { if (functionName === "platformFeeBps") return BigInt(250); throw missing; } } as unknown as PlatformFeeClient;
  await assert.rejects(readPlatformFeeTerms(partial, address), (error) => error === missing);
  assert.equal(rpc.codeReads(), 0);
});

test("invalid deployed fee terms are rejected", async () => {
  for (const config of [{ bps: BigInt(10_001) }, { recipient: zeroAddress }]) {
    await assert.rejects(readPlatformFeeTerms(client(config).feeClient, address), /configuration is invalid/);
  }
});

test("paid checkout discloses the included platform deduction, creator net, and separate gas", () => {
  const markup = renderToStaticMarkup(React.createElement(PlatformFeeBreakdown, { gross: usdcAmount("25"), terms: { legacy: false, bps: BigInt(250), recipient: treasury } }));
  for (const expected of ["Total payment", "25 USDC", "Platform fee (2.5%)", "0.625 USDC", "Creator receives", "24.375 USDC", "included in the payment", "Network gas is separate", treasury]) assert.ok(markup.includes(expected), expected);
});

test("mint checkout separates the buyer surcharge from the creator deduction", () => {
  const markup = renderToStaticMarkup(React.createElement(PlatformFeeBreakdown, { gross: usdcAmount("5"), mintSurchargeBps: BigInt(200), terms: { legacy: false, bps: BigInt(250), recipient: treasury } }));
  for (const expected of ["Mint price", "5 USDC", "Collector platform fee (2%)", "0.1 USDC", "Total mint payment", "5.1 USDC", "Creator platform fee (2.5%)", "0.125 USDC", "Creator receives", "4.875 USDC", "Total platform fees", "0.225 USDC", "collector fee is added", "creator fee is deducted", "Network gas is separate", treasury]) assert.ok(markup.includes(expected), expected);
});

test("zero and legacy deployments disclose zero while unavailable terms never imply zero", () => {
  for (const legacy of [false, true]) {
    const markup = renderToStaticMarkup(React.createElement(PlatformFeeBreakdown, { gross: BigInt(0), terms: { legacy, bps: BigInt(0), recipient: legacy ? null : treasury } }));
    assert.ok(markup.includes("Platform fee (0%)"));
    assert.equal(markup.includes("Legacy deployment"), legacy);
  }
  const unavailable = renderToStaticMarkup(React.createElement(PlatformFeeBreakdown, { gross: usdcAmount("25"), isError: true }));
  assert.ok(unavailable.includes("Platform fee could not be verified"));
  assert.ok(!unavailable.includes("0%"));
  assert.ok(!unavailable.includes("Creator receives"));
});

test("auction proceeds keep creator royalties distinct from platform fees", () => {
  const markup = renderToStaticMarkup(React.createElement(PlatformFeeBreakdown, { gross: usdcAmount("25"), auction: true, terms: { legacy: false, bps: BigInt(250), recipient: treasury } }));
  assert.ok(markup.includes("Seller proceeds before royalties"));
  assert.ok(markup.includes("24.375 USDC"));
  assert.ok(markup.includes("Creator royalties are separate"));
  assert.ok(markup.includes("deducted at settlement"));
});
