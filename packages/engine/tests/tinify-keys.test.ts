import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TinifyKeys } from "../src/tinify-keys";
it("stores local keys privately and restores without exposing them in status", async () => {
 const dir=await mkdtemp(path.join(os.tmpdir(),"tinify-local-"));
 try {
  const file=path.join(dir,"keys.json"),store=new TinifyKeys(file);
  await store.add("private-key-one");await store.add("private-key-one");await store.add("private-key-two");
  expect(store.secrets()).toEqual(["private-key-one","private-key-two"]);
  expect(JSON.parse(await readFile(file,"utf8"))).toEqual(store.status().map((s,i)=>({id:s.id,key:["private-key-one","private-key-two"][i]})));
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(store.status())).not.toContain("private-key");
  const restored=new TinifyKeys(file);await restored.load();expect(restored.secrets()).toEqual(store.secrets());
  await restored.remove(restored.status()[0].id);
  const next=new TinifyKeys(file);await next.load();expect(next.secrets()).toEqual(["private-key-two"]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it("rejects invalid storage without leaking secrets or overwriting the file", async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"tinify-invalid-"));
 try {
  const file=path.join(dir,"keys.json"),raw=JSON.stringify([{id:"id",key:"secret with spaces"}]);
  await writeFile(file,raw);await expect(new TinifyKeys(file).load()).rejects.toThrow("无法读取已保存的 TinyPNG API Key");
  expect(await readFile(file,"utf8")).toBe(raw);
 }finally{await rm(dir,{recursive:true,force:true});}
});
