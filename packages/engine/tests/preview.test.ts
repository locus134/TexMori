import { it, expect } from "vitest";
import { PreviewCache } from "../src/preview";
it("rejects old results arriving after a new selection and isolates cache keys", async () => {
  const cache = new PreviewCache<{ value: string }>();
  let finish!: (x: { value: string }) => void;
  const old = cache.request(
    "source:key-A",
    1,
    () => new Promise((r) => (finish = r)),
    new AbortController().signal,
  );
  const latest = await cache.request(
    "source:key-B",
    2,
    async () => ({ value: "new" }),
    new AbortController().signal,
  );
  finish({ value: "old" });
  await expect(old).rejects.toThrow(/过期/);
  expect(latest.value).toBe("new");
  expect(
    (
      await cache.request(
        "source:key-B",
        3,
        async () => ({ value: "wrong" }),
        new AbortController().signal,
      )
    ).value,
  ).toBe("new");
  await expect(
    cache.request(
      "aborted",
      4,
      async () => ({ value: "x" }),
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
});
