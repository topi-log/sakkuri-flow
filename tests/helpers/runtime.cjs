const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const core = fs.readFileSync(path.join(root, ".build/app.js"), "utf8");
const extra = fs.readFileSync(path.join(root, ".build/usability.js"), "utf8");

// Evaluate the real model/render functions, without registering browser events.
function runtime() {
  const elements = new Map();
  const window = new EventTarget();
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
    window,
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
    core.slice(core.indexOf("function moveHistory("), core.indexOf("function setZoom(")),
    ctx,
  );
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
  return { ctx, elements, window, run: (code) => vm.runInContext(code, ctx) };
}
module.exports = { runtime };
