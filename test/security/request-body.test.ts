import assert from "node:assert/strict";
import { test } from "node:test";
import { limitedBody } from "../../lib/requestBody";

function streamedRequest(body: ReadableStream<Uint8Array>) {
  return new Request("http://localhost/api/uploads", { method: "POST", body, duplex: "half" } as RequestInit);
}

async function settleReader() {
  // Let Web Stream reads and the consuming async loop finish their microtasks.
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test("an idle request body times out and releases its lock without awaiting a stalled cancel", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_900_000_000_000 });
  let cancelled = false;
  const input = streamedRequest(new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
      return new Promise<void>(() => undefined);
    },
  }));
  const rejected = assert.rejects(limitedBody(input, 100, { idleMs: 10, totalMs: 100 }), /BODY_READ_TIMEOUT/);
  t.mock.timers.tick(10);
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(input.body?.locked, false);
});

test("a paced body cannot hold a slot indefinitely by sending chunks before each idle timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_900_000_000_000 });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const input = streamedRequest(new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { cancelled = true; },
  }));
  const rejected = assert.rejects(limitedBody(input, 100, { idleMs: 100, totalMs: 250 }), /BODY_READ_TIMEOUT/);
  for (let index = 0; index < 3; index++) {
    t.mock.timers.tick(80);
    controller.enqueue(new Uint8Array([index]));
    await settleReader();
  }
  t.mock.timers.tick(10);
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(input.body?.locked, false);
});

test("streaming bodies without Content-Length enforce the byte limit and accept the exact boundary", async () => {
  let cancelled = false;
  const tooLarge = streamedRequest(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
    },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); },
  }));
  assert.equal(tooLarge.headers.has("content-length"), false);
  await assert.rejects(limitedBody(tooLarge, 5), /BODY_TOO_LARGE/);
  assert.equal(cancelled, true);
  assert.equal(tooLarge.body?.locked, false);

  const exact = streamedRequest(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    },
  }));
  assert.deepEqual(await limitedBody(exact, 5), new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(exact.body?.locked, false);
});
