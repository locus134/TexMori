import { expect, it } from "vitest";
import { validateRequest, type Asset } from "../src/index";
import { planOutputs } from "../src/output-plan";
const raw = {
  operation: "tinify",
  container: "png",
  options: {},
  tinify: { formats: ["png"], preserve: [] },
  output: { mode: "source", conflict: "overwrite" },
};
it("validates Tinify resize dimensions and requires a background for JPEG conversion", () => {
  expect(validateRequest(raw).operation).toBe("tinify");
  expect(() =>
    validateRequest({ ...raw, tinify: { formats: ["jpeg"] } }),
  ).toThrow();
  expect(() =>
    validateRequest({
      ...raw,
      tinify: { resize: { method: "scale", width: 20, height: 20 } },
    }),
  ).toThrow();
  expect(() =>
    validateRequest({
      ...raw,
      tinify: { resize: { method: "fit", width: 0, height: 20 } },
    }),
  ).toThrow();
  expect(() => validateRequest({ ...raw, tinify: { quality: 80 } })).toThrow();
  expect(
    validateRequest({
      ...raw,
      tinify: { formats: ["jpeg"], background: "#ffffff" },
    }).tinify?.formats,
  ).toEqual(["jpeg"]);
});
const asset = (name: string): Asset => ({
  id: name,
  name,
  path: "/in/" + name,
  root: "/in",
  relativePath: name,
  width: 100,
  height: 50,
  encodedWidth: 100,
  encodedHeight: 50,
  container: "image",
  alpha: true,
  size: 1000,
  fingerprint: name,
  encrypted: false,
});
it("keeps originals safe and reserves every possible extension for smallest-format output", () => {
  const request = validateRequest(raw);
  expect(planOutputs([asset("a.png")], request)[0].target).toBe(
    "/in/a.tiny.png",
  );
  const auto = validateRequest({
    ...raw,
    tinify: { formats: ["png", "webp"] },
    output: { mode: "source", conflict: "rename" },
  });
  const plans = planOutputs(
    [asset("a.png"), asset("a.webp")],
    auto,
    undefined,
    ["/in/a.tiny.webp"],
  );
  expect(plans.map((p) => p.target)).toEqual([
    "/in/a.tiny (2).auto",
    "/in/a.tiny (3).auto",
  ]);
});
