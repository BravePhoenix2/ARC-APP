import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createConfig, http } from "wagmi";
import { connect, disconnect, getAccount, switchChain } from "wagmi/actions";
import { injected } from "wagmi/connectors/injected";
import type { EIP1193Provider } from "viem";
import { arcChain } from "../../lib/arcConfig";
import { getWalletOptions } from "../../lib/walletOptions";

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

function multipleWallets(rejectCoinbaseConnection = false) {
  const makeProvider = (address: `0x${string}`, rejectConnection: boolean) => {
    let chainId = "0x1";
    let added = false;
    const calls: { method: string; params?: unknown }[] = [];
    const provider = Object.assign(new EventEmitter(), {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        calls.push({ method, params });
        if (rejectConnection && method === "eth_requestAccounts") {
          throw Object.assign(new Error("User rejected request"), { code: 4001 });
        }
        if (method === "wallet_requestPermissions") throw new Error("Unsupported");
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return chainId;
        if (method === "wallet_switchEthereumChain" && !added) {
          throw Object.assign(new Error("Unknown chain"), { code: 4902 });
        }
        if (method === "wallet_addEthereumChain" || method === "wallet_switchEthereumChain") {
          added = true;
          chainId = `0x${arcChain.id.toString(16)}`;
          provider.emit("chainChanged", chainId);
          return null;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    });
    return { provider: provider as unknown as EIP1193Provider, calls, address };
  };
  const metaMask = makeProvider("0x0000000000000000000000000000000000000001", false);
  const coinbase = makeProvider("0x0000000000000000000000000000000000000002", rejectCoinbaseConnection);
  const config = createConfig({
    chains: [arcChain],
    transports: { [arcChain.id]: http() },
    connectors: [
      injected({ target: { id: "metaMask", name: "MetaMask", provider: metaMask.provider } }),
      injected({ target: { id: "coinbaseWallet", name: "Coinbase Wallet", provider: coinbase.provider } }),
    ],
    storage: null,
    multiInjectedProviderDiscovery: false,
  });
  return { config, metaMask, coinbase, selected: config.connectors[1] };
}

test("explicitly selected Coinbase connects its account when MetaMask is also installed", async () => {
  const { config, metaMask, coinbase, selected } = multipleWallets();

  await connect(config, { connector: selected });

  assert.equal(getAccount(config).address, coinbase.address);
  assert.equal(getAccount(config).connector?.id, "coinbaseWallet");
  assert.ok(coinbase.calls.some((call) => call.method === "eth_requestAccounts"));
  assert.equal(metaMask.calls.some((call) => call.method === "eth_requestAccounts"), false);
  await disconnect(config);
});

test("a rejected selected-wallet connection does not fall back to MetaMask", async () => {
  const { config, metaMask, coinbase, selected } = multipleWallets(true);

  await assert.rejects(connect(config, { connector: selected }), { name: "UserRejectedRequestError" });

  assert.equal(getAccount(config).status, "disconnected");
  assert.ok(coinbase.calls.some((call) => call.method === "eth_requestAccounts"));
  assert.equal(metaMask.calls.some((call) => call.method === "eth_requestAccounts"), false);
});

test("Arc network requests and USDC gas metadata go to the selected wallet only", async () => {
  const { config, metaMask, coinbase, selected } = multipleWallets();
  await connect(config, { connector: selected });
  await switchChain(config, { chainId: arcChain.id });

  const addition = coinbase.calls.find((call) => call.method === "wallet_addEthereumChain");
  assert.ok(addition);
  const [metadata] = addition.params as [{
    chainId: string;
    chainName: string;
    nativeCurrency: unknown;
    rpcUrls: string[];
    blockExplorerUrls: string[];
  }];
  assert.equal(metadata.chainId, `0x${arcChain.id.toString(16)}`);
  assert.equal(metadata.chainName, arcChain.name);
  assert.deepEqual(metadata.nativeCurrency, { name: "USDC", symbol: "USDC", decimals: 18 });
  assert.deepEqual(metadata.rpcUrls, [...arcChain.rpcUrls.default.http]);
  assert.deepEqual(metadata.blockExplorerUrls, [arcChain.blockExplorers!.default.url]);
  assert.ok(coinbase.calls.some((call) => call.method === "wallet_switchEthereumChain"));
  assert.equal(metaMask.calls.some((call) => call.method.startsWith("wallet_")), false);
  assert.equal(getAccount(config).address, coinbase.address);
  assert.equal(getAccount(config).chainId, arcChain.id);
  await disconnect(config);
});

test("wallet choices retain discovered providers and unfamiliar wallets while removing legacy aliases", async () => {
  const { config: legacy, metaMask, coinbase } = multipleWallets();
  const unfamiliarProvider = await fixture().connector.getProvider();
  assert.ok(unfamiliarProvider);
  const discovered = createConfig({
    chains: [arcChain],
    transports: { [arcChain.id]: http() },
    connectors: [
      injected({ target: { id: "io.metamask", name: "MetaMask", provider: metaMask.provider } }),
      injected({ target: { id: "com.coinbase.wallet", name: "Coinbase Wallet", provider: coinbase.provider } }),
      injected({ target: { id: "org.example.wallet", name: "Another Wallet", provider: unfamiliarProvider } }),
    ],
    storage: null,
    multiInjectedProviderDiscovery: false,
  });

  // Keep the original discovered connector objects, including their metadata.
  const options = getWalletOptions([...legacy.connectors, ...discovered.connectors]);
  assert.equal(options.length, 3);
  assert.strictEqual(options[0], discovered.connectors[0]);
  assert.strictEqual(options[1], discovered.connectors[1]);
  assert.strictEqual(options[2], discovered.connectors[2]);
  assert.strictEqual(await options[0].getProvider(), metaMask.provider);
  assert.strictEqual(await options[1].getProvider(), coinbase.provider);
  assert.strictEqual(await options[2].getProvider(), unfamiliarProvider);
});
