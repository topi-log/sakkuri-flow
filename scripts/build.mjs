import { rm, cp } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const target = new URL("dist/", root);
await rm(target, { recursive: true, force: true });
await cp(new URL("public/", root), target, { recursive: true });
for (const entry of ["app.js", "usability.js"]) {
  await cp(new URL(".build/" + entry, root), new URL(entry, target));
}
console.log("Built dist/");
