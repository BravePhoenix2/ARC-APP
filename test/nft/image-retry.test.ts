import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useImageRetry } from "../../hooks/useImageRetry";

const upload = "/api/uploads/c123456789012345678901234";

function fixture() {
  let observed!: ReturnType<typeof useImageRetry>;
  let renderer: ReactTestRenderer | undefined;
  function Probe({ source }: { source: string | null }) { observed = useImageRetry(source); return null; }
  return {
    get image() { return observed; },
    async render(source: string | null = upload) {
      await act(async () => {
        const element = React.createElement(Probe, { source });
        if (renderer) renderer.update(element);
        else renderer = create(element);
      });
    },
    async unmount() { await act(async () => { renderer?.unmount(); }); },
  };
}

test("image failures retry with backoff twice and then offer a manual attempt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const view = fixture();
  try {
    await view.render();
    assert.equal(view.image.src, upload);
    const initialKey = view.image.imageKey;
    act(() => view.image.onError());
    assert.equal(view.image.failed, true);
    assert.equal(view.image.retrying, true);
    act(() => { t.mock.timers.tick(599); });
    assert.equal(view.image.imageKey, initialKey);
    act(() => { t.mock.timers.tick(1); });
    assert.equal(view.image.failed, false);
    assert.notEqual(view.image.imageKey, initialKey);
    assert.match(view.image.src, /_artic_retry=1/);
    act(() => view.image.onError());
    act(() => { t.mock.timers.tick(1_500); });
    act(() => view.image.onError());
    assert.equal(view.image.failed, true);
    assert.equal(view.image.retrying, false);
    const exhaustedKey = view.image.imageKey;
    act(() => { t.mock.timers.tick(60_000); });
    assert.equal(view.image.imageKey, exhaustedKey);
    act(() => view.image.retry());
    assert.equal(view.image.failed, false);
    assert.notEqual(view.image.imageKey, exhaustedKey);
    act(() => view.image.onError());
    assert.equal(view.image.retrying, true);
  } finally { await view.unmount(); }
});

test("a new source cancels pending retries and ignores events from the previous image", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const view = fixture();
  try {
    await view.render();
    const staleError = view.image.onError;
    act(() => view.image.onError());
    const nextSource = "https://images.example/art.png?signature=keep%2Bthis#art";
    await view.render(nextSource);
    const nextKey = view.image.imageKey;
    assert.equal(view.image.src, nextSource);
    assert.equal(view.image.failed, false);
    act(() => staleError());
    act(() => { t.mock.timers.tick(60_000); });
    assert.equal(view.image.imageKey, nextKey);
    assert.equal(view.image.failed, false);
    act(() => view.image.onError());
    act(() => { t.mock.timers.tick(600); });
    assert.notEqual(view.image.imageKey, nextKey);
    assert.equal(view.image.src, nextSource, "external signed URLs stay byte-for-byte unchanged");
  } finally { await view.unmount(); }
});

test("a successful load or unmount cancels the scheduled retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const view = fixture();
  await view.render();
  act(() => view.image.onError());
  const key = view.image.imageKey;
  act(() => view.image.onLoad());
  act(() => { t.mock.timers.tick(60_000); });
  assert.equal(view.image.imageKey, key);
  assert.equal(view.image.failed, false);
  act(() => view.image.onError());
  await view.unmount();
  act(() => { t.mock.timers.tick(60_000); });
  assert.equal(view.image.imageKey, key);
});
