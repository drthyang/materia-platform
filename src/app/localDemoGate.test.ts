import { afterEach, describe, expect, it, vi } from "vitest";

/** The gate reads `import.meta.env.DEV` when its module is evaluated, so each case imports it afresh. */
async function gate(dev: boolean): Promise<typeof import("@/app/localDemoGate")> {
  vi.resetModules();
  vi.stubEnv("DEV", dev);
  return import("@/app/localDemoGate");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("local demo gate", () => {
  it("a production build offers no local demo and makes no request", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no request expected")));
    vi.stubGlobal("fetch", fetchSpy);
    const g = await gate(false);
    expect(g.loadLocalDemoModule).toBeNull();
    expect(await g.localDemoAvailable()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a dev server probes the data folder, and offers nothing when it has no files", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("Not found", { status: 404 })));
    vi.stubGlobal("fetch", fetchSpy);
    const g = await gate(true);
    expect(g.loadLocalDemoModule).not.toBeNull();
    expect(await g.localDemoAvailable()).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
