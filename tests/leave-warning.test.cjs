const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runtime } = require("./helpers/runtime.cjs");

function warns({ window }) {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

test("only unsaved edits request confirmation, including after undo", () => {
  const app = runtime();
  app.run("originalRender()");
  assert.equal(warns(app), false);
  app.run("checkpoint(); data.nodes[0].text = 'edited'; originalRender()");
  assert.equal(warns(app), true);
  app.run("moveHistory('undo'); originalRender()");
  assert.equal(warns(app), false);
});

test("JSON export clears the warning, but a rejected export does not", () => {
  const app = runtime();
  app.run("originalRender(); data.nodes[0].text = 'edited'; originalRender()");
  assert.equal(warns(app), true);
  assert.equal(app.run("exportJSON()"), true);
  assert.equal(warns(app), false);
  app.run("data.nodes[0].text = 'x'.repeat(1001); originalRender()");
  assert.equal(app.run("exportJSON()"), false);
  assert.equal(warns(app), true);
});

test("a title being typed counts even before the change event", () => {
  const app = runtime();
  app.run("originalRender()");
  app.ctx.titleInput = new EventTarget();
  Object.assign(app.ctx.titleInput, { isConnected: true, value: "draft" });
  app.run("trackDraft(titleInput, () => data.title)");
  app.ctx.titleInput.dispatchEvent(new Event("input"));
  assert.equal(warns(app), true);
  app.ctx.titleInput.value = "test";
  app.ctx.titleInput.dispatchEvent(new Event("input"));
  assert.equal(warns(app), false);
});
