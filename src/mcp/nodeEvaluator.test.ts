import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { workerRequests, type NodeWorkerLike } from "@/mcp/nodeEvaluator";

/** A worker stand-in: posted messages are kept, events are emitted by hand. */
function fakeWorker(): NodeWorkerLike & { emitter: EventEmitter; posted: { id: number }[] } {
  const emitter = new EventEmitter();
  const posted: { id: number }[] = [];
  return {
    emitter,
    posted,
    postMessage: (msg) => void posted.push(msg as { id: number }),
    on: (event, cb) => void emitter.on(event, cb as (...a: unknown[]) => void),
    terminate: async () => 0,
  };
}

describe("the evaluator pool's requests", () => {
  it("are answered by their reply, and rejected when their worker dies, instead of waiting forever", async () => {
    const requests = workerRequests();
    const a = fakeWorker();
    const b = fakeWorker();
    requests.attach(a);
    requests.attach(b);
    const fromA = requests.post(a, { sets: [] });
    const fromB = requests.post(b, { sets: [] });
    b.emitter.emit("message", { id: b.posted[0]!.id, ok: true, results: [new Float64Array([1, 2])] });
    await expect(fromB).resolves.toEqual([new Float64Array([1, 2])]);
    a.emitter.emit("error", new Error("out of memory"));
    await expect(fromA).rejects.toThrow(/an evaluator worker stopped: out of memory/);
    // A later request to the dead worker fails at once.
    await expect(requests.post(a, { sets: [] })).rejects.toThrow(/stopped/);
    const late = requests.post(b, { sets: [] });
    b.emitter.emit("exit", 1);
    await expect(late).rejects.toThrow(/exited with code 1/);
  });
});
