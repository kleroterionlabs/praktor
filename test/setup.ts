import { setupServer } from "msw/node";
// test/setup.ts — unit tests run fully offline. Any unmocked network call fails the test.
import { afterAll, afterEach, beforeAll } from "vitest";

/** Shared MSW server; individual tests register handlers via `server.use(...)`. */
export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
