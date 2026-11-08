const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const core = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const extra = fs.readFileSync(path.join(root, "public/usability.js"), "utf8");

// Evaluate the real model/render functions, without registering browser events.
function runtime() {
  const elements = new Map();
  class Element {
    constructor() {
      this.style = {};
      this.dataset = {};
      this.clientWidth = 1280;
      this.clientHeight = 720;
      this.writes = 0;
      this.markup = "";
    }
    set innerHTML(value) {
      this.writes++;
      this.markup = value;
    }
    get innerHTML() {
      return this.markup;
    }
    setAttribute() {}
    querySelectorAll() {
      return [];
    }
  }
  const ctx = {
    structuredClone,
    Blob,
    console,
    messages: [],
    downloads: [],
    crypto: {
      randomUUID: (() => {
        let i = 0;
        return () => "test-" + ++i;
      })(),
    },
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, new Element());
        return elements.get(selector);
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(core.slice(0, core.indexOf("let laneDrag =")), ctx);
  vm.runInContext(
    core.slice(
      core.indexOf("function exportJSON("),
      core.indexOf("function download("),
    ),
    ctx,
  );
  vm.runInContext(
    extra.slice(0, extra.indexOf('$(".stage").addEventListener')),
    ctx,
  );
  vm.runInContext(
    `
    toast=message=>messages.push(message);
    download=(content,type,extension)=>downloads.push({content,type,extension});
    originalRender=render;render=()=>{};properties=()=>{};beginNameEdit=()=>{};
    data={version:1,title:'test',lanes:[{id:'a',name:'A',type:'部署'},{id:'b',name:'B',type:'部署'}],nodes:[{id:'n1',lane:'a',row:0,x:300,type:'action',text:'one'},{id:'n2',lane:'b',row:0,x:600,type:'action',text:'two'}],edges:[]};
    selected={kind:'lanes',id:'a'};
  `,
    ctx,
  );
  return { ctx, elements, run: (code) => vm.runInContext(code, ctx) };
}
function assertOrthogonal(d) {
  const points = [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map(
    (m) => ({ x: +m[1], y: +m[2] }),
  );
  assert(points.length >= 2);
  for (let i = 1; i < points.length; i++)
    assert(
      points[i - 1].x === points[i].x || points[i - 1].y === points[i].y,
      d,
    );
}
function manualEdge(r) {
  r.run(
    `data.edges=[{id:'e',from:'n1',to:'n2',fromPort:'right',toPort:'left',shape:'orthogonal',label:'',route:[{x:376,y:90},{x:450,y:90},{x:450,y:186},{x:524,y:186}]}];`,
  );
}
function drawEdge(r) {
  return r.run(
    "edgePath(port(data.nodes[0],'right'),port(data.nodes[1],'left'),'orthogonal',data.edges[0])",
  );
}

test("unchanged anchors retain the manually adjusted route", () => {
  const r = runtime();
  manualEdge(r);
  assert.equal(drawEdge(r), "M 376 90 L 450 90 L 450 186 L 524 186");
  assert(r.run("!!data.edges[0].route"));
});
for (const [label, change] of [
  ["department reorder", "moveLane(1)"],
  ["internal row count change", "data.lanes[0].rows=2"],
  ["shape size change", "data.nodes[0].type='decision'"],
  ["lane width change", "laneWidth=240"],
  ["node moved between rows", "data.lanes[0].rows=2;data.nodes[0].row=1"],
])
  test(`${label} invalidates stale manual routes and keeps right angles`, () => {
    const r = runtime();
    manualEdge(r);
    r.run(change);
    assertOrthogonal(drawEdge(r));
    assert.equal(r.run("data.edges[0].route"), undefined);
  });
for (const [kind, limit] of [
  ["lanes", 100],
  ["nodes", 2000],
  ["edges", 4000],
])
  test(`${kind} cannot be added past ${limit}`, () => {
    const r = runtime();
    r.run(`data.${kind}=Array.from({length:${limit}},()=>({}));`);
    assert.equal(r.run(`canAdd({${kind}:1})`), false);
    assert.equal(r.run(`data.${kind}.length`), limit);
    assert(r.ctx.messages.length);
  });
test("directional creation is atomic at node/edge limits", () => {
  for (const kind of ["nodes", "edges"]) {
    const r = runtime();
    r.run(
      `while(data.${kind}.length<LIMITS.${kind})data.${kind}.push({id:'filler-'+data.${kind}.length});snapshot=JSON.stringify(data)`,
    );
    r.run("createInDirection({id:'n1',side:'top'})");
    assert.equal(r.run("JSON.stringify(data)===snapshot"), true);
  }
});
test("directional creation remains exportable/importable", () => {
  const r = runtime();
  r.run("createInDirection({id:'n1',side:'right'})");
  assert.equal(r.run("data.nodes.length"), 3);
  assert.equal(r.run("exportJSON()"), true);
  assert.equal(r.run("valid(JSON.parse(downloads[0].content))"), true);
});
test("custom types stay independent even if they share a registered name", () => {
  const r = runtime();
  r.run("data.lanes[0].type='自由な種別';data.lanes[0].customType=true");
  assert.equal(r.run("getTypes().includes('自由な種別')"), false);
  assert.equal(r.run("valid(JSON.parse(JSON.stringify(data)))"), true);
  r.run("data.lanes[0].type='部署'");
  assert.equal(
    r.run(
      "data.lanes[0].customType===true||!getTypes().includes(data.lanes[0].type)",
    ),
    true,
  );
});
test("JSON exports reject oversized files explicitly instead of producing unreadable saves", () => {
  const r = runtime();
  r.run("data.nodes[0].text='x'.repeat(LIMITS.jsonBytes)");
  assert.equal(r.run("exportJSON()"), false);
  assert.equal(r.ctx.downloads.length, 0);
  assert.match(r.ctx.messages[0], /5MB/);
});
test("render parses diagram markup once and still includes edges and shapes", () => {
  const r = runtime();
  manualEdge(r);
  r.run("selected=null;originalRender()");
  const svg = r.elements.get("#diagram");
  assert.equal(svg.writes, 1);
  assert.match(svg.markup, /data-edge="e"/);
  assert.match(svg.markup, /data-node="n1"/);
});
