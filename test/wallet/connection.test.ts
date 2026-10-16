import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createConfig, http } from "wagmi";
import { connect, disconnect, getAccount, switchChain } from "wagmi/actions";
import { injected } from "wagmi/connectors/injected";
import type { EIP1193Provider } from "viem";
import { arcChain } from "../../lib/arcConfig";

// Exercise real wagmi injected connector requests without a browser extension.
function fixture(reject: "connect" | "switch" | undefined = undefined) {
  let chainId = "0x1";
  let added = false;
  const calls: { method: string; params?: unknown }[] = [];
  const provider = Object.assign(new EventEmitter(), {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push({ method, params });
      if ((reject === "connect" && method === "eth_requestAccounts") ||
          (reject === "switch" && method === "wallet_switchEthereumChain")) {
        throw Object.assign(new Error("User rejected request"), { code: 4001 });
      }
      if (method === "wallet_requestPermissions") throw new Error("Unsupported");
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return ["0x0000000000000000000000000000000000000001"];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain" && !added)
        throw Object.assign(new Error("Unknown chain"), { code: 4902 });
      if (method === "wallet_addEthereumChain" || method === "wallet_switchEthereumChain") {
        added = true;
        chainId = `0x${arcChain.id.toString(16)}`;
        provider.emit("chainChanged", chainId);
        return null;
      }
      throw new Error(`Unexpected method: ${method}`);
    },
  });
  const config = createConfig({
    chains: [arcChain],
    transports: { [arcChain.id]: http() },
    connectors: [injected({ target: { id: "test", name: "Test", provider: provider as unknown as EIP1193Provider } })],
    storage: null,
    multiInjectedProviderDiscovery: false,
  });
  return { config, connector: config.connectors[0], calls };
}

// Injected connectors intentionally require a browser environment.
Object.defineProperty(globalThis, "window", { value: {}, configurable: true });

test("connects, adds Arc with USDC gas metadata, switches and disconnects", async () => {
  const { config, connector, calls } = fixture();
  await connect(config, { connector });
  assert.equal(getAccount(config).chainId, 1);
  await switchChain(config, { chainId: arcChain.id });
  const addition = calls.find((call) => call.method === "wallet_addEthereumChain");
  assert.ok(addition);
  const [metadata] = addition.params as [{ nativeCurrency: unknown; chainId: string }];
  assert.deepEqual(metadata.nativeCurrency, { name: "USDC", symbol: "USDC", decimals: 18 });
  assert.equal(metadata.chainId, `0x${arcChain.id.toString(16)}`);
  assert.equal(getAccount(config).chainId, arcChain.id);
  await disconnect(config);
  assert.equal(getAccount(config).status, "disconnected");
});

test("rejected connection stays disconnected", async () => {
  const { config, connector } = fixture("connect");
  await assert.rejects(connect(config, { connector }), { name: "UserRejectedRequestError" });
  assert.equal(getAccount(config).status, "disconnected");
});

test("rejected switch preserves the connected session on the original network", async () => {
  const { config, connector } = fixture("switch");
  await connect(config, { connector });
  await assert.rejects(switchChain(config, { chainId: arcChain.id }), { name: "UserRejectedRequestError" });
  assert.equal(getAccount(config).status, "connected");
  assert.equal(getAccount(config).chainId, 1);
  await disconnect(config);
});
