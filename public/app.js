const $ = (s) => document.querySelector(s),
  NS = "http://www.w3.org/2000/svg",
  uid = () => crypto.randomUUID();
// Keep creation and JSON import/export limits in one place.
const LIMITS = Object.freeze({
  lanes: 100,
  nodes: 2000,
  edges: 4000,
  jsonBytes: 5000000,
});
function canAdd(additions) {
  for (const [kind, count] of Object.entries(additions)) {
    if (data[kind].length + count > LIMITS[kind]) {
      toast(
        { lanes: "部署・システムは", nodes: "図形は", edges: "接続線は" }[
          kind
        ] +
          LIMITS[kind] +
          "件まで追加できます",
      );
      return false;
    }
  }
  return true;
}
const initial = {
  version: 1,
  title: "untitled",
  lanes: [
    { id: "lane-1", name: "行1", type: "部署" },
    { id: "lane-2", name: "行2", type: "部署" },
    { id: "lane-3", name: "行3", type: "部署" },
  ],
  nodes: [],
  edges: [],
  customColors: [],
};
let data = structuredClone(initial),
  selected = null,
  mode = "edit",
  source = null,
  zoom = 1,
  past = [],
  future = [],
  laneWidth = 164,
  pending = null,
  reconnect = null;
function valid(d) {
  if (
    !d ||
    d.version !== 1 ||
    typeof d.title !== "string" ||
    !Array.isArray(d.lanes) ||
    d.lanes.length > LIMITS.lanes ||
    !Array.isArray(d.nodes) ||
    d.nodes.length > LIMITS.nodes ||
    !Array.isArray(d.edges) ||
    d.edges.length > LIMITS.edges
  )
    return false;
  if (
    d.customColors !== undefined &&
    (!Array.isArray(d.customColors) ||
      d.customColors.length > 256 ||
      d.customColors.some(
        (c) => typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c),
      ))
  )
    return false;
  if (
    d.types !== undefined &&
    (!Array.isArray(d.types) ||
      d.types.length > 50 ||
      d.types.some((t) => typeof t !== "string" || t.length > 100))
  )
    return false;
  const ids = new Set();
  for (const l of d.lanes) {
    if (
      typeof l.id !== "string" ||
      ids.has(l.id) ||
      typeof l.name !== "string" ||
      typeof l.type !== "string"
    )
      return false;
    if (l.customType !== undefined && typeof l.customType !== "boolean")
      return false;
    if (
      l.rows !== undefined &&
      (!Number.isInteger(l.rows) || l.rows < 1 || l.rows > 20)
    )
      return false;
    if (
      l.rowNames !== undefined &&
      (!Array.isArray(l.rowNames) ||
        l.rowNames.length > 20 ||
        l.rowNames.some((x) => typeof x !== "string"))
    )
      return false;
    ids.add(l.id);
  }
  const nodes = new Set();
  for (const n of d.nodes) {
    if (
      typeof n.id !== "string" ||
      nodes.has(n.id) ||
      !ids.has(n.lane) ||
      !Number.isFinite(n.x) ||
      n.x < 220 ||
      n.x > 100000 ||
      typeof n.text !== "string" ||
      !["action", "decision"].includes(n.type)
    )
      return false;
    if (
      n.row !== undefined &&
      (!Number.isInteger(n.row) ||
        n.row < 0 ||
        n.row >= laneRows(d.lanes.find((l) => l.id === n.lane)))
    )
      return false;
    nodes.add(n.id);
  }
  const edges = new Set();
  for (const e of d.edges) {
    if (
      typeof e.id !== "string" ||
      edges.has(e.id) ||
      !nodes.has(e.from) ||
      !nodes.has(e.to) ||
      e.from === e.to ||
      typeof e.label !== "string"
    )
      return false;
    if (
      e.route !== undefined &&
      (!Array.isArray(e.route) ||
        e.route.length > 200 ||
        e.route.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    )
      return false;
    edges.add(e.id);
  }
  return true;
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
function color(v, f) {
  return /^#[0-9a-f]{6}$/i.test(v) ? v : f;
}
function checkpoint() {
  past.push(JSON.stringify(data));
  if (past.length > 60) past.shift();
  future = [];
}
function save() {}
function laneRows(l) {
  return Math.max(1, Math.min(20, Math.floor(Number(l?.rows) || 1)));
}
function laneGeometry(l) {
  const heights = Array(laneRows(l)).fill(56);
  for (const n of data.nodes) {
    if (n.lane !== l?.id) continue;
    const row = Math.max(0, Math.min(heights.length - 1, Number(n.row) || 0));
    heights[row] = Math.max(heights[row], n.type === "decision" ? 98 : 56);
  }
  let cursor = 20;
  const centers = heights.map((height) => {
    const center = cursor + height / 2;
    cursor += height + 20;
    return center;
  });
  return { centers, heights, height: cursor };
}
function laneTop(index) {
  return (
    42 +
    data.lanes
      .slice(0, index)
      .reduce((sum, l) => sum + laneGeometry(l).height, 0)
  );
}
function placementAtY(y) {
  let index = data.lanes.findIndex((l, i) => y < laneTop(i + 1));
  if (index < 0) index = data.lanes.length - 1;
  index = Math.max(0, index);
  const lane = data.lanes[index],
    centers = laneGeometry(lane).centers,
    local = y - laneTop(index);
  let row = 0;
  for (let i = 1; i < centers.length; i++)
    if (Math.abs(local - centers[i]) < Math.abs(local - centers[row])) row = i;
  return { lane: lane?.id, row };
}
function insertionAtY(y) {
  let best = 0,
    distance = Infinity;
  for (let i = 0; i <= data.lanes.length; i++) {
    const d = Math.abs(y - laneTop(i));
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}
function pos(n) {
  const i = data.lanes.findIndex((l) => l.id === n.lane),
    row = Math.max(
      0,
      Math.min(laneRows(data.lanes[i]) - 1, Number(n.row) || 0),
    );
  return {
    x: n.x + laneWidth - 164,
    y: laneTop(i) + laneGeometry(data.lanes[i]).centers[row],
  };
}
function lines(t) {
  return String(t).match(/.{1,11}/gu) || [""];
}
function port(n, side) {
  const p = pos(n),
    hw = n.type === "decision" ? 80 : 76,
    hh = n.type === "decision" ? 49 : 28;
  return {
    nodeId: n.id,
    x: p.x + (side === "left" ? -hw : side === "right" ? hw : 0),
    y: p.y + (side === "top" ? -hh : side === "bottom" ? hh : 0),
    side,
  };
}
function edgeSides(e, a, b) {
  const p = pos(a),
    q = pos(b);
  const horizontal = Math.abs(p.x - q.x) >= Math.abs(p.y - q.y);
  return [
    e.fromPort ||
      (horizontal
        ? q.x >= p.x
          ? "right"
          : "left"
        : q.y >= p.y
          ? "bottom"
          : "top"),
    e.toPort ||
      (horizontal
        ? q.x >= p.x
          ? "left"
          : "right"
        : q.y >= p.y
          ? "top"
          : "bottom"),
  ];
}
function edgePath(p, q, shape, edge) {
  // Absolute bend coordinates are reusable only while both anchors stay put.
  if (edge?.route?.length >= 2) {
    const first = edge.route[0],
      last = edge.route.at(-1);
    if (first.x !== p.x || first.y !== p.y || last.x !== q.x || last.y !== q.y)
      delete edge.route;
  }
  if (shape === "orthogonal" && edge?.route?.length >= 2) {
    const points = [p, ...edge.route.slice(1, -1), q];
    return points.map((v, i) => `${i ? "L" : "M"} ${v.x} ${v.y}`).join(" ");
  }
  if (shape === "straight") return `M ${p.x} ${p.y} L ${q.x} ${q.y}`;
  const vec = (s) =>
      ({ top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] })[s] || [
        1, 0,
      ],
    a = vec(p.side),
    b = vec(q.side),
    gap = 24,
    pa = { x: p.x + a[0] * gap, y: p.y + a[1] * gap },
    qb = { x: q.x + b[0] * gap, y: q.y + b[1] * gap };
  const boxes = [...data.nodes]
    .sort(
      (a, b) =>
        Number(b.id === p.nodeId || b.id === q.nodeId) -
        Number(a.id === p.nodeId || a.id === q.nodeId),
    )
    .filter(
      (n) =>
        n.id === p.nodeId ||
        n.id === q.nodeId ||
        (() => {
          const c = pos(n);
          return (
            c.x > Math.min(p.x, q.x) - 120 &&
            c.x < Math.max(p.x, q.x) + 120 &&
            c.y > Math.min(p.y, q.y) - 100 &&
            c.y < Math.max(p.y, q.y) + 100
          );
        })(),
    )
    .slice(0, 24)
    .map((n) => {
      const c = pos(n),
        h = n.type === "decision" ? 49 : 28,
        w = n.type === "decision" ? 80 : 76;
      return { l: c.x - w - 8, r: c.x + w + 8, t: c.y - h - 8, b: c.y + h + 8 };
    });
  const xs = [
      ...new Set([pa.x, qb.x, ...boxes.flatMap((b) => [b.l - 1, b.r + 1])]),
    ].sort((a, b) => a - b),
    ys = [
      ...new Set([pa.y, qb.y, ...boxes.flatMap((b) => [b.t - 1, b.b + 1])]),
    ].sort((a, b) => a - b),
    ny = ys.length;
  const blocked = (x, y) =>
      boxes.some((b) => x > b.l && x < b.r && y > b.t && y < b.b),
    clear = (x, y, u, v) =>
      !boxes.some((b) =>
        x === u
          ? x > b.l && x < b.r && Math.max(y, v) > b.t && Math.min(y, v) < b.b
          : y > b.t && y < b.b && Math.max(x, u) > b.l && Math.min(x, u) < b.r,
      );
  const start = xs.indexOf(pa.x) * ny + ys.indexOf(pa.y),
    goal = xs.indexOf(qb.x) * ny + ys.indexOf(qb.y),
    dist = new Map([[start + ":0", 0]]),
    prev = new Map(),
    queue = [{ id: start, dir: 0, cost: 0 }],
    coords = (id) => ({ x: xs[Math.floor(id / ny)], y: ys[id % ny] });
  let finish = null;
  while (queue.length) {
    queue.sort((a, b) => b.cost - a.cost);
    const current = queue.pop(),
      key = current.id + ":" + current.dir;
    if (current.cost !== dist.get(key)) continue;
    if (current.id === goal) {
      finish = key;
      break;
    }
    const i = Math.floor(current.id / ny),
      j = current.id % ny,
      c = coords(current.id);
    for (const [u, v, dir] of [
      [i - 1, j, 1],
      [i + 1, j, 1],
      [i, j - 1, 2],
      [i, j + 1, 2],
    ]) {
      if (u < 0 || u >= xs.length || v < 0 || v >= ny) continue;
      const id = u * ny + v,
        n = coords(id);
      if (blocked(n.x, n.y) || !clear(c.x, c.y, n.x, n.y)) continue;
      const cost =
          current.cost +
          Math.abs(c.x - n.x) +
          Math.abs(c.y - n.y) +
          (current.dir && current.dir !== dir ? 18 : 0),
        next = id + ":" + dir;
      if (cost < (dist.get(next) ?? Infinity)) {
        dist.set(next, cost);
        prev.set(next, key);
        queue.push({ id, dir, cost });
      }
    }
  }
  let points = [];
  if (finish) {
    for (let key = finish; key; key = prev.get(key))
      points.unshift(coords(Number(key.split(":")[0])));
  } else {
    const y = Math.min(pa.y, qb.y, ...boxes.map((b) => b.t)) - 30;
    points = [pa, { x: pa.x, y }, { x: qb.x, y }, qb];
  }
  points = [p, ...points, q].filter(
    (v, i, arr) => !i || v.x !== arr[i - 1].x || v.y !== arr[i - 1].y,
  );
  for (let i = points.length - 2; i > 0; i--) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y))
      points.splice(i, 1);
  }
  if (shape !== "curve")
    return points.map((v, i) => `${i ? "L" : "M"} ${v.x} ${v.y}`).join(" ");
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1],
      d1 = Math.hypot(b.x - a.x, b.y - a.y),
      d2 = Math.hypot(c.x - b.x, c.y - b.y),
      r = Math.min(18, d1 / 2, d2 / 2),
      x = b.x + ((a.x - b.x) * r) / d1,
      y = b.y + ((a.y - b.y) * r) / d1,
      u = b.x + ((c.x - b.x) * r) / d2,
      v = b.y + ((c.y - b.y) * r) / d2;
    path += ` L ${x} ${y} Q ${b.x} ${b.y} ${u} ${v}`;
  }
  const last = points.at(-1);
  return path + ` L ${last.x} ${last.y}`;
}
function snapTarget(clientX, clientY, exclude, highlight = false) {
  const r = $("#diagram").getBoundingClientRect(),
    x = (clientX - r.left) / zoom,
    y = (clientY - r.top) / zoom;
  let best = null;
  for (const n of data.nodes) {
    if (n.id === exclude) continue;
    const p = pos(n),
      hw = n.type === "decision" ? 80 : 76,
      hh = n.type === "decision" ? 49 : 28;
    const inside =
      n.type === "decision"
        ? Math.abs(x - p.x) / hw + Math.abs(y - p.y) / hh <= 1.25
        : Math.abs(x - p.x) <= hw + 12 && Math.abs(y - p.y) <= hh + 12;
    for (const side of ["top", "right", "bottom", "left"]) {
      const point = port(n, side),
        distance = Math.hypot(x - point.x, y - point.y);
      if (
        (inside || distance < 24 / zoom) &&
        (!best || distance < best.distance)
      )
        best = { node: n, side, point, distance };
    }
  }
  if (highlight) {
    $("#snap-target")?.remove();
    if (best) {
      const g = document.createElementNS(NS, "g");
      g.id = "snap-target";
      g.setAttribute("pointer-events", "none");
      g.innerHTML = `<circle cx="${best.point.x}" cy="${best.point.y}" r="14" fill="#56afe133" stroke="#3597cc" stroke-width="1.5"/><circle cx="${best.point.x}" cy="${best.point.y}" r="6" fill="#3597cc" stroke="white" stroke-width="2"/>`;
      $("#diagram").append(g);
    }
  }
  return best;
}
function optimizeConnections(nodeId) {
  const measure = document.createElementNS(NS, "path");
  for (const e of data.edges) {
    if (e.from !== nodeId && e.to !== nodeId) continue;
    delete e.route;
    const a = data.nodes.find((n) => n.id === e.from),
      b = data.nodes.find((n) => n.id === e.to);
    if (!a || !b) continue;
    const current = edgeSides(e, a, b),
      pairs = [];
    for (const from of ["top", "right", "bottom", "left"])
      for (const to of ["top", "right", "bottom", "left"]) {
        const p = port(a, from),
          q = port(b, to);
        pairs.push({ from, to, p, q, lower: Math.hypot(p.x - q.x, p.y - q.y) });
      }
    pairs.sort((a, b) => a.lower - b.lower);
    let best = Infinity,
      winner = current;
    for (const pair of pairs) {
      if (pair.lower > best + 0.1) continue;
      measure.setAttribute(
        "d",
        edgePath(pair.p, pair.q, e.shape || "orthogonal"),
      );
      const length = measure.getTotalLength();
      if (
        length < best - 0.1 ||
        (Math.abs(length - best) <= 0.1 &&
          pair.from === current[0] &&
          pair.to === current[1])
      ) {
        best = length;
        winner = [pair.from, pair.to];
      }
    }
    [e.fromPort, e.toPort] = winner;
  }
}
function drawPending(q) {
  $("#pending-edge")?.remove();
  if (!pending) return;
  const n = data.nodes.find((n) => n.id === pending.id);
  if (!n) {
    pending = null;
    return;
  }
  const path = document.createElementNS(NS, "path");
  path.id = "pending-edge";
  path.setAttribute("d", edgePath(port(n, pending.side), q, "orthogonal"));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#3597cc");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-dasharray", "6 5");
  path.setAttribute("opacity", ".45");
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML =
    '<marker id="pending-arrow" viewBox="0 0 10 10" markerWidth="6" markerHeight="6" refX="9" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#3597cc"/></marker>';
  $("#pending-defs")?.remove();
  defs.id = "pending-defs";
  $("#diagram").append(defs);
  path.setAttribute("marker-end", "url(#pending-arrow)");
  path.setAttribute("pointer-events", "none");
  $("#diagram").append(path);
}
function exportSVG() {
  const clone = $("#diagram").cloneNode(true);
  const lanes = $("#lane-overlay")?.cloneNode(true);
  if (lanes) clone.append(lanes);
  clone
    .querySelectorAll(
      ".port,.edge-handle,.segment-handle,.lane-selection,[data-lane-drag],#pending-edge,#reconnect-preview,#snap-target,#lane-drop",
    )
    .forEach((el) => el.remove());
  return new XMLSerializer().serializeToString(clone);
}
function render() {
  data.laneWidth = laneWidth;
  const w = Math.max(
      1290,
      Math.ceil(($("#canvaswrap").clientWidth || 1290) / zoom),
      ...data.nodes.map((n) => n.x + laneWidth - 164 + 140),
      data.edges.reduce(
        (max, e) =>
          (e.route || []).reduce((value, p) => Math.max(value, p.x + 60), max),
        0,
      ),
    ),
    h = Math.max(
      data.edges.reduce(
        (max, e) =>
          (e.route || []).reduce((value, p) => Math.max(value, p.y + 60), max),
        0,
      ),
      480,
      Math.ceil(($("#canvaswrap").clientHeight || 480) / zoom),
      laneTop(data.lanes.length) + 13,
    );
  $("#title").value = data.title;
  const svg = $("#diagram");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  // Parse the diagram once; += on innerHTML reparses all previous elements.
  let markup = `<defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#dceaf2"/></pattern></defs><rect width="100%" height="100%" fill="#fbfdff"/><rect x="164" y="55" width="${w - 164}" height="${h - 55}" fill="url(#dots)"/><rect width="${w}" height="42" fill="#f1f8fc"/>`;
  const appendMarkup = (part) => {
    markup += part;
  };
  let laneMarkup = `<rect width="${laneWidth}" height="${h}" fill="#f1f8fc"/>`;
  data.lanes.forEach((l, i) => {
    const y = laneTop(i),
      geometry = laneGeometry(l),
      height = geometry.height,
      named = (l.rowNames || []).slice(0, laneRows(l)).some(Boolean),
      split = Math.round(laneWidth * 0.5);
    const bg = color(l.fill, i % 2 ? "#edf7fd" : "#f4faff"),
      rgb = bg
        .slice(1)
        .match(/../g)
        .map((c) => parseInt(c, 16)),
      dark = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 145,
      ink = dark ? "#ffffff" : "#4a6576",
      muted = dark ? "#dceaf5" : "#8b9eab";
    const nameX = 40,
      nameWidth = named ? split - nameX - 6 : laneWidth - nameX - 12,
      chars = Math.max(2, Math.floor(nameWidth / 12)),
      letters = Array.from(l.name),
      nameLines = [];
    for (let j = 0; j < letters.length; j += chars)
      nameLines.push(letters.slice(j, j + chars).join(""));
    const labelId = "lane-label-" + i;
    laneMarkup += `<defs><clipPath id="${labelId}"><rect x="${split + 8}" y="${y}" width="${laneWidth - split - 14}" height="${height}"/></clipPath></defs><rect x="0" y="${y}" width="${laneWidth}" height="${height}" fill="${bg}"/><path d="M 0 ${y + height} H ${laneWidth}" stroke="#dce9f1" stroke-width="1"/><path d="M ${laneWidth} ${y} V ${y + height}" stroke="#dce9f1"/>${
      named
        ? `<path d="M ${split} ${y} V ${y + height}" stroke="#dce9f1" stroke-width=".5"/>` +
          geometry.centers
            .slice(0, -1)
            .map(
              (center, row) =>
                `<path d="M ${split} ${y + center + geometry.heights[row] / 2 + 10} H ${laneWidth}" stroke="#dce9f1" stroke-width=".5" pointer-events="none"/>`,
            )
            .join("")
        : ""
    }<g data-lane="${escape(l.id)}" role="button" tabindex="0" aria-label="${escape(l.name)}の行設定" style="cursor:pointer"><rect x="0" y="${y}" width="${laneWidth}" height="${height}" fill="transparent"/><text x="${nameX}" y="${y + height / 2 - (nameLines.length - 1) * 8 - 18}" font-size="9" fill="${muted}">${String(i + 1).padStart(2, "0")} / ${escape(l.type)}</text><text font-size="12" fill="${ink}" font-weight="600"><title>${escape(l.name)}</title>${nameLines.map((line, j) => `<tspan x="${nameX}" y="${y + height / 2 - (nameLines.length - 1) * 8 + j * 16 + 7}">${escape(line)}</tspan>`).join("")}</text></g><g data-lane-drag="${escape(l.id)}" role="button" tabindex="0" aria-label="${escape(l.name)}を並べ替え" style="cursor:grab;touch-action:none"><title>ドラッグして並べ替え</title><rect x="10" y="${y + height / 2 - 18}" width="24" height="34" rx="4" fill="transparent"/>${[0, 1, 2].map((r) => [0, 1].map((c) => `<circle cx="${18 + c * 6}" cy="${y + height / 2 - 7 + r * 6}" r="1.4" fill="${muted}"/>`).join("")).join("")}</g>${
      named
        ? `<g clip-path="url(#${labelId})" pointer-events="none">${(
            l.rowNames || []
          )
            .slice(0, laneRows(l))
            .map((name, row) =>
              name
                ? `<text x="${split + 8}" y="${y + geometry.centers[row]}" dominant-baseline="middle" fill="${ink}" font-size="10"><title>${escape(name)}</title>${escape(name)}</text>`
                : "",
            )
            .join("")}</g>`
        : ""
    }${selected?.kind === "lanes" && selected.id === l.id ? `<rect class="lane-selection" x="1.5" y="${y + 1.5}" width="${laneWidth - 3}" height="${height - 3}" fill="none" stroke="#3597cc" stroke-width="3" pointer-events="none"/>` : ""}`;
  });
  for (let i = 0; i < data.lanes.length; i++)
    appendMarkup(
      `<path d="M ${laneWidth} ${laneTop(i + 1)} H ${w}" stroke="#dce9f1" pointer-events="none"/>`,
    );
  data.lanes.forEach((l, i) => {
    if (!(l.rowNames || []).some(Boolean)) return;
    const geometry = laneGeometry(l);
    geometry.centers
      .slice(0, -1)
      .forEach((center, row) =>
        appendMarkup(
          `<path d="M ${laneWidth} ${laneTop(i) + center + geometry.heights[row] / 2 + 10} H ${w}" stroke="#dce9f1" stroke-width=".5" pointer-events="none"/>`,
        ),
      );
  });
  data.edges.forEach((e) => {
    const a = data.nodes.find((n) => n.id === e.from),
      b = data.nodes.find((n) => n.id === e.to);
    if (!a || !b) return;
    const [fp, tp] = edgeSides(e, a, b),
      p = port(a, fp),
      q = port(b, tp),
      d = edgePath(p, q, e.shape || "orthogonal", e),
      c = color(e.color, "#222222"),
      width = Math.max(1, Math.min(12, Number(e.width) || 1.5)),
      start = e.startArrow === true,
      end = e.endArrow !== false;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    markup += `<defs><marker id="arr${escape(e.id)}" viewBox="0 0 10 10" markerWidth="7" markerHeight="7" refX="9" refY="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${c}"/></marker></defs><path data-edge="${escape(e.id)}" d="${d}" fill="none" stroke="transparent" stroke-width="18" style="cursor:pointer"/><path data-edge="${escape(e.id)}" d="${d}" fill="none" stroke="${c}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${e.dash === "dashed" ? "8 6" : e.dash === "dotted" ? "1 6" : ""}" ${start ? `marker-start="url(#arr${escape(e.id)})"` : ""} ${end ? `marker-end="url(#arr${escape(e.id)})"` : ""} style="cursor:pointer"/>${selected?.id === e.id ? `<path d="${d}" fill="none" stroke="#46a9df" stroke-width="${width + 5}" opacity=".2" pointer-events="none"/>` : ""}${e.label ? `<g data-edge="${escape(e.id)}" style="cursor:pointer"><rect x="${mid.x - Math.max(32, Array.from(e.label).length * 10 + 16) / 2}" y="${mid.y - 12}" width="${Math.max(32, Array.from(e.label).length * 10 + 16)}" height="24" rx="4" fill="${color(e.labelFill, "#ffffff")}"/><text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle" font-size="11" fill="${c}">${escape(e.label)}</text></g>` : ""}`;
  });
  data.nodes.forEach((n) => {
    let { x, y } = pos(n),
      sel = selected?.id === n.id,
      stroke = sel ? "#3597cc" : color(n.stroke, "#222222"),
      fill = color(n.fill, "#ffffff");
    markup += `<g data-node="${escape(n.id)}" style="cursor:${"grab"}">${n.type === "decision" ? `<polygon points="${x},${y - 49} ${x + 80},${y} ${x},${y + 49} ${x - 80},${y}"` : `<rect x="${x - 76}" y="${y - 28}" width="152" height="56" rx="3"`} fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>${lines(
      n.text,
    )
      .slice(0, 3)
      .map(
        (t, i, arr) =>
          `<text x="${x}" y="${y + (i - (arr.length - 1) / 2) * 17 + 4}" text-anchor="middle" fill="#293f4d" font-size="11">${escape(t)}</text>`,
      )
      .join("")}${
      mode === "edit" || reconnect
        ? ["top", "right", "bottom", "left"]
            .map((side) => {
              const p = port(n, side);
              return `<circle class="port" data-port="${side}" data-port-node="${escape(n.id)}" cx="${p.x}" cy="${p.y}" r="5" fill="#fff" stroke="#3597cc" stroke-width="2" role="button" aria-label="${escape(n.text)}の${{ top: "上", right: "右", bottom: "下", left: "左" }[side]}の接続点"/>`;
            })
            .join("")
        : ""
    }</g>`;
  });
  if (selected?.kind === "edges") {
    const e = data.edges.find((e) => e.id === selected.id);
    if (e) {
      const a = data.nodes.find((n) => n.id === e.from),
        b = data.nodes.find((n) => n.id === e.to),
        sides = edgeSides(e, a, b);
      for (const [end, n, side] of [
        ["from", a, sides[0]],
        ["to", b, sides[1]],
      ]) {
        const p = port(n, side);
        markup += `<circle class="edge-handle" data-reconnect="${end}" data-edge-id="${escape(e.id)}" cx="${p.x}" cy="${p.y}" r="7" fill="white" stroke="#3597cc" stroke-width="2" role="button" aria-label="${end === "from" ? "始点" : "終点"}をつなぎ直す"/>`;
      }
    }
  }
  svg.innerHTML = markup;
  for (const label of svg.querySelectorAll("g[data-edge]")) {
    const path = Array.from(svg.querySelectorAll("path[data-edge]")).find(
      (p) => p.dataset.edge === label.dataset.edge,
    );
    if (path) {
      const point = path.getPointAtLength(path.getTotalLength() / 2),
        text = label.querySelector("text");
      label.setAttribute(
        "transform",
        `translate(${point.x - Number(text.getAttribute("x"))},${point.y - Number(text.getAttribute("y")) + 4})`,
      );
    }
  }
  const laneSvg = $("#lanes-svg");
  laneSvg.setAttribute("width", laneWidth * zoom);
  laneSvg.setAttribute("height", h * zoom);
  laneSvg.setAttribute("viewBox", `0 0 ${laneWidth} ${h}`);
  laneSvg.innerHTML = `<g id="lane-overlay">${laneMarkup}</g>`;
  $("#sticky-lanes").style.width = laneWidth * zoom + "px";
  $("#scroll-content").style.width = w * zoom + "px";
  $("#scroll-content").style.height = h * zoom + "px";
  $("#lane-resize").style.left = laneWidth * zoom + "px";
  $("#lane-resize").setAttribute("aria-valuenow", Math.round(laneWidth));
  $("#lane-resize").setAttribute("aria-valuemin", "110");
  $("#lane-resize").setAttribute("aria-valuemax", "400");
  $("#stats").textContent =
    `${data.lanes.length} 行　・　${data.nodes.length} ステップ　・　${data.edges.length} 接続`;
  $("#canvas").style.transform = `scale(${zoom})`;
  save();
  if (typeof syncNameEditor === "function") syncNameEditor();
  if (typeof drawSegmentHandles === "function") drawSegmentHandles();
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").style.display = "block";
  clearTimeout(window.tt);
  window.tt = setTimeout(() => ($("#toast").style.display = "none"), 2800);
}
function setMode(m) {
  mode = m;
  source = null;
  pending = null;
  $("#pending-edge")?.remove();
  for (let id of ["select", "edit"])
    $("#" + id).classList.toggle("active", id === m);
  $("#diagram").style.cursor = m === "select" ? "default" : "crosshair";
  render();
}
const fixedColors = [
  "#ffffff",
  "#222222",
  "#94a3b8",
  "#e2e8f0",
  "#dbeafe",
  "#bae6fd",
  "#bbf7d0",
  "#fef08a",
  "#fed7aa",
  "#fecaca",
  "#fbcfe8",
  "#ddd6fe",
];
function sharedColors() {
  return [
    ...new Set(
      (data.customColors || [])
        .filter((c) => /^#[0-9a-f]{6}$/i.test(c))
        .map((c) => c.toLowerCase()),
    ),
  ];
}
function addSharedColor(value) {
  const c = value.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c)) return false;
  const colors = sharedColors();
  if (!colors.includes(c) && !fixedColors.includes(c)) {
    if (colors.length >= 256) {
      toast("追加カラーは256色までです");
      return false;
    }
    colors.push(c);
  }
  data.customColors = colors;
  return true;
}
function colorEditor(root, label, value, apply) {
  const group = document.createElement("div");
  group.className = "field color-field";
  const heading = document.createElement("label");
  heading.textContent = label;
  group.append(heading);
  const palette = document.createElement("div");
  palette.className = "color-grid";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", label + "の固定カラー");
  function swatch(container, c) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "color-swatch";
    b.disabled = !apply;
    b.style.setProperty("--swatch", c);
    b.title = c;
    b.setAttribute("aria-label", label + " " + c);
    b.setAttribute("aria-pressed", String(value?.toLowerCase() === c));
    b.onclick = () => {
      if (!apply) return;
      checkpoint();
      apply(c);
      render();
      properties();
    };
    container.append(b);
  }
  fixedColors.forEach((c) => swatch(palette, c));
  group.append(palette);
  const custom = sharedColors();
  if (custom.length) {
    const caption = document.createElement("div");
    caption.className = "palette-caption";
    caption.textContent = "追加カラー";
    const grid = document.createElement("div");
    grid.className = "color-grid custom-color-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", label + "の追加カラー");
    custom.forEach((c) => swatch(grid, c));
    group.append(caption, grid);
  }
  const details = document.createElement("details");
  details.className = "color-custom";
  const summary = document.createElement("summary");
  summary.textContent = apply ? "カスタムカラー" : "カラーを追加";
  const controls = document.createElement("div");
  controls.className = "custom-color-controls";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = color(value, "#56afe1");
  picker.setAttribute("aria-label", label + "のカラーピッカー");
  const hex = document.createElement("input");
  hex.type = "text";
  hex.value = picker.value;
  hex.maxLength = 7;
  hex.setAttribute("aria-label", label + "のカラーコード");
  hex.placeholder = "#56afe1";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = apply ? "追加して適用" : "追加";
  function commit(v) {
    if (!/^#[0-9a-f]{6}$/i.test(v)) {
      hex.setCustomValidity("#と6桁のカラーコードを入力してください");
      hex.reportValidity();
      return;
    }
    checkpoint();
    if (!addSharedColor(v)) return;
    if (apply) apply(v.toLowerCase());
    render();
    properties();
  }
  picker.oninput = () => {
    hex.value = picker.value;
    hex.setCustomValidity("");
  };
  picker.onchange = () => commit(picker.value);
  hex.oninput = () => {
    hex.setCustomValidity("");
    if (/^#[0-9a-f]{6}$/i.test(hex.value)) picker.value = hex.value;
  };
  hex.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(hex.value);
    }
  };
  add.onclick = () => commit(hex.value);
  controls.append(picker, hex, add);
  details.append(summary, controls);
  group.append(details);
  root.append(group);
}
function globalProperties(root) {
  root.innerHTML = "";
  colorEditor(root, "共通カラーパレット", null, null);
  workspaceSettings(root);
}
function connectionSearch(root, obj) {
  const div = document.createElement("div");
  div.className = "field connection-search";
  const lab = document.createElement("label");
  lab.htmlFor = "connection-search";
  lab.textContent = "矢印の接続先";
  const search = document.createElement("input");
  search.id = "connection-search";
  search.type = "search";
  search.placeholder = "図形名・部署名で検索";
  const laneLabel = document.createElement("label");
  laneLabel.htmlFor = "connection-lane";
  laneLabel.textContent = "部署・システム";
  const laneSelect = document.createElement("select");
  laneSelect.id = "connection-lane";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "部署・システムを選択";
  laneSelect.append(placeholder);
  for (const lane of data.lanes) {
    const option = document.createElement("option");
    option.value = lane.id;
    option.textContent = lane.name;
    laneSelect.append(option);
  }
  const shapeSelect = document.createElement("select");
  shapeSelect.id = "connection-shape";
  shapeSelect.setAttribute("aria-label", "部署内の図形");
  shapeSelect.hidden = true;
  const count = document.createElement("div");
  count.className = "search-count";
  const results = document.createElement("div");
  results.className = "connection-results";
  const choice = document.createElement("div");
  choice.className = "connection-choice";
  const add = document.createElement("button");
  add.textContent = "矢印を追加";
  add.disabled = true;
  let targetId = null,
    limit = 20;
  function refresh() {
    results.innerHTML = "";
    const query = search.value.trim().toLocaleLowerCase();
    count.hidden = !query;
    results.hidden = !query;
    choice.hidden = !targetId;
    add.hidden = !targetId;
    if (!query) return;
    const matches = data.nodes
      .filter((n) => n.id !== obj.id)
      .filter((n) => {
        const lane = data.lanes.find((l) => l.id === n.lane);
        return (n.text + " " + (lane?.name || ""))
          .toLocaleLowerCase()
          .includes(query);
      });
    count.textContent = matches.length + "件";
    for (const n of matches.slice(0, limit)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "connection-result";
      b.setAttribute("aria-pressed", String(n.id === targetId));
      const text = document.createElement("span");
      text.textContent = n.text;
      const detail = document.createElement("small");
      detail.textContent =
        (data.lanes.find((l) => l.id === n.lane)?.name || "") +
        " · 図形 " +
        (data.nodes.indexOf(n) + 1);
      b.append(text, detail);
      b.onclick = () => {
        targetId = n.id;
        laneSelect.value = "";
        shapeSelect.hidden = true;
        choice.textContent = "選択中: " + n.text;
        add.disabled = false;
        refresh();
      };
      results.append(b);
    }
    if (matches.length > limit) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "show-more";
      more.textContent = "さらに表示";
      more.onclick = () => {
        limit += 20;
        refresh();
      };
      results.append(more);
    }
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "該当する図形がありません";
      results.append(empty);
    }
  }
  laneSelect.onchange = () => {
    targetId = null;
    search.value = "";
    limit = 20;
    add.disabled = true;
    choice.textContent = "";
    shapeSelect.innerHTML = "";
    shapeSelect.hidden = !laneSelect.value;
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "図形を選択";
    shapeSelect.append(empty);
    const nodes = data.nodes.filter(
      (n) => n.id !== obj.id && n.lane === laneSelect.value,
    );
    for (const n of nodes) {
      const option = document.createElement("option");
      option.value = n.id;
      option.textContent = n.text + " · 図形 " + (data.nodes.indexOf(n) + 1);
      shapeSelect.append(option);
    }
    shapeSelect.disabled = !nodes.length;
    if (!nodes.length) empty.textContent = "選択できる図形がありません";
    refresh();
  };
  shapeSelect.onchange = () => {
    targetId = shapeSelect.value || null;
    const node = data.nodes.find((n) => n.id === targetId);
    choice.textContent = node ? "選択中: " + node.text : "";
    add.disabled = !targetId;
    refresh();
  };
  search.oninput = () => {
    targetId = null;
    laneSelect.value = "";
    shapeSelect.hidden = true;
    choice.textContent = "";
    add.disabled = true;
    limit = 20;
    refresh();
  };
  add.onclick = () => {
    if (!targetId) return;
    if (!canAdd({ edges: 1 })) return;
    if (data.edges.some((e) => e.from === obj.id && e.to === targetId)) {
      toast("この接続は追加済みです");
      return;
    }
    checkpoint();
    data.edges.push({ id: uid(), from: obj.id, to: targetId, label: "" });
    render();
  };
  div.append(
    lab,
    search,
    count,
    results,
    laneLabel,
    laneSelect,
    shapeSelect,
    choice,
    add,
  );
  root.append(div);
  refresh();
}
function confirmAction(title, message, action) {
  const dialog = $("#confirm-dialog");
  if (dialog.open) return Promise.resolve(false);
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  $("#confirm-accept").textContent = action;
  return new Promise((resolve) => {
    let accepted = false;
    const controller = new AbortController(),
      options = { signal: controller.signal };
    $("#confirm-cancel").addEventListener(
      "click",
      () => dialog.close(),
      options,
    );
    $("#confirm-accept").addEventListener(
      "click",
      () => {
        accepted = true;
        dialog.close();
      },
      options,
    );
    dialog.addEventListener(
      "close",
      () => {
        controller.abort();
        resolve(accepted);
      },
      { once: true },
    );
    dialog.showModal();
    $("#confirm-cancel").focus();
  });
}
function properties() {
  $("#tip-popover")?.remove();
  $("#line-popover")?.remove();
  document.body.classList.toggle("has-selection", !!selected);
  let root = $("#properties");
  if (!selected) {
    root.innerHTML = "";
    return;
  }
  $("#properties-title").textContent =
    selected.kind === "global" ? "全体プロパティ" : "プロパティ";
  if (selected.kind === "global") {
    globalProperties(root);
    return;
  }
  let obj = data[selected.kind].find((x) => x.id === selected.id);
  if (!obj) {
    selected = null;
    return properties();
  }
  let kind = selected.kind;
  root.innerHTML = "";
  function field(label, key, type = "text", options) {
    if (type === "color") {
      colorEditor(
        root,
        label,
        color(obj[key], "#ffffff"),
        (c) => (obj[key] = c),
      );
      return;
    }
    let div = document.createElement("div");
    div.className = "field";
    let lab = document.createElement("label");
    lab.textContent = label;
    lab.htmlFor = "prop-" + key;
    let el = document.createElement(
      type === "textarea" ? "textarea" : type === "select" ? "select" : "input",
    );
    el.id = "prop-" + key;
    if (type !== "textarea" && type !== "select") el.type = type;
    if (options)
      options.forEach(([v, t]) => {
        let o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        el.append(o);
      });
    el.value = obj[key] ?? (type === "color" ? "#ffffff" : "");
    el.onchange = () => {
      checkpoint();
      obj[key] = key === "row" ? Number(el.value) : el.value;
      if (key === "lane") {
        obj.row = Math.min(
          obj.row || 0,
          laneRows(data.lanes.find((l) => l.id === obj.lane)) - 1,
        );
        render();
        properties();
        return;
      }
      render();
    };
    if (key === "text") {
      el.onchange = null;
      el.onfocus = () => checkpoint();
      el.oninput = () => {
        obj.text = el.value;
        render();
      };
    }
    div.append(lab, el);
    root.append(div);
  }
  if (kind === "nodes") {
    field("図形名", "text", "textarea");
    const types = document.createElement("fieldset");
    types.className = "shape-types";
    const legend = document.createElement("legend");
    legend.textContent = "図形";
    types.append(legend);
    for (const [value, text] of [
      ["action", "アクション"],
      ["decision", "分岐"],
    ]) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "shape-type";
      input.value = value;
      input.checked = obj.type === value;
      input.onchange = () => {
        checkpoint();
        obj.type = value;
        render();
      };
      const icon = document.createElement("span");
      icon.className = "shape-type-icon";
      icon.innerHTML =
        value === "action"
          ? '<svg viewBox="0 0 28 22" aria-hidden="true"><rect x="3" y="4" width="22" height="14" rx="1"/></svg>'
          : '<svg viewBox="0 0 28 22" aria-hidden="true"><path d="M14 2 26 11 14 20 2 11Z"/></svg>';
      label.append(input, icon, document.createTextNode(text));
      types.append(label);
    }
    root.append(types);
    field("背景色", "fill", "color");
    if (!obj.stroke) obj.stroke = "#222222";
    field("枠線色", "stroke", "color");
    connectionSearch(root, obj);
  }
  if (kind === "lanes") {
    field("行の名前", "name");
    const rowField = document.createElement("div");
    rowField.className = "field";
    const rowLabel = document.createElement("label");
    rowLabel.htmlFor = "lane-row-count";
    rowLabel.textContent = "図形を配置できる行数";
    const count = document.createElement("input");
    count.type = "number";
    count.id = "lane-row-count";
    count.min = "1";
    count.max = "20";
    count.step = "1";
    count.value = laneRows(obj);
    count.onchange = async () => {
      const value = Number(count.value);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        count.setCustomValidity("1〜20の整数を入力してください");
        count.reportValidity();
        return;
      }
      count.setCustomValidity("");
      const old = laneRows(obj);
      if (value === old) return;
      const affected = data.nodes.filter(
        (n) => n.lane === obj.id && (n.row || 0) >= value,
      );
      count.value = old;
      if (value < old && affected.length) {
        count.disabled = true;
        decrease.disabled = true;
        increase.disabled = true;
        const approved = await confirmAction(
          "配置行数を減らしますか？",
          `減らす行に${affected.length}個の図形があります。続けると、図形を残る最後の行へ移動します。接続線は保持されます。`,
          "行数を減らす",
        );
        count.disabled = false;
        decrease.disabled = old <= 1;
        increase.disabled = old >= 20;
        if (!approved) return;
      }
      checkpoint();
      count.value = value;
      obj.rows = value;
      decrease.disabled = value <= 1;
      increase.disabled = value >= 20;
      data.nodes
        .filter((n) => n.lane === obj.id)
        .forEach((n) => (n.row = Math.min(n.row || 0, value - 1)));
      render();
      refreshRowNamesEditor(root, obj);
    };
    count.oninput = () => count.setCustomValidity("");
    const controls = document.createElement("div");
    controls.className = "row-count-controls";
    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.className = "row-count-button";
    decrease.setAttribute("aria-label", "配置行を減らす");
    decrease.title = "配置行を減らす";
    decrease.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const increase = document.createElement("button");
    increase.type = "button";
    increase.className = "row-count-button";
    increase.setAttribute("aria-label", "配置行を増やす");
    increase.title = "配置行を増やす";
    increase.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
    decrease.disabled = laneRows(obj) <= 1;
    increase.disabled = laneRows(obj) >= 20;
    decrease.onclick = () => {
      count.value = Math.max(1, laneRows(obj) - 1);
      count.onchange();
    };
    increase.onclick = () => {
      count.value = Math.min(20, laneRows(obj) + 1);
      count.onchange();
    };
    controls.append(count, increase, decrease);
    rowField.append(rowLabel, controls);
    root.append(rowField);
    const types = document.createElement("fieldset");
    types.className = "shape-types lane-types";
    const legend = document.createElement("legend");
    legend.textContent = "種別";
    types.append(legend);
    const free = document.createElement("input");
    free.type = "text";
    free.maxLength = 100;
    free.className = "lane-custom-type";
    free.setAttribute("aria-label", "自由入力の種別");
    free.placeholder = "種別を入力";
    const isCustom = obj.customType === true || !getTypes().includes(obj.type);
    free.value = isCustom ? obj.type : "";
    free.hidden = !isCustom;
    for (const value of [...getTypes(), "自由入力"]) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "lane-type";
      input.value = value;
      input.checked = value === "自由入力" ? isCustom : obj.type === value;
      input.onchange = () => {
        checkpoint();
        obj.customType = value === "自由入力";
        obj.type = obj.customType ? free.value : value;
        free.hidden = value !== "自由入力";
        render();
        if (!free.hidden) free.focus();
      };
      label.append(input, document.createTextNode(value));
      types.append(label);
    }
    free.oninput = () => {
      obj.customType = true;
      obj.type = free.value;
      render();
    };
    free.onfocus = () => checkpoint();
    types.append(free);
    root.append(types);
    rowNamesEditor(root, obj);
    colorEditor(
      root,
      "背景色",
      color(
        obj.fill,
        data.lanes.findIndex((l) => l.id === obj.id) % 2
          ? "#edf7fd"
          : "#f4faff",
      ),
      (c) => (obj.fill = c),
    );
    const resetColor = document.createElement("button");
    resetColor.type = "button";
    resetColor.className = "reset-lane-color";
    resetColor.textContent = "デフォルトに戻す";
    resetColor.disabled = !obj.fill;
    resetColor.onclick = () => {
      checkpoint();
      delete obj.fill;
      render();
      properties();
    };
    root.lastElementChild.append(resetColor);
    let up = document.createElement("button");
    up.textContent = "↑ 上へ";
    up.onclick = () => moveLane(-1);
    let down = document.createElement("button");
    down.textContent = "↓ 下へ";
    down.onclick = () => moveLane(1);
    root.append(up, down);
  }
  if (kind === "edges") {
    field("矢印のラベル", "label");
    obj.labelFill ??= "#ffffff";
    field("ラベル背景色", "labelFill", "color");
    obj.color ??= "#222222";
    field("色", "color", "color");
    obj.startArrow ??= false;
    obj.endArrow ??= true;
    obj.dash ??= "solid";
    obj.shape ??= "orthogonal";
    obj.width ??= 1.5;
    const row = document.createElement("div");
    row.className = "arrow-controls";
    function tipIcon(on, start) {
      return `<svg viewBox="0 0 40 24" aria-hidden="true"><path d="M5 12 H35" stroke="currentColor" stroke-width="2"/>${on ? (start ? '<path d="M5 12 L17 6 V18 Z" fill="currentColor"/>' : '<path d="M35 12 L23 6 V18 Z" fill="currentColor"/>') : ""}</svg>`;
    }
    const tipButtons = {};
    function updateTips() {
      for (const key of ["startArrow", "endArrow"]) {
        const button = tipButtons[key];
        if (button) {
          button.innerHTML =
            tipIcon(obj[key], key === "startArrow") +
            '<span class="line-caret">⌄</span>';
          button.title =
            (key === "startArrow" ? "始点" : "終点") +
            ": " +
            (obj[key] ? "矢印" : "なし");
        }
      }
    }
    function tipButton(key, label) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tip-button";
      button.id = "prop-" + key;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      tipButtons[key] = button;
      row.append(button);
      button.onclick = () => {
        const same = $("#tip-popover")?.dataset.key === key;
        $("#tip-popover")?.remove();
        $("#line-popover")?.remove();
        $("#line-type")?.setAttribute("aria-expanded", "false");
        for (const b of Object.values(tipButtons))
          b.setAttribute("aria-expanded", "false");
        if (same) return;
        const pop = document.createElement("div");
        pop.id = "tip-popover";
        pop.dataset.key = key;
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", label);
        for (const on of [false, true]) {
          const option = document.createElement("button");
          option.type = "button";
          option.innerHTML =
            tipIcon(on, key === "startArrow") +
            "<span>" +
            (on ? "矢印" : "なし") +
            "</span>";
          option.setAttribute("aria-pressed", String(!!obj[key] === on));
          option.onclick = () => {
            checkpoint();
            obj[key] = on;
            updateTips();
            render();
            pop.remove();
            button.setAttribute("aria-expanded", "false");
          };
          pop.append(option);
        }
        document.body.append(pop);
        const rect = button.getBoundingClientRect();
        pop.style.left =
          Math.max(8, Math.min(window.innerWidth - 160, rect.left)) + "px";
        pop.style.top =
          Math.min(window.innerHeight - pop.offsetHeight - 8, rect.bottom + 8) +
          "px";
        button.setAttribute("aria-expanded", "true");
      };
    }
    tipButton("startArrow", "始点の矢印");
    const swap = document.createElement("button");
    swap.type = "button";
    swap.className = "swap-tips";
    swap.setAttribute("aria-label", "矢印の向きを入れ替える");
    swap.title = "矢印の向きを入れ替える";
    swap.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14m-4-4 4 4-4 4M19 16H5m4-4-4 4 4 4"/></svg>';
    swap.onclick = () => {
      checkpoint();
      [obj.startArrow, obj.endArrow] = [obj.endArrow, obj.startArrow];
      updateTips();
      $("#tip-popover")?.remove();
      render();
    };
    const typeButton = document.createElement("button");
    typeButton.id = "line-type";
    typeButton.type = "button";
    typeButton.setAttribute("aria-label", "線の設定");
    typeButton.setAttribute("aria-expanded", "false");
    typeButton.setAttribute("aria-haspopup", "dialog");
    row.append(typeButton);
    const shapePaths = {
      straight: "M5 23 L31 15",
      orthogonal: "M5 24 H18 V14 H31",
      curve: "M5 23 C12 9 24 31 31 17",
    };
    function lineIcon(shape, dash) {
      return `<svg viewBox="0 0 36 36" aria-hidden="true"><path d="${shapePaths[shape] || shapePaths.orthogonal}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${dash === "dashed" ? "5 4" : dash === "dotted" ? "1 5" : ""}"/></svg>`;
    }
    function updateTypeButton() {
      typeButton.innerHTML =
        lineIcon(obj.shape, obj.dash) + '<span class="line-caret">⌄</span>';
    }
    updateTypeButton();
    tipButton("endArrow", "終点の矢印");
    row.append(swap);
    updateTips();
    root.append(row);
    const width = document.createElement("div");
    width.className = "field width-control";
    const lab = document.createElement("label");
    lab.htmlFor = "prop-width";
    lab.textContent = "線の太さ";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "1";
    input.max = "12";
    input.step = ".5";
    input.id = "prop-width";
    input.value = obj.width;
    const output = document.createElement("output");
    output.htmlFor = input.id;
    output.textContent = obj.width + " px";
    input.onpointerdown = () => checkpoint();
    input.onkeydown = (e) => {
      if (e.key.startsWith("Arrow")) checkpoint();
    };
    input.oninput = () => {
      obj.width = Number(input.value);
      output.textContent = obj.width + " px";
      render();
    };
    width.append(lab, input, output);
    typeButton.onclick = () => {
      $("#tip-popover")?.remove();
      for (const b of Object.values(tipButtons))
        b.setAttribute("aria-expanded", "false");
      const old = $("#line-popover");
      if (old) {
        old.remove();
        typeButton.setAttribute("aria-expanded", "false");
        return;
      }
      const pop = document.createElement("div");
      pop.id = "line-popover";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "線の設定");
      pop.append(width);
      const shapeRow = document.createElement("div");
      shapeRow.className = "line-options";
      const dashRow = document.createElement("div");
      dashRow.className = "line-options";
      function option(container, key, value, label, icon) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.title = label;
        b.innerHTML = icon;
        b.dataset.optionKey = key;
        b.dataset.optionValue = value;
        b.setAttribute("aria-pressed", String(obj[key] === value));
        b.onclick = () => {
          checkpoint();
          obj[key] = value;
          for (const button of pop.querySelectorAll("button[data-option-key]"))
            button.setAttribute(
              "aria-pressed",
              String(
                obj[button.dataset.optionKey] === button.dataset.optionValue,
              ),
            );
          updateTypeButton();
          render();
        };
        container.append(b);
      }
      for (const [value, label] of [
        ["straight", "直線"],
        ["orthogonal", "直角"],
        ["curve", "曲線"],
      ])
        option(shapeRow, "shape", value, label, lineIcon(value, "solid"));
      for (const [value, label] of [
        ["solid", "実線"],
        ["dashed", "破線"],
        ["dotted", "点線"],
      ])
        option(
          dashRow,
          "dash",
          value,
          label,
          `<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M5 18 H31" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${value === "dashed" ? "5 4" : value === "dotted" ? "1 5" : ""}"/></svg>`,
        );
      pop.append(shapeRow, dashRow);
      document.body.append(pop);
      const rect = typeButton.getBoundingClientRect();
      pop.style.left =
        Math.max(8, Math.min(window.innerWidth - 248, rect.left - 65)) + "px";
      pop.style.top =
        Math.max(
          8,
          Math.min(window.innerHeight - pop.offsetHeight - 8, rect.bottom + 8),
        ) + "px";
      typeButton.setAttribute("aria-expanded", "true");
    };
  }

  let del = document.createElement("button");
  del.className = "danger";
  del.style.marginTop = "14px";
  del.textContent = kind === "lanes" ? "行とその中のステップを削除" : "削除";
  del.onclick = remove;
  if (kind !== "nodes") root.append(del);
}
function moveLane(dir) {
  let i = data.lanes.findIndex((l) => l.id === selected.id),
    j = i + dir;
  if (j < 0 || j >= data.lanes.length) return;
  checkpoint();
  [data.lanes[i], data.lanes[j]] = [data.lanes[j], data.lanes[i]];
  render();
}
async function remove() {
  if (!selected || selected.kind === "global" || $("#confirm-dialog").open)
    return;
  const target = { ...selected };
  if (target.kind === "lanes") {
    const nodes = data.nodes.filter((n) => n.lane === target.id);
    const lane = data.lanes.find((l) => l.id === target.id);
    if (!lane) return;
    const message = nodes.length
      ? `「${lane.name}」と、その中の図形${nodes.length}個、図形につながる接続線を削除します。`
      : `「${lane.name}」を削除します。`;
    if (
      !(await confirmAction(
        "部署・システムの行を削除しますか？",
        message,
        "削除する",
      ))
    )
      return;
  }
  checkpoint();
  const ids =
    target.kind === "lanes"
      ? data.nodes.filter((n) => n.lane === target.id).map((n) => n.id)
      : target.kind === "nodes"
        ? [target.id]
        : [];
  data[target.kind] = data[target.kind].filter((o) => o.id !== target.id);
  data.nodes = data.nodes.filter((n) => !ids.includes(n.id));
  data.edges = data.edges.filter(
    (e) => !ids.includes(e.from) && !ids.includes(e.to),
  );
  selected = null;
  render();
  properties();
}

let laneDrag = null,
  suppressLaneClick = false,
  connecting = false,
  connectionStart = null;
function suppressClick() {
  suppressLaneClick = true;
  setTimeout(() => (suppressLaneClick = false), 0);
}
let drag = null;
$(".stage").addEventListener("pointerdown", (e) => {
  const endpoint = e.target.closest("[data-reconnect]");
  if (endpoint) {
    e.preventDefault();
    reconnect = {
      edgeId: endpoint.dataset.edgeId,
      end: endpoint.dataset.reconnect,
    };
    document.body.classList.add("is-reconnecting");
    render();
    $("#diagram").setPointerCapture(e.pointerId);
    return;
  }
  if (e.target.closest("[data-port]") && mode === "edit") {
    e.preventDefault();
    const el = e.target.closest("[data-port]");
    pending = { id: el.dataset.portNode, side: el.dataset.port };
    connecting = true;
    document.body.classList.add("is-reconnecting");
    connectionStart = { x: e.clientX, y: e.clientY };
    $("#diagram").setPointerCapture(e.pointerId);
    return;
  }
  const handle = e.target.closest("[data-lane-drag]");
  if (handle) {
    e.preventDefault();
    laneDrag = {
      id: handle.dataset.laneDrag,
      startY: e.clientY,
      to: data.lanes.findIndex((l) => l.id === handle.dataset.laneDrag),
      moved: false,
    };
    $("#diagram").setPointerCapture(e.pointerId);
    return;
  }
  let node = e.target.closest("[data-node]");
  if (node) {
    let n = data.nodes.find((n) => n.id === node.dataset.node);
    drag = {
      id: n.id,
      startX: e.clientX,
      startY: e.clientY,
      x: n.x,
      lane: n.lane,
      y: pos(n).y,
      moved: false,
    };
  }
});
$(".stage").addEventListener("pointermove", (e) => {
  if (reconnect) {
    const r = $("#diagram").getBoundingClientRect(),
      e1 = data.edges.find((e) => e.id === reconnect.edgeId),
      a = data.nodes.find((n) => n.id === e1.from),
      b = data.nodes.find((n) => n.id === e1.to),
      sides = edgeSides(e1, a, b),
      candidate = snapTarget(
        e.clientX,
        e.clientY,
        e1[reconnect.end === "from" ? "to" : "from"],
        true,
      ),
      point = candidate?.point || {
        x: (e.clientX - r.left) / zoom,
        y: (e.clientY - r.top) / zoom,
        side: reconnect.end === "from" ? sides[0] : sides[1],
      };
    $("#reconnect-preview")?.remove();
    const path = document.createElementNS(NS, "path");
    path.id = "reconnect-preview";
    path.setAttribute(
      "d",
      edgePath(
        reconnect.end === "from" ? point : port(a, sides[0]),
        reconnect.end === "to" ? point : port(b, sides[1]),
        e1.shape || "orthogonal",
      ),
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#3597cc");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-dasharray", "6 4");
    path.setAttribute("pointer-events", "none");
    $("#diagram").append(path);
    snapTarget(
      e.clientX,
      e.clientY,
      e1[reconnect.end === "from" ? "to" : "from"],
      true,
    );
    return;
  }
  if (pending && !laneDrag && !drag) {
    const r = $("#diagram").getBoundingClientRect();
    const candidate = snapTarget(e.clientX, e.clientY, pending.id);
    drawPending(
      candidate?.point || {
        x: (e.clientX - r.left) / zoom,
        y: (e.clientY - r.top) / zoom,
        side: "left",
      },
    );
    snapTarget(e.clientX, e.clientY, pending.id, true);
  }
  if (laneDrag) {
    if (Math.abs(e.clientY - laneDrag.startY) < 5 && !laneDrag.moved) return;
    laneDrag.moved = true;
    const rect = $("#diagram").getBoundingClientRect();
    laneDrag.to = insertionAtY((e.clientY - rect.top) / zoom);
    $("#lane-drop")?.remove();
    const mark = document.createElementNS(NS, "line");
    mark.id = "lane-drop";
    mark.setAttribute("x1", "0");
    mark.setAttribute("x2", $("#diagram").getAttribute("width"));
    mark.setAttribute("y1", laneTop(laneDrag.to));
    mark.setAttribute("y2", laneTop(laneDrag.to));
    mark.setAttribute("stroke", "#3597cc");
    mark.setAttribute("stroke-width", "4");
    mark.setAttribute("pointer-events", "none");
    $("#diagram").append(mark);
    return;
  }
  if (!drag) return;
  let dx = (e.clientX - drag.startX) / zoom,
    dy = (e.clientY - drag.startY) / zoom;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
  if (!drag.moved) checkpoint();
  drag.moved = true;
  if (!$("#diagram").hasPointerCapture(e.pointerId))
    $("#diagram").setPointerCapture(e.pointerId);
  let n = data.nodes.find((n) => n.id === drag.id);
  n.x = Math.min(100000, Math.max(250, Math.round((drag.x + dx) / 10) * 10));
  const placement = placementAtY(drag.y + dy);
  n.lane = placement.lane;
  n.row = placement.row;
  optimizeConnections(n.id);
  selected = { kind: "nodes", id: n.id };
  render();
});
$(".stage").addEventListener("pointerup", (e) => {
  if (reconnect) {
    const current = reconnect;
    reconnect = null;
    document.body.classList.remove("is-reconnecting");
    suppressClick();
    const edge = data.edges.find((e) => e.id === current.edgeId),
      r = $("#diagram").getBoundingClientRect(),
      x = (e.clientX - r.left) / zoom,
      y = (e.clientY - r.top) / zoom;
    const candidate = snapTarget(
      e.clientX,
      e.clientY,
      edge[current.end === "from" ? "to" : "from"],
    );
    $("#snap-target")?.remove();
    if (candidate) {
      checkpoint();
      delete edge.route;
      edge[current.end] = candidate.node.id;
      edge[current.end === "from" ? "fromPort" : "toPort"] = candidate.side;
    }
    render();
    properties();
    return;
  }
  if (connecting) {
    connecting = false;
    document.body.classList.remove("is-reconnecting");
    $("#snap-target")?.remove();
    const origin = pending;
    pending = null;
    $("#pending-edge")?.remove();
    $("#pending-defs")?.remove();
    suppressClick();
    if (!origin) return;
    const click =
      Math.hypot(e.clientX - connectionStart.x, e.clientY - connectionStart.y) <
      5;
    if (click) {
      createInDirection(origin);
      return;
    }
    const r = $("#diagram").getBoundingClientRect(),
      x = (e.clientX - r.left) / zoom,
      y = (e.clientY - r.top) / zoom,
      target = document.elementFromPoint(e.clientX, e.clientY),
      candidate = snapTarget(e.clientX, e.clientY, origin.id);
    let node = candidate?.node || null,
      side = candidate?.side,
      created = false;
    if (node?.id === origin.id) return;
    if (!canAdd({ edges: 1, nodes: node ? 0 : 1 })) return;
    if (!node) {
      if (!target?.closest("#diagram") || x < laneWidth || y < 42) return;
      checkpoint();
      node = {
        id: uid(),
        type: "action",
        ...placementAtY(y),
        x: Math.min(
          100000,
          Math.max(250, Math.round((x - laneWidth + 164) / 10) * 10),
        ),
        text: "",
      };
      data.nodes.push(node);
      created = true;
    } else checkpoint();
    if (!side) {
      const sourceNode = data.nodes.find((n) => n.id === origin.id);
      side = edgeSides({}, sourceNode, node)[1];
    }
    const edge = {
      id: uid(),
      from: origin.id,
      to: node.id,
      fromPort: origin.side,
      toPort: side,
      label: "",
      color: "#222222",
      shape: "orthogonal",
      width: 1.5,
      startArrow: false,
      endArrow: true,
      dash: "solid",
      labelFill: "#ffffff",
    };
    data.edges.push(edge);
    selected = created
      ? { kind: "nodes", id: node.id }
      : { kind: "edges", id: edge.id };
    render();
    properties();
    if (created) beginNameEdit(node.id, true);
    return;
  }
  if (laneDrag) {
    const { id, to, moved } = laneDrag;
    laneDrag = null;
    $("#lane-drop")?.remove();
    if (moved) {
      const from = data.lanes.findIndex((l) => l.id === id);
      const insert = to > from ? to - 1 : to;
      if (from !== insert) {
        checkpoint();
        const [lane] = data.lanes.splice(from, 1);
        data.lanes.splice(insert, 0, lane);
      }
      suppressLaneClick = true;
      setTimeout(() => (suppressLaneClick = false), 0);
      selected = { kind: "lanes", id };
      render();
      properties();
    }
    return;
  }
  if (drag?.moved) {
    properties();
    setTimeout(() => (drag = null), 0);
  } else drag = null;
});
$(".stage").addEventListener("click", (e) => {
  if (e.target.closest("#lane-resize")) return;
  if (
    e.target.closest("[data-reconnect]") ||
    drag?.moved ||
    suppressLaneClick ||
    e.target.closest("[data-lane-drag]")
  )
    return;
  if (e.target.closest("[data-port]")) return;
  let node = e.target.closest("[data-node]"),
    lane = e.target.closest("[data-lane]"),
    edge = e.target.closest("[data-edge]");
  if (lane) {
    selected = { kind: "lanes", id: lane.dataset.lane };
    render();
    properties();
    return;
  }
  if (mode === "edit" && !node && !edge) {
    if (selected) {
      selected = null;
      render();
      properties();
      return;
    }
    if (!data.lanes.length) return toast("先に行を追加してください");
    let r = $("#diagram").getBoundingClientRect(),
      x = (e.clientX - r.left) / zoom - (laneWidth - 164),
      y = (e.clientY - r.top) / zoom;
    if (x < 180 || y < 42) return;
    if (!canAdd({ nodes: 1 })) return;
    checkpoint();
    let n = {
      id: uid(),
      type: "action",
      ...placementAtY(y),
      x: Math.min(100000, Math.max(250, Math.round(x / 10) * 10)),
      text: "",
    };
    data.nodes.push(n);
    selected = { kind: "nodes", id: n.id };
    render();
    properties();
    beginNameEdit(n.id, true);
    return;
  }
  if (
    node &&
    selected?.id === node.dataset.node &&
    e.target.tagName.toLowerCase() === "text"
  ) {
    beginNameEdit(node.dataset.node);
    return;
  }
  selected = node
    ? { kind: "nodes", id: node.dataset.node }
    : lane
      ? { kind: "lanes", id: lane.dataset.lane }
      : edge
        ? { kind: "edges", id: edge.dataset.edge }
        : null;
  render();
  properties();
});
$(".stage").addEventListener("dblclick", (e) => {
  const node = e.target.closest("[data-node]");
  if (node) {
    drag = null;
    beginNameEdit(node.dataset.node);
    return;
  }
  const lane = e.target.closest("[data-lane]");
  if (lane) {
    selected = { kind: "lanes", id: lane.dataset.lane };
    properties();
    $("#prop-name")?.focus();
  }
});
for (let id of ["select", "edit"]) $("#" + id).onclick = () => setMode(id);
$("#addlane").onclick = () => {
  if (!canAdd({ lanes: 1 })) return;
  checkpoint();
  let l = { id: uid(), name: "新しい部署", type: "部署" };
  data.lanes.push(l);
  selected = { kind: "lanes", id: l.id };
  render();
  properties();
  $("#canvaswrap").scrollTop = 99999;
  $("#properties input").focus();
  $("#properties input").select();
};
$("#title").onchange = (e) => {
  checkpoint();
  data.title = e.target.value || "untitled";
  render();
};
function history(dir) {
  let a = dir === "undo" ? past : future,
    b = dir === "undo" ? future : past;
  if (!a.length) return;
  b.push(JSON.stringify(data));
  data = JSON.parse(a.pop());
  laneWidth = Math.max(110, Math.min(400, Number(data.laneWidth) || 164));
  selected = null;
  render();
  properties();
}

function setZoom(d) {
  zoom = Math.max(0.5, Math.min(1.5, Math.round((zoom + d) * 10) / 10));
  $("#zoomlabel").textContent = Math.round(zoom * 100) + "%";
  render();
}
$("#zoomin").onclick = () => setZoom(0.1);
$("#zoomout").onclick = () => setZoom(-0.1);
function exportJSON() {
  if (!valid(data)) {
    toast("フローのデータが保存条件を満たしていません");
    return false;
  }
  const json = JSON.stringify(data, null, 2);
  if (new Blob([json]).size > LIMITS.jsonBytes) {
    toast("JSONは5MBまでです。図形名やラベルの内容を減らしてください");
    return false;
  }
  download(json, "application/json", "json");
  return true;
}
function download(content, type, extension) {
  let a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([content], { type }));
  a.href = url;
  a.download =
    (data.title.replace(/[\\/:*?"<>|]/g, "_") || "flow") + "." + extension;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function cleanExportSVG() {
  const previous = selected;
  try {
    selected = null;
    render();
    return exportSVG();
  } finally {
    selected = previous;
    render();
  }
}
async function exportImage(format) {
  const svg = cleanExportSVG(),
    doc = new DOMParser().parseFromString(svg, "image/svg+xml"),
    width = Number(doc.documentElement.getAttribute("width")),
    height = Number(doc.documentElement.getAttribute("height"));
  if (!(width > 0 && height > 0))
    throw new Error("画像のサイズを取得できませんでした");
  const scale = Math.min(
      2,
      16384 / width,
      16384 / height,
      Math.sqrt(32000000 / (width * height)),
    ),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を作成できませんでした");
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("画像を読み込めませんでした"));
      image.src = url;
    });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = format === "jpg" ? "image/jpeg" : "image/png",
      blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
    if (!blob) throw new Error("画像を書き出せませんでした");
    download(blob, type, format);
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
function exportHTML() {
  const svg = cleanExportSVG();
  download(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.title)}</title><style>body{margin:0;background:#fbfdff;font-family:Arial,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif}main{width:max-content;min-width:100vw}svg{display:block}svg [role="button"]{cursor:default!important}@media print{svg{max-width:100%;height:auto}main{width:100%;min-width:0}@page{size:landscape;margin:10mm}}</style></head><body><main>${svg}</main></body></html>`,
    "text/html;charset=utf-8",
    "html",
  );
}
$("#export").onclick = () => {
  let old = $("#exportmenu");
  if (old) {
    old.remove();
    return;
  }
  let menu = document.createElement("div");
  menu.id = "exportmenu";
  Object.assign(menu.style, {
    position: "absolute",
    right: "16px",
    top: "62px",
    background: "white",
    padding: "8px",
    border: "1px solid #dce3dd",
    borderRadius: "8px",
    boxShadow: "0 8px 24px #20302018",
    zIndex: 5,
  });
  for (const [text, fn] of [
    ["JSONで保存（再編集用）", exportJSON],
    [
      "SVG画像を書き出す",
      () => download(cleanExportSVG(), "image/svg+xml", "svg"),
    ],
    ["PNG画像を書き出す", () => exportImage("png")],
    ["JPG画像を書き出す", () => exportImage("jpg")],
    ["HTMLを書き出す（閲覧用）", exportHTML],
  ]) {
    const button = document.createElement("button");
    button.textContent = text;
    button.style.display = "block";
    button.style.border = "0";
    button.onclick = async () => {
      menu.remove();
      try {
        const result = await fn();
        if (result !== false) toast("ファイルを書き出しました");
      } catch (error) {
        console.error(error);
        toast("書き出しに失敗しました。もう一度お試しください。");
      }
    };
    menu.append(button);
  }
  document.body.append(menu);
};
$("#import").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  let f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > LIMITS.jsonBytes) {
      toast("JSONは5MBまで読み込めます");
      return;
    }
    let d = JSON.parse(await f.text());
    if (!valid(d)) throw Error();
    if (
      !(await confirmAction(
        "フローを読み込みますか？",
        "現在のフローを、読み込んだファイルの内容で置き換えます。",
        "置き換える",
      ))
    )
      return;
    checkpoint();
    data = d;
    laneWidth = Math.max(110, Math.min(400, Number(d.laneWidth) || 164));
    selected = null;
    pending = null;
    render();
    properties();
    toast("フローを読み込みました");
  } catch {
    toast("対応するJSONファイルを選んでください");
  } finally {
    e.target.value = "";
  }
};
document.addEventListener("keydown", (e) => {
  if ($("#confirm-dialog").open || $("#setup-dialog")?.open) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName))
    return;
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    e.preventDefault();
    history(e.shiftKey ? "redo" : "undo");
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    remove();
  }
  if (e.key === "Escape") {
    pending = null;
    reconnect = null;
    connecting = false;
    document.body.classList.remove("is-reconnecting");
    selected = null;
    render();
    properties();
  }
  if (e.key.toLowerCase() === "v") setMode("select");
  if (e.key.toLowerCase() === "e") setMode("edit");
});
render();
properties();

for (const [id, label] of Object.entries({
  select: "選択",
  edit: "編集",
  addlane: "行を追加",
  zoomin: "拡大",
  zoomout: "縮小",
})) {
  document.getElementById(id).setAttribute("aria-label", label);
  document.getElementById(id).title = label;
}

$(".stage").addEventListener("keydown", (e) => {
  const lane = e.target.closest("[data-lane]");
  if (lane && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    selected = { kind: "lanes", id: lane.dataset.lane };
    render();
    properties();
  }
});

$(".stage").addEventListener("pointercancel", () => {
  laneDrag = null;
  drag = null;
  connecting = false;
  pending = null;
  reconnect = null;
  $("#snap-target")?.remove();
  document.body.classList.remove("is-reconnecting");
  $("#reconnect-preview")?.remove();
  $("#pending-edge")?.remove();
  $("#lane-drop")?.remove();
});
$(".stage").addEventListener("keydown", (e) => {
  const handle = e.target.closest("[data-lane-drag]");
  if (handle && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    selected = { kind: "lanes", id: handle.dataset.laneDrag };
    moveLane(e.key === "ArrowUp" ? -1 : 1);
    properties();
    const next = Array.from(
      $("#lanes-svg").querySelectorAll("[data-lane-drag]"),
    ).find((el) => el.dataset.laneDrag === selected.id);
    next?.focus();
  }
});

new ResizeObserver(() => render()).observe($("#canvaswrap"));

$("#close-properties").onclick = () => {
  selected = null;
  properties();
  render();
};

let resizing = null;
$("#lane-resize").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resizing = { x: e.clientX, width: laneWidth };
  $("#lane-resize").setPointerCapture(e.pointerId);
});
$("#lane-resize").addEventListener("pointermove", (e) => {
  if (!resizing) return;
  laneWidth = Math.max(
    110,
    Math.min(400, resizing.width + (e.clientX - resizing.x) / zoom),
  );
  render();
});
$("#lane-resize").addEventListener("pointerup", () => (resizing = null));
$("#lane-resize").addEventListener("pointercancel", () => (resizing = null));
$("#lane-resize").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    laneWidth = Math.max(
      110,
      Math.min(400, laneWidth + (e.key === "ArrowRight" ? 10 : -10)),
    );
    render();
  }
});

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#line-popover,#line-type")) {
    $("#line-popover")?.remove();
    $("#line-type")?.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#tip-popover,.tip-button")) {
    $("#tip-popover")?.remove();
    document
      .querySelectorAll(".tip-button")
      .forEach((b) => b.setAttribute("aria-expanded", "false"));
  }
});
setMode("edit");

$("#global-properties").onclick = () => {
  selected = { kind: "global" };
  properties();
  render();
};
