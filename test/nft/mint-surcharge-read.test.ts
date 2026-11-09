import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, PublicClient } from "viem";
import { readMintSurchargeBps } from "../../lib/platformFeeRead";

const address = `0x${"1".repeat(40)}` as Address;

function fixture(read: (functionName: string) => unknown) {
  const calls: Array<{ address: Address; functionName: string }> = [];
  const client = {
    readContract: async (request: { address: Address; functionName: string }) => {
      calls.push({ address: request.address, functionName: request.functionName });
      return read(request.functionName);
    },
  } as unknown as Pick<PublicClient, "readContract">;
  return { client, calls };
}

test("supported mint surcharge reads the configured rate, including both allowed boundaries", async () => {
  for (const bps of [BigInt(0), BigInt(350), BigInt(1000)]) {
    const { client, calls } = fixture((name) => name === "supportsMintSurcharge" ? true : bps);
    assert.equal(await readMintSurchargeBps(client, address), bps);
    assert.deepEqual(calls, [
      { address, functionName: "supportsMintSurcharge" },
      { address, functionName: "mintSurchargeBps" },
    ]);
  }
});

test("explicitly unsupported mint surcharge uses zero without reading a surcharge getter", async () => {
  const { client, calls } = fixture(() => false);
  assert.equal(await readMintSurchargeBps(client, address), BigInt(0));
  assert.deepEqual(calls, [{ address, functionName: "supportsMintSurcharge" }]);
});

test("a legacy factory missing the capability interface uses zero without a surcharge getter", async () => {
  for (const error of [
    { name: "ContractFunctionZeroDataError" },
    { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", raw: "0x", reason: "execution reverted" } },
  ]) {
    const { client, calls } = fixture(() => { throw error; });
    assert.equal(await readMintSurchargeBps(client, address), BigInt(0));
    assert.deepEqual(calls, [{ address, functionName: "supportsMintSurcharge" }]);
  }
});

test("transport, timeout and application-revert capability failures remain errors", async () => {
  for (const error of [
    Object.assign(new Error("RPC unavailable"), { name: "HttpRequestError" }),
    Object.assign(new Error("Request timed out"), { name: "TimeoutError" }),
    { name: "ContractFunctionRevertedError", raw: "0x1234", reason: "Not allowed" },
  ]) {
    const { client, calls } = fixture(() => { throw error; });
    await assert.rejects(readMintSurchargeBps(client, address), (actual) => actual === error);
    assert.deepEqual(calls, [{ address, functionName: "supportsMintSurcharge" }]);
  }
});

test("a supported factory never downgrades getter failures to a zero surcharge", async () => {
  for (const error of [
    { name: "ContractFunctionZeroDataError" },
    { name: "ContractFunctionRevertedError", raw: "0x", reason: "execution reverted" },
    Object.assign(new Error("Request timed out"), { name: "TimeoutError" }),
  ]) {
    const { client, calls } = fixture((name) => {
      if (name === "supportsMintSurcharge") return true;
      throw error;
    });
    await assert.rejects(readMintSurchargeBps(client, address), (actual) => actual === error);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].functionName, "mintSurchargeBps");
  }
});

test("mint surcharge rates outside zero to ten percent reject", async () => {
  for (const bps of [BigInt(-1), BigInt(1001)]) {
    const { client } = fixture((name) => name === "supportsMintSurcharge" ? true : bps);
    await assert.rejects(readMintSurchargeBps(client, address));
  }
});
