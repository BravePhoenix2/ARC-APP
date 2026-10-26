import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React, { useState } from "react";
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import ts from "typescript";
import type MintAccessPanelComponent from "../../components/MintAccessPanel";
import type { MintAccessData } from "../../hooks/useMintAccess";

type PanelProps = React.ComponentProps<typeof MintAccessPanelComponent>;
type PriceChange = { action: "price"; tier: "ULTIMATE" | "FCFS"; price: string };
type Change = PriceChange | { action: "disable" };
type Options = { isOwner?: boolean; deployed?: boolean; frozen?: boolean };
const require = createRequire(import.meta.url);
const publicPrice = 3;
let renderer: ReactTestRenderer | undefined;
let persisted: MintAccessData;
let changes: Change[];
let refreshes: number;
let saveFailure: boolean;
let deferSave: boolean;
let finishSave: (() => void) | undefined;

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

function Harness({ isOwner = true, deployed = false, frozen = false }: Options) {
  const [data, setData] = useState<MintAccessData>(() => ({
    ...persisted,
    plan: persisted.plan && { ...persisted.plan, frozenAt: frozen ? "2026-10-23T12:00:00.000Z" : null },
  }));
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const access = {
    data, isLoading: false, isError: false, error: null, saving, saveError,
    save: (input: Change, options?: { onSuccess?: () => void }) => {
      assert.ok(input.action === "price" || input.action === "disable");
      assert.ok(data.plan);
      const plan = data.plan;
      changes.push(input);
      setSaving(true);
      const complete = () => {
        setSaving(false);
        if (saveFailure) { setSaveError("Could not save price. Try again."); return; }
        setSaveError(undefined);
        if (input.action === "disable") persisted = { plan: null };
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
  return React.createElement(MintAccessPanel, { access, isOwner, deployed, walletCap: 4, publicPrice, onChange: () => { refreshes++; } });
}

beforeEach(() => {
  changes = []; refreshes = 0; saveFailure = false; deferSave = false; finishSave = undefined;
  persisted = {
    plan: {
      config: {
        ultimateStart: "2027-01-01T10:00:00.000Z", fcfsStart: "2027-01-02T10:00:00.000Z", publicStart: "2027-01-03T10:00:00.000Z",
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
function editButton(tier: "Ultimate" | "FCFS") {
  return renderer!.root.findAllByType("button").find((node) => node.props["aria-label"] === `Edit ${tier} price`);
}
function priceForm(tier: "Ultimate" | "FCFS") {
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
async function openPrice(tier: "Ultimate" | "FCFS") {
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
    ["Ultimate", "0.5", { ultimatePrice: "0.5", fcfsPrice: "2" }],
    ["FCFS", "1.75", { ultimatePrice: "0.5", fcfsPrice: "1.75" }],
  ] as const) {
    const form = await openPrice(tier);
    const input = form.findByType("input");
    assert.equal(input.props.name, "price");
    assert.equal(input.props["aria-label"], `${tier} price in USDC`);
    assert.equal(input.props.value, tier === "Ultimate" ? "1" : "2");
    await act(async () => input.props.onChange({ target: { value } }));
    const save = priceForm(tier)!.findAllByType("button").find((node) => node.children.filter((child) => typeof child === "string").join("") === `Save ${tier} price`);
    assert.ok(save);
    assert.equal(save.props.type ?? "submit", "submit");
    await act(async () => priceForm(tier)!.props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(changes.at(-1), { action: "price", tier: tier === "Ultimate" ? "ULTIMATE" : "FCFS", price: value });
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
  const form = await openPrice("Ultimate");
  assert.equal(lock().props.disabled, true);
  await act(async () => form.findByType("input").props.onChange({ target: { value: "0.75" } }));
  assert.equal(lock().props.disabled, true);
  await act(async () => priceForm("Ultimate")!.props.onSubmit({ preventDefault() {} }));
  assert.equal(lock().props.disabled, false, "successful saving permits locking");
  assert.equal(persisted.plan!.config.ultimatePrice, "0.75");

  const reopened = await openPrice("Ultimate");
  await act(async () => reopened.findByType("input").props.onChange({ target: { value: "0.25" } }));
  assert.equal(lock().props.disabled, true);
  await act(async () => buttonWithText("Cancel").props.onClick());
  assert.equal(lock().props.disabled, false, "cancelling permits locking");
  assert.equal(changes.length, 1, "cancelling does not save a draft");
  assert.equal(persisted.plan!.config.ultimatePrice, "0.75");
  assert.equal((await openPrice("Ultimate")).findByType("input").props.value, "0.75", "cancelled input cannot replace the saved price");
});

test("full phase settings must be closed before locking and keep Public pricing read-only", async () => {
  await render();
  await act(async () => buttonWithText("Edit phase settings").props.onClick());
  assert.equal(buttonWithText("Lock allowlist for deployment").props.disabled, true);
  assert.equal(renderer!.root.findByProps({ "aria-label": "Ultimate price in USDC" }).props.defaultValue, "1");
  assert.equal(renderer!.root.findByProps({ "aria-label": "FCFS price in USDC" }).props.defaultValue, "2");
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
      const form = await openPrice("Ultimate");
      await act(async () => form.findByType("input").props.onChange({ target: { value: "0.25" } }));
    } else await act(async () => buttonWithText("Edit phase settings").props.onClick());

    await act(async () => buttonWithText("Return to public-only mint").props.onClick());
    assert.deepEqual(changes, [{ action: "disable" }], "returning to public-only does not save an open draft");
    assert.equal(persisted.plan, null);
    assert.equal(renderer!.root.findAllByType("form").length, 0, "removed phases cannot leave an editor open");
    assert.equal(editButton("Ultimate"), undefined);
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
  assert.equal(editButton("Ultimate")!.props.disabled, true);
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
    assert.equal(editButton("Ultimate"), undefined);
    assert.equal(editButton("FCFS"), undefined);
    assert.equal(renderer!.root.findAllByType("form").length, 0);
    assert.deepEqual(changes, []);
    assert.match(visibleText(), /3 USDC/);
  });
}
