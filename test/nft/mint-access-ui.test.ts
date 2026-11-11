import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React, { useState } from "react";
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import ts from "typescript";
import type MintAccessPanelComponent from "../../components/MintAccessPanel";
import type { MintAccessData } from "../../hooks/useMintAccess";
import type { MintPhaseConfig } from "../../lib/mintAccess";

type PanelProps = React.ComponentProps<typeof MintAccessPanelComponent>;
type PriceChange = { action: "price"; tier: "ULTIMATE" | "FCFS"; price: string };
type Change = PriceChange | { action: "disable" } | { action: "freeze" } | { action: "unfreeze" } | { action: "discard-allowlist" } | { action: "configure"; config: MintPhaseConfig } | { action: "assign"; tier: string; wallets: string[] };
type Options = { isOwner?: boolean; deployed?: boolean; frozen?: boolean; supportsManagement?: boolean; managementBusy?: boolean; deploymentPending?: boolean; publicPrice?: number };
const require = createRequire(import.meta.url);
const publicPrice = 3;
let renderer: ReactTestRenderer | undefined;
let persisted: MintAccessData;
let changes: Change[];
let refreshes: number;
let saveFailure: boolean;
let deferSave: boolean;
let finishSave: (() => void) | undefined;
let publishedUpdates: Array<{ root: string; guaranteedAllocation: number }>;
let publishFailure: boolean;

const source = readFileSync(new URL("../../components/MintAccessPanel.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const output = { exports: {} as { default: React.ComponentType<PanelProps> } };
const dependencies: Record<string, unknown> = {
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => ({ authenticated: true, walletAddress: `0x${"1".repeat(40)}`, login() {}, connectWallet() {} }) },
};
new Function("require", "module", "exports", code)((name: string) => dependencies[name] ?? require(name), output, output.exports);
const MintAccessPanel = output.exports.default;

function Harness({ isOwner = true, deployed = false, frozen = false, supportsManagement = false, managementBusy = false, deploymentPending = false, publicPrice: collectionPrice = publicPrice }: Options) {
  const [data, setData] = useState<MintAccessData>(() => ({
    ...persisted,
    plan: persisted.plan && { ...persisted.plan, frozenAt: frozen ? "2026-10-23T12:00:00.000Z" : null },
  }));
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const access = {
    data, isLoading: false, isError: false, error: null, saving, saveError,
    save: (input: Change, options?: { onSuccess?: () => void }) => {
      assert.ok(data.plan);
      const plan = data.plan;
      changes.push(input);
      setSaving(true);
      const complete = () => {
        setSaving(false);
        if (saveFailure) { setSaveError("Could not save price. Try again."); return; }
        setSaveError(undefined);
        if (input.action === "disable") persisted = { plan: null };
        else if (input.action === "unfreeze") persisted = { ...data, plan: { ...plan, frozenAt: null, root: null } };
        else if (input.action === "configure") persisted = { ...data, plan: { ...plan, config: input.config } };
        else if (input.action === "discard-allowlist") persisted = { ...data, pendingUpdate: null };
        else if (input.action === "assign") {
          const entries = [...(data.pendingUpdate?.entries ?? data.entries ?? [])];
          for (const walletAddress of input.wallets) {
            const previous = entries.find((entry) => entry.walletAddress === walletAddress);
            if (previous) previous.tier = input.tier;
            else entries.push({ walletAddress, tier: input.tier, requestedTier: "PENDING" });
          }
          persisted = deployed
            ? { ...data, pendingUpdate: { root: `0x${"a".repeat(64)}`, guaranteedAllocation: entries.filter((entry) => entry.tier === "ULTIMATE").length * plan.config.ultimateLimit, entries } }
            : { ...data, entries };
        } else if (input.action === "freeze") persisted = { ...data, plan: { ...plan, frozenAt: new Date().toISOString() } };
        else {
          assert.ok(input.tier === "ULTIMATE" || input.tier === "FCFS");
          const key = input.tier === "ULTIMATE" ? "ultimatePrice" : "fcfsPrice";
          persisted = { ...data, plan: { ...plan, config: { ...plan.config, [key]: input.price } } };
        }
        setData(persisted);
        options?.onSuccess?.();
      };
      if (deferSave) finishSave = complete;
      else complete();
    },
  } as unknown as PanelProps["access"];
  return React.createElement(MintAccessPanel, { access, isOwner, deployed, supportsManagement, managementBusy, deploymentPending, walletCap: 4, publicPrice: collectionPrice, onChange: () => { refreshes++; }, onPublishAllowlist: async (pending) => {
    publishedUpdates.push(pending);
    if (publishFailure) throw new Error("The confirmed whitelist transaction could not be saved. Retry verification.");
    setData((value) => ({ ...value, entries: value.pendingUpdate?.entries, pendingUpdate: null }));
  } });
}

beforeEach(() => {
  changes = []; refreshes = 0; saveFailure = false; deferSave = false; finishSave = undefined;
  publishedUpdates = []; publishFailure = false;
  persisted = {
    plan: {
      config: {
        ultimateStart: "2027-01-01T10:00:00.000Z", fcfsStart: "2027-01-01T11:00:00.000Z", publicStart: "2027-01-01T12:00:00.000Z",
        ultimateLimit: 1, fcfsLimit: 2, publicLimit: 3, ultimatePrice: "1", fcfsPrice: "2",
      },
      root: null, frozenAt: null, registrations: 0,
    },
    entries: [],
  };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });

async function render(options: Options = {}) {
  await act(async () => { renderer = create(React.createElement(Harness, options)); });
}
function editButton(tier: "Guaranteed" | "FCFS") {
  return renderer!.root.findAllByType("button").find((node) => node.props["aria-label"] === `Edit ${tier} price`);
}
function priceForm(tier: "Guaranteed" | "FCFS") {
  return renderer!.root.findAllByType("form").find((node) => node.props["aria-label"] === `Edit ${tier} price`);
}
function buttonWithText(label: string) {
  const button = renderer!.root.findAllByType("button").find((node) => node.children.filter((child) => typeof child === "string").join("") === label);
  assert.ok(button, `Missing button: ${label}`);
  return button;
}
function visibleText(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null = renderer!.toJSON()): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(visibleText).join("");
  return node?.children?.map((child) => visibleText(child)).join("") ?? "";
}
async function openPrice(tier: "Guaranteed" | "FCFS") {
  const button = editButton(tier);
  assert.ok(button, `Missing ${tier} price editor`);
  await act(async () => button.props.onClick());
  const form = priceForm(tier);
  assert.ok(form, `Missing ${tier} price form`);
  return form;
}

test("creators save each phase price independently and reopen the persisted value", async () => {
  await render();
  const originalConfig = { ...persisted.plan!.config };
  for (const [tier, value, expected] of [
    ["Guaranteed", "0.5", { ultimatePrice: "0.5", fcfsPrice: "2" }],
    ["FCFS", "1.75", { ultimatePrice: "0.5", fcfsPrice: "1.75" }],
  ] as const) {
    const form = await openPrice(tier);
    const input = form.findByType("input");
    assert.equal(input.props.name, "price");
    assert.equal(input.props["aria-label"], `${tier} price in USDC`);
    assert.equal(input.props.value, tier === "Guaranteed" ? "1" : "2");
    await act(async () => input.props.onChange({ target: { value } }));
    const save = priceForm(tier)!.findAllByType("button").find((node) => node.children.filter((child) => typeof child === "string").join("") === `Save ${tier} price`);
    assert.ok(save);
    assert.equal(save.props.type ?? "submit", "submit");
    await act(async () => priceForm(tier)!.props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(changes.at(-1), { action: "price", tier: tier === "Guaranteed" ? "ULTIMATE" : "FCFS", price: value });
    assert.deepEqual(persisted.plan!.config, { ...originalConfig, ...expected });
    assert.equal(priceForm(tier), undefined, "successful saving closes the editor");
    assert.ok(refreshes > 0, "successful saving refreshes the collection");
    const reopened = await openPrice(tier);
    assert.equal(reopened.findByType("input").props.value, value, "reopening uses the saved price");
  }
  assert.equal(changes.length, 2);
  assert.equal(renderer!.root.findAllByType("button").some((node) => /Edit Public price/i.test(node.props["aria-label"] ?? "")), false);
  assert.equal(renderer!.root.findAllByType("input").some((node) => node.props.name === "publicPrice" && !node.props.readOnly), false);
  assert.match(visibleText(), /3 USDC/, "Public still displays the collection's main price");
});

test("creators must save or cancel a price draft before locking the allowlist", async () => {
  await render();
  const lock = () => buttonWithText("Lock allowlist for deployment");
  assert.equal(lock().props.disabled, false);
  const form = await openPrice("Guaranteed");
  assert.equal(lock().props.disabled, true);
  await act(async () => form.findByType("input").props.onChange({ target: { value: "0.75" } }));
  assert.equal(lock().props.disabled, true);
  await act(async () => priceForm("Guaranteed")!.props.onSubmit({ preventDefault() {} }));
  assert.equal(lock().props.disabled, false, "successful saving permits locking");
  assert.equal(persisted.plan!.config.ultimatePrice, "0.75");

  const reopened = await openPrice("Guaranteed");
  await act(async () => reopened.findByType("input").props.onChange({ target: { value: "0.25" } }));
  assert.equal(lock().props.disabled, true);
  await act(async () => buttonWithText("Cancel").props.onClick());
  assert.equal(lock().props.disabled, false, "cancelling permits locking");
  assert.equal(changes.length, 1, "cancelling does not save a draft");
  assert.equal(persisted.plan!.config.ultimatePrice, "0.75");
  assert.equal((await openPrice("Guaranteed")).findByType("input").props.value, "0.75", "cancelled input cannot replace the saved price");
});

test("full phase settings must be closed before locking and keep Public pricing read-only", async () => {
  await render();
  await act(async () => buttonWithText("Edit phase settings").props.onClick());
  assert.equal(buttonWithText("Lock allowlist for deployment").props.disabled, true);
  assert.equal(renderer!.root.findByProps({ "aria-label": "Guaranteed price in USDC" }).props.value, "1");
  assert.equal(renderer!.root.findByProps({ "aria-label": "FCFS price in USDC" }).props.value, "2");
  const publicInput = renderer!.root.findByProps({ "aria-label": "Public price in USDC" });
  assert.equal(publicInput.props.readOnly, true);
  assert.equal(publicInput.props.value, publicPrice);
  await act(async () => buttonWithText("Cancel phase settings").props.onClick());
  assert.equal(buttonWithText("Lock allowlist for deployment").props.disabled, false);
  assert.equal(renderer!.root.findAllByType("form").length, 0);
  assert.deepEqual(changes, []);
});

test("a failed price save retains the draft for retry and keeps locking disabled", async () => {
  await render();
  const form = await openPrice("FCFS");
  await act(async () => form.findByType("input").props.onChange({ target: { value: "1.5" } }));
  saveFailure = true;
  await act(async () => priceForm("FCFS")!.props.onSubmit({ preventDefault() {} }));
  assert.equal(priceForm("FCFS")!.findByType("input").props.value, "1.5");
  assert.equal(persisted.plan!.config.fcfsPrice, "2");
  assert.match(visibleText(), /Could not save price\. Try again\./);
  assert.equal(buttonWithText("Lock allowlist for deployment").props.disabled, true);
  assert.equal(refreshes, 0);

  saveFailure = false;
  await act(async () => priceForm("FCFS")!.props.onSubmit({ preventDefault() {} }));
  assert.equal(priceForm("FCFS"), undefined);
  assert.equal(buttonWithText("Lock allowlist for deployment").props.disabled, false);
  assert.equal(persisted.plan!.config.fcfsPrice, "1.5");
  assert.equal(persisted.plan!.config.ultimatePrice, "1");
  assert.equal(changes.length, 2);
  assert.equal(refreshes, 1);
});

for (const editor of ["price", "phase settings"] as const) {
  test(`returning to public-only mint closes the ${editor} editor`, async () => {
    await render();
    if (editor === "price") {
      const form = await openPrice("Guaranteed");
      await act(async () => form.findByType("input").props.onChange({ target: { value: "0.25" } }));
    } else await act(async () => buttonWithText("Edit phase settings").props.onClick());

    await act(async () => buttonWithText("Return to public-only mint").props.onClick());
    assert.deepEqual(changes, [{ action: "disable" }], "returning to public-only does not save an open draft");
    assert.equal(persisted.plan, null);
    assert.equal(renderer!.root.findAllByType("form").length, 0, "removed phases cannot leave an editor open");
    assert.equal(editButton("Guaranteed"), undefined);
    assert.equal(editButton("FCFS"), undefined);
    assert.ok(buttonWithText("Set up allowlist phases"));
    assert.equal(refreshes, 1);
  });
}

test("a pending price save disables edits and prevents duplicate submissions", async () => {
  await render();
  const form = await openPrice("FCFS");
  await act(async () => form.findByType("input").props.onChange({ target: { value: "1.5" } }));
  deferSave = true;
  await act(async () => priceForm("FCFS")!.props.onSubmit({ preventDefault() {} }));

  assert.equal(priceForm("FCFS")!.findByType("input").props.disabled, true);
  for (const label of ["Save FCFS price", "Cancel", "Edit phase settings", "Lock allowlist for deployment", "Return to public-only mint"]) {
    assert.equal(buttonWithText(label).props.disabled, true, `${label} must wait for the pending save`);
  }
  assert.equal(editButton("Guaranteed")!.props.disabled, true);
  assert.equal(editButton("FCFS")!.props.disabled, true);
  assert.equal(persisted.plan!.config.fcfsPrice, "2");
  await act(async () => priceForm("FCFS")!.props.onSubmit({ preventDefault() {} }));
  assert.equal(changes.length, 1, "pending submission cannot submit the same draft twice");

  assert.ok(finishSave);
  await act(async () => finishSave!());
  assert.equal(priceForm("FCFS"), undefined);
  assert.equal(persisted.plan!.config.fcfsPrice, "1.5");
  assert.equal(buttonWithText("Lock allowlist for deployment").props.disabled, false);
  assert.equal(refreshes, 1);
});

for (const [label, options] of [
  ["a locked allowlist", { frozen: true }],
  ["a deployed collection", { deployed: true }],
  ["a collector", { isOwner: false }],
] as const) {
  test(`separate price editing is unavailable for ${label}`, async () => {
    await render(options);
    assert.equal(editButton("Guaranteed"), undefined);
    assert.equal(editButton("FCFS"), undefined);
    assert.equal(renderer!.root.findAllByType("form").length, 0);
    assert.deepEqual(changes, []);
    assert.match(visibleText(), /3 USDC/);
  });
}

test("FCFS accepts the screenshot price above Public and requires at least the Guaranteed price", async () => {
  await render({ publicPrice: 1 });
  const form = await openPrice("FCFS");
  const price = form.findByType("input");
  assert.equal(price.props.min, "1");
  assert.ok(Number(price.props.max) >= 2, "FCFS 2 must not be capped at the public price of 1");
  assert.equal(price.props.value, "2");
  await act(async () => form.props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(changes, [{ action: "price", tier: "FCFS", price: "2" }]);
  assert.equal(persisted.plan!.config.ultimatePrice, "1");
  const guaranteed = (await openPrice("Guaranteed")).findByType("input");
  assert.equal(guaranteed.props.max, 1, "Guaranteed cannot exceed Public even when FCFS is higher");
});

test("one chosen start derives exclusive one-hour Guaranteed and FCFS windows", async () => {
  await render();
  await act(async () => buttonWithText("Edit phase settings").props.onClick());
  const start = renderer!.root.findByProps({ "aria-label": "Guaranteed opens" });
  await act(async () => start.props.onChange({ target: { value: "2027-03-01T09:15" } }));
  const fcfs = renderer!.root.findByProps({ "aria-label": "FCFS opens" });
  const publicStart = renderer!.root.findByProps({ "aria-label": "Public opens" });
  assert.equal(fcfs.props.readOnly, true);
  assert.equal(publicStart.props.readOnly, true);
  assert.equal(new Date(fcfs.props.value).getTime() - new Date(start.props.value).getTime(), 3_600_000);
  assert.equal(new Date(publicStart.props.value).getTime() - new Date(start.props.value).getTime(), 7_200_000);
  assert.equal(renderer!.root.findAllByType("input").filter((node) => node.props.type === "datetime-local" && !node.props.readOnly).length, 1);
  const fields: Record<string, string> = { ultimateStart: start.props.value, ultimateLimit: "1", fcfsLimit: "2", publicLimit: "3", ultimatePrice: "1", fcfsPrice: "4" };
  const previous = globalThis.FormData;
  try {
    Object.defineProperty(globalThis, "FormData", { configurable: true, value: class { get(name: string) { return fields[name]; } } });
    await act(async () => renderer!.root.findByProps({ "aria-label": "Mint phase settings" }).props.onSubmit({ preventDefault() {}, currentTarget: {} }));
  } finally { Object.defineProperty(globalThis, "FormData", { configurable: true, value: previous }); }
  const saved = changes.at(-1);
  assert.ok(saved?.action === "configure");
  assert.equal(Date.parse(saved.config.fcfsStart) - Date.parse(saved.config.ultimateStart), 3_600_000);
  assert.equal(Date.parse(saved.config.publicStart) - Date.parse(saved.config.fcfsStart), 3_600_000);
  assert.equal(saved.config.fcfsPrice, "4");
  assert.match(visibleText(), /Only Guaranteed wallets/);
  assert.match(visibleText(), /Only FCFS wallets/);
  assert.match(visibleText(), /until the creator closes/);
});

test("creator can add wallets after creation and explicitly publish staged whitelist changes", async () => {
  await render({ deployed: true, supportsManagement: true });
  const wallet = `0x${"2".repeat(40)}`;
  assert.match(visibleText(), /Update whitelist wallets/);
  await act(async () => renderer!.root.findByProps({ "aria-label": "Whitelist wallet addresses" }).props.onChange({ target: { value: wallet } }));
  await act(async () => renderer!.root.findByProps({ "aria-label": "Assign whitelist tier" }).props.onChange({ target: { value: "ULTIMATE" } }));
  await act(async () => buttonWithText("Save whitelist changes").props.onClick());
  assert.deepEqual(changes, [{ action: "assign", tier: "ULTIMATE", wallets: [wallet] }]);
  assert.deepEqual(persisted.entries, [], "editing stages the roster without changing the active list");
  assert.equal(persisted.pendingUpdate!.guaranteedAllocation, 1);
  assert.equal(renderer!.root.findByProps({ "aria-label": `Tier for ${wallet}` }).props.value, "ULTIMATE");
  assert.equal(publishedUpdates.length, 0, "staging cannot send a wallet transaction automatically");
  await act(async () => buttonWithText("Publish whitelist update").props.onClick());
  assert.equal(publishedUpdates.length, 1);
  assert.equal(publishedUpdates[0].root, persisted.pendingUpdate!.root);
  assert.doesNotMatch(visibleText(), /Unpublished whitelist changes/);
});

test("a failed whitelist publication retains staged changes and exposes the error", async () => {
  persisted.pendingUpdate = { root: `0x${"b".repeat(64)}`, guaranteedAllocation: 1, entries: [{ walletAddress: `0x${"3".repeat(40)}`, tier: "ULTIMATE", requestedTier: "PENDING" }] };
  publishFailure = true;
  await render({ deployed: true, supportsManagement: true });
  await act(async () => buttonWithText("Publish whitelist update").props.onClick());
  assert.match(visibleText(), /Unpublished whitelist changes/);
  assert.match(visibleText(), /Retry verification/);
  assert.equal(buttonWithText("Publish whitelist update").props.disabled, false);
  assert.deepEqual(changes, []);
});

test("whitelist edits close at Guaranteed start while saved updates remain visible for recovery", async () => {
  persisted.plan!.config.ultimateStart = "2020-01-01T00:00:00.000Z";
  persisted.pendingUpdate = { root: `0x${"c".repeat(64)}`, guaranteedAllocation: 1, entries: [{ walletAddress: `0x${"3".repeat(40)}`, tier: "ULTIMATE", requestedTier: "PENDING" }] };
  await render({ deployed: true, supportsManagement: true });
  assert.equal(renderer!.root.findAllByType("textarea").length, 0);
  assert.equal(buttonWithText("Publish whitelist update").props.disabled, true);
  assert.match(visibleText(), /verify its saved transaction below/);
  assert.match(visibleText(), /Minting has started/);
});

test("legacy collections do not offer unsupported whitelist transactions", async () => {
  await render({ deployed: true, supportsManagement: false });
  assert.equal(renderer!.root.findAllByType("textarea").length, 0);
  assert.equal(renderer!.root.findAllByType("button").some((node) => node.children.includes("Publish whitelist update")), false);
  assert.match(visibleText(), /This collection’s whitelist is fixed/);
  assert.doesNotMatch(visibleText(), /Only FCFS wallets can mint during the next hour/);
});

test("unlocking an undeployed setup requires confirmation before restoring schedule and wallet editing", async () => {
  await render({ frozen: true });
  const original = { ...persisted.plan!.config };
  assert.equal(editButton("Guaranteed"), undefined);
  await act(async () => buttonWithText("Unlock setup").props.onClick());
  assert.deepEqual(changes, [], "opening the warning cannot change the locked plan");
  assert.equal(editButton("Guaranteed"), undefined);
  assert.match(visibleText(), /submitted.*transaction|transaction.*submitted/i, "the warning explains why a submitted deployment must be recovered first");
  await act(async () => buttonWithText("Unlock schedule and whitelist").props.onClick());
  assert.deepEqual(changes, [{ action: "unfreeze" }]);
  assert.equal(persisted.plan!.frozenAt, null);
  assert.equal(persisted.plan!.root, null);
  assert.deepEqual(persisted.plan!.config, original, "unlocking preserves the saved draft until the creator edits it");
  assert.ok(editButton("Guaranteed"));
  assert.ok(buttonWithText("Edit phase settings"));
  assert.equal(refreshes, 1);
});

test("a pending deployment disables both stages of unlocking a saved setup", async () => {
  await render({ frozen: true, deploymentPending: true });
  assert.equal(buttonWithText("Unlock setup").props.disabled, true);
  assert.deepEqual(changes, []);
  await act(async () => renderer!.update(React.createElement(Harness, { frozen: true, deploymentPending: false })));
  await act(async () => buttonWithText("Unlock setup").props.onClick());
  assert.equal(buttonWithText("Unlock schedule and whitelist").props.disabled, false);
  await act(async () => renderer!.update(React.createElement(Harness, { frozen: true, deploymentPending: true })));
  assert.equal(buttonWithText("Unlock schedule and whitelist").props.disabled, true);
  assert.deepEqual(changes, [], "a pending deployment cannot unlock the settings beneath its transaction");
});

for (const [label, options] of [
  ["deployed collections", { frozen: true, deployed: true }],
  ["collectors", { frozen: true, isOwner: false }],
] as const) test(`unlock setup is unavailable for ${label}`, async () => {
  await render(options);
  assert.equal(renderer!.root.findAllByType("button").some((node) => node.children.includes("Unlock setup")), false);
  assert.equal(renderer!.root.findAllByType("button").some((node) => node.children.includes("Unlock schedule and whitelist")), false);
  assert.deepEqual(changes, []);
});
