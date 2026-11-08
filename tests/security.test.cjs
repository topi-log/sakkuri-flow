const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { runtime } = require("./helpers/runtime.cjs");
const core = fs.readFileSync(
  path.resolve(__dirname, "../.build/app.js"),
  "utf8",
);
for (const mutation of [
  "data.nodes[0].fill={toString:null}",
  "data.nodes[0].stroke=[]",
  "data.lanes[0].fill='url(javascript:alert(1))'",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',color:{}}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',fromPort:'__proto__'}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',toPort:[]}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',shape:'constructor'}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',dash:'unknown'}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',width:'2'}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',startArrow:'true'}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',endArrow:1}]",
  "data.laneWidth={toString:null}",
  "data.lanes[0]=null",
  "data.nodes[0].text='x'.repeat(1001)",
  "data.lanes[0].name='x'.repeat(20000)",
  "data.title='x'.repeat(101)",
  "data.nodes[0].id='bad\" onload=\"x'",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',route:[{x:1e308,y:1}]}]",
  "data.edges=[{id:'e',from:'n1',to:'n2',label:'',route:[{x:1,y:-1}]}]",
])
  test("reject malformed project: " + mutation, () => {
    const r = runtime();
    r.run(mutation);
    assert.equal(r.run("valid(data)"), false);
    assert.throws(() => r.run("normalizeProject(data)"));
  });

test("unknown keys and prototype-pollution keys are not copied", () => {
  const r = runtime();
  r.run(
    `data=JSON.parse(JSON.stringify(data).slice(0,-1)+',"__proto__":{"polluted":true},"unknown":{"toString":null}}');data.nodes[0].extra={a:1};safe=normalizeProject(data)`,
  );
  assert.equal(
    r.run(
      "Object.hasOwn(safe,'__proto__')||Object.hasOwn(safe,'unknown')||Object.hasOwn(safe.nodes[0],'extra')",
    ),
    false,
  );
  assert.equal(r.run("({}).polluted"), undefined);
});
test("total displayed characters are bounded", () => {
  const r = runtime();
  r.run(
    "data.nodes=Array.from({length:101},(_,i)=>({id:'n'+i,lane:'a',x:300,type:'action',text:'x'.repeat(1000)}))",
  );
  assert.equal(r.run("valid(data)"), false);
});
test("aggregate manual route points are bounded", () => {
  const r = runtime();
  r.run(
    "data.edges=Array.from({length:101},(_,i)=>({id:'e'+i,from:'n1',to:'n2',label:'',route:Array.from({length:200},()=>({x:500,y:100}))}))",
  );
  assert.equal(r.run("valid(data)"), false);
});
test("normalization copies nested arrays, preserving legacy projects", () => {
  const r = runtime();
  r.run("safe=normalizeProject(data);safe.nodes[0].text='changed'");
  assert.equal(r.run("data.nodes[0].text"), "one");
  assert.equal(r.run("valid(safe)"), true);
});
test("text edits reject excess length and total budget without altering data", () => {
  const r = runtime();
  r.run("setText(data.nodes[0],'text','x'.repeat(1001),null,LIMITS.textChars)");
  assert.equal(r.run("data.nodes[0].text"), "one");
  r.run(
    "data.nodes=Array.from({length:100},(_,i)=>({id:'n'+i,lane:'a',x:300,type:'action',text:'x'.repeat(995)}));before=data.title;setText(data,'title','z'.repeat(1000),null,2000)",
  );
  assert.equal(r.run("data.title===before"), true);
});
test("render failure rolls back the previous project and selection", () => {
  const r = runtime();
  r.run(
    "old=data;next=structuredClone(data);next.title='candidate';selected={kind:'nodes',id:'n1'};render=()=>{if(data.title==='candidate')throw Error('render failed')}",
  );
  assert.throws(() => r.run("replaceProject(next)"));
  assert.equal(r.run("data===old"), true);
  assert.equal(r.run("selected.id"), "n1");
});
test("HTML/SVG text is encoded, rather than interpreted as markup", () => {
  const r = runtime();
  r.run(
    `attack='<script>alert(1)</script><svg onload="alert(2)">';data.title=attack;data.lanes[0].name=attack;data.nodes[0].text=attack;data.edges=[{id:'e',from:'n1',to:'n2',label:attack}];selected=null;originalRender()`,
  );
  const markup =
    r.elements.get("#diagram").markup + r.elements.get("#lanes-svg").markup;
  assert(!markup.includes("<script>"));
  assert(!markup.includes("<svg onload="));
  assert(markup.includes("&lt;script&gt;"));
  vm.runInContext(
    core.slice(
      core.indexOf("function exportHTML("),
      core.indexOf('$("#export").onclick'),
    ),
    r.ctx,
  );
  r.run("cleanExportSVG=()=>'<svg></svg>';exportHTML()");
  assert(!r.ctx.downloads[0].content.includes("<script>"));
  assert(r.ctx.downloads[0].content.includes("&lt;script&gt;"));
});
test("actual file import handler preserves data/history on rejection and renderer failure", async () => {
  for (const mode of ["invalid", "render-failure", "file-size"]) {
    const r = runtime();
    r.run("confirmAction=async()=>true;old=data;beforePast=past.length");
    r.ctx.caseMode = mode;
    r.run(
      "candidate=structuredClone(data);candidate.title='candidate';if(caseMode==='invalid')candidate.nodes[0].fill={toString:null};if(caseMode==='render-failure')render=()=>{if(data.title==='candidate')throw Error('test render failure')};file={size:caseMode==='file-size'?5000001:1000,text:async()=>JSON.stringify(candidate)}",
    );
    vm.runInContext(
      core.slice(
        core.indexOf('$("#file").onchange ='),
        core.indexOf('document.addEventListener("keydown"'),
      ),
      r.ctx,
    );
    await r.run('$("#file").onchange({target:{files:[file],value:"test"}})');
    assert.equal(r.run("data===old"), true);
    assert.equal(r.run("past.length===beforePast"), true);
    assert(r.ctx.messages.length);
  }
});
