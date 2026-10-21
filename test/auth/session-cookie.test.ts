import assert from "node:assert/strict";
import { test } from "node:test";
import { localHttpSessionOrigin, secureSessionCookie } from "../../lib/sessionCookie";

test("compiled local runs support HTTP cookies only with an explicit loopback origin", () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, ARTIQ_LOCAL_HTTP_ORIGIN: process.env.ARTIQ_LOCAL_HTTP_ORIGIN };
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.ARTIQ_LOCAL_HTTP_ORIGIN;
    assert.equal(secureSessionCookie(), true);
    for (const value of ["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"]) {
      process.env.ARTIQ_LOCAL_HTTP_ORIGIN = value;
      assert.equal(localHttpSessionOrigin(), value); assert.equal(secureSessionCookie(), false);
    }
    for (const value of ["http://example.com", "http://localhost.attacker.example", "https://localhost:3000", "http://user:password@localhost:3000", "http://localhost:3000/path", "http://localhost:3000/", "invalid"]) {
      process.env.ARTIQ_LOCAL_HTTP_ORIGIN = value;
      assert.equal(localHttpSessionOrigin(), null); assert.equal(secureSessionCookie(), true);
    }
    Object.assign(process.env, { NODE_ENV: "development" }); delete process.env.ARTIQ_LOCAL_HTTP_ORIGIN;
    assert.equal(secureSessionCookie(), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
