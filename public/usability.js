var nameEditing = null,
  segmentDrag = null;
function getTypes() {
  return [
    ...new Set(
      (Array.isArray(data.types) ? data.types : ["部署", "システム"])
        .filter((t) => typeof t === "string" && t.trim())
        .map((t) => t.trim()),
    ),
  ];
}
function beginNameEdit(id, isNew = false) {
  endNameEdit();
  const node = data.nodes.find((n) => n.id === id);
  if (!node) return;
  selected = { kind: "nodes", id };
  properties();
  if (!isNew) checkpoint();
  const input = document.createElement("textarea");
  input.id = "node-name-editor";
  input.setAttribute("aria-label", "図形上で図形名を編集");
  input.placeholder = "図形名";
  input.value = node.text;
  input.spellcheck = false;
  input.rows = 2;
  for (const event of ["pointerdown", "click", "dblclick"])
    input.addEventListener(event, (e) => e.stopPropagation());
  input.oninput = () => {
    node.text = input.value;
    const prop = $("#prop-text");
    if (prop) prop.value = node.text;
    render();
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (
      (e.key === "Enter" && !e.shiftKey && !e.isComposing) ||
      e.key === "Escape"
    ) {
      e.preventDefault();
      input.blur();
    }
  };
  input.onblur = () => endNameEdit();
  nameEditing = { id, input };
  $("#scroll-content").append(input);
  render();
  input.focus();
  input.select();
}
function endNameEdit() {
  if (!nameEditing) return;
  const current = nameEditing;
  nameEditing = null;
  current.input.remove();
  render();
}
function syncNameEditor() {
  if (!nameEditing) return;
  const n = data.nodes.find((n) => n.id === nameEditing.id);
  if (!n || selected?.kind !== "nodes" || selected.id !== n.id) {
    endNameEdit();
    return;
  }
  const p = pos(n),
    input = nameEditing.input;
  Object.assign(input.style, {
    left: (p.x - 65) * zoom + "px",
    top: (p.y - 19) * zoom + "px",
    width: 130 * zoom + "px",
    height: 38 * zoom + "px",
    fontSize: 11 * zoom + "px",
    lineHeight: 17 * zoom + "px",
    background: color(n.fill, "#ffffff"),
  });
  if (document.activeElement !== input) input.value = n.text;
}
function createInDirection(origin) {
  if (!canAdd({ nodes: 1, edges: 1 })) return;
  const source = data.nodes.find((n) => n.id === origin.id);
  if (!source) return;
  const lane = data.lanes.find((l) => l.id === source.lane),
    row = Number(source.row) || 0;
  if (
    ((origin.side === "top" && row === 0) ||
      (origin.side === "bottom" && row === laneRows(lane) - 1)) &&
    laneRows(lane) >= 20
  ) {
    toast("配置行は20行までです");
    return;
  }
  checkpoint();
  let targetRow = row,
    targetX = source.x;
  const opposite = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
  };
  if (origin.side === "left" || origin.side === "right") {
    targetX += origin.side === "left" ? -240 : 240;
    let attempts = 0;
    while (
      data.nodes.some(
        (n) =>
          n.lane === lane.id &&
          (Number(n.row) || 0) === targetRow &&
          Math.abs(n.x - targetX) < 165,
      ) &&
      attempts++ < 30
    )
      targetX += origin.side === "left" ? -200 : 200;
    if (targetX > 100000) {
      toast("これ以上右側には図形を追加できません");
      return;
    }
    if (targetX < 250) {
      const shift = 250 - targetX;
      if (data.nodes.some((n) => n.x + shift > 100000)) {
        toast("図形の配置範囲を超えるため追加できません");
        return;
      }
      data.nodes.forEach((n) => (n.x += shift));
      data.edges.forEach((e) => delete e.route);
      targetX = 250;
    }
  } else if (origin.side === "top") {
    if (row > 0) targetRow = row - 1;
    else {
      lane.rows = laneRows(lane) + 1;
      data.nodes
        .filter((n) => n.lane === lane.id)
        .forEach((n) => (n.row = (Number(n.row) || 0) + 1));
      lane.rowNames = ["", ...(lane.rowNames || [])].slice(0, 20);
      targetRow = 0;
    }
  } else {
    targetRow = row + 1;
    if (targetRow >= laneRows(lane)) lane.rows = laneRows(lane) + 1;
  }
  if (
    (origin.side === "top" || origin.side === "bottom") &&
    data.nodes.some(
      (n) =>
        n.id !== source.id &&
        n.lane === lane.id &&
        (Number(n.row) || 0) === targetRow &&
        Math.abs(n.x - targetX) < 165,
    )
  ) {
    if (laneRows(lane) >= 20) {
      toast("配置行は20行までです");
      return;
    }
    const insert =
      origin.side === "top"
        ? Number(source.row) || 0
        : (Number(source.row) || 0) + 1;
    const names = Array.from(
      { length: laneRows(lane) },
      (_, i) => lane.rowNames?.[i] || "",
    );
    names.splice(insert, 0, "");
    lane.rowNames = names;
    lane.rows = laneRows(lane) + 1;
    data.nodes
      .filter((n) => n.lane === lane.id && (Number(n.row) || 0) >= insert)
      .forEach((n) => (n.row = (Number(n.row) || 0) + 1));
    targetRow = insert;
  }
  const n = {
    id: uid(),
    lane: lane.id,
    row: targetRow,
    x: targetX,
    type: "action",
    text: "",
  };
  data.nodes.push(n);
  data.edges.push({
    id: uid(),
    from: source.id,
    to: n.id,
    fromPort: origin.side,
    toPort: opposite[origin.side],
    label: "",
    shape: "orthogonal",
    endArrow: true,
  });
  selected = { kind: "nodes", id: n.id };
  render();
  properties();
  const viewport = $("#canvaswrap"),
    p = pos(n);
  if (p.x * zoom > viewport.scrollLeft + viewport.clientWidth - 110)
    viewport.scrollLeft = Math.max(0, p.x * zoom - viewport.clientWidth + 160);
  if (p.y * zoom > viewport.scrollTop + viewport.clientHeight - 60)
    viewport.scrollTop = Math.max(0, p.y * zoom - viewport.clientHeight + 100);
  if (p.y * zoom < viewport.scrollTop + 20)
    viewport.scrollTop = Math.max(0, p.y * zoom - 60);
  beginNameEdit(n.id, true);
}
function edgePoints(edge) {
  const a = data.nodes.find((n) => n.id === edge.from),
    b = data.nodes.find((n) => n.id === edge.to);
  if (!a || !b) return [];
  const sides = edgeSides(edge, a, b),
    d = edgePath(port(a, sides[0]), port(b, sides[1]), "orthogonal", edge),
    points = [];
  const re = /[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(d))) points.push({ x: Number(m[1]), y: Number(m[2]) });
  return points;
}
function drawSegmentHandles() {
  if (selected?.kind !== "edges") return;
  const edge = data.edges.find((e) => e.id === selected.id);
  if (!edge || (edge.shape || "orthogonal") !== "orthogonal") return;
  const points = edgePoints(edge);
  for (let i = 2; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 12) continue;
    const vertical = a.x === b.x,
      x = (a.x + b.x) / 2,
      y = (a.y + b.y) / 2;
    const rect = document.createElementNS(NS, "rect");
    rect.classList.add("segment-handle");
    rect.dataset.segment = String(i);
    rect.dataset.segmentEdge = edge.id;
    for (const [key, value] of Object.entries({
      x: x - 7,
      y: y - 7,
      width: 14,
      height: 14,
      rx: 3,
      fill: "#ffffff",
      stroke: "#3597cc",
      "stroke-width": 2,
      role: "button",
      "aria-label": vertical
        ? "直角線の途中を左右へ移動"
        : "直角線の途中を上下へ移動",
    }))
      rect.setAttribute(key, value);
    rect.style.cursor = vertical ? "ew-resize" : "ns-resize";
    $("#diagram").append(rect);
  }
}
$(".stage").addEventListener(
  "pointerdown",
  (e) => {
    const h = e.target.closest("[data-segment]");
    if (!h) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const edge = data.edges.find((edge) => edge.id === h.dataset.segmentEdge),
      points = edgePoints(edge),
      index = Number(h.dataset.segment);
    segmentDrag = {
      edgeId: edge.id,
      index,
      points,
      axis: points[index - 1].x === points[index].x ? "x" : "y",
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    $("#diagram").setPointerCapture(e.pointerId);
  },
  true,
);
$(".stage").addEventListener(
  "pointermove",
  (e) => {
    if (!segmentDrag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const state = segmentDrag,
      edge = data.edges.find((e) => e.id === state.edgeId),
      delta =
        (state.axis === "x"
          ? e.clientX - state.startX
          : e.clientY - state.startY) / zoom;
    if (!state.moved && Math.abs(delta) < 3) return;
    if (!state.moved) checkpoint();
    state.moved = true;
    const points = state.points.map((p) => ({ ...p }));
    const value = Math.max(
      state.axis === "x" ? laneWidth + 10 : 10,
      points[state.index][state.axis] + delta,
    );
    points[state.index - 1][state.axis] = value;
    points[state.index][state.axis] = value;
    edge.route = points;
    render();
  },
  true,
);
$(".stage").addEventListener(
  "pointerup",
  (e) => {
    if (!segmentDrag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    segmentDrag = null;
    suppressClick();
    render();
    properties();
  },
  true,
);
$(".stage").addEventListener("pointercancel", () => (segmentDrag = null), true);
async function setWorkspaceRows(lane, value) {
  value = Number(value);
  if (!Number.isInteger(value) || value < 1 || value > 20) return false;
  if (value === laneRows(lane)) return true;
  const affected = data.nodes.filter(
    (n) => n.lane === lane.id && (Number(n.row) || 0) >= value,
  );
  if (
    value < laneRows(lane) &&
    affected.length &&
    !(await confirmAction(
      "配置行数を減らしますか？",
      `減らす行に${affected.length}個の図形があります。図形は残る最後の行へ移動し、接続線は保持します。`,
      "行数を減らす",
    ))
  )
    return false;
  checkpoint();
  lane.rows = value;
  data.nodes
    .filter((n) => n.lane === lane.id)
    .forEach((n) => (n.row = Math.min(Number(n.row) || 0, value - 1)));
  render();
  return true;
}
function rowNamesEditor(root, lane) {
  const wrapper = document.createElement("details");
  wrapper.className = "row-names-editor";
  wrapper.dataset.laneId = lane.id;
  const summary = document.createElement("summary");
  summary.textContent = "部署内の行名（任意）";
  wrapper.append(summary);
  for (let row = 0; row < laneRows(lane); row++) {
    const label = document.createElement("label");
    label.textContent = String(row + 1) + "行目";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "名前なし";
    input.setAttribute(
      "aria-label",
      lane.name + " " + (row + 1) + "行目の名前",
    );
    input.value = lane.rowNames?.[row] || "";
    input.onfocus = () => checkpoint();
    input.oninput = () => {
      lane.rowNames = Array.from(
        { length: laneRows(lane) },
        (_, i) => lane.rowNames?.[i] || "",
      );
      lane.rowNames[row] = input.value;
      render();
    };
    label.append(input);
    wrapper.append(label);
  }
  root.append(wrapper);
}
function refreshRowNamesEditor(root, lane) {
  const previous = Array.from(root.querySelectorAll(".row-names-editor")).find(
    (el) => el.dataset.laneId === lane.id,
  );
  if (!previous) return;
  const holder = document.createElement("div");
  rowNamesEditor(holder, lane);
  const next = holder.firstElementChild;
  next.open = previous.open;
  previous.replaceWith(next);
}

function workspaceSettings(root) {
  const section = document.createElement("section");
  section.className = "workspace-settings";
  root.append(section);
  const heading = document.createElement("h3");
  heading.textContent = "種別";
  section.append(heading);
  const types = document.createElement("div");
  types.className = "workspace-types";
  section.append(types);
  getTypes().forEach((type) => {
    const row = document.createElement("div");
    row.className = "workspace-type-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = type;
    input.maxLength = 100;
    input.setAttribute("aria-label", "種別名 " + type);
    input.onchange = () => {
      const next = input.value.trim();
      if (
        !next ||
        next === "自由入力" ||
        getTypes().some((t) => t === next && t !== type)
      ) {
        input.value = type;
        return;
      }
      checkpoint();
      data.types = getTypes().map((t) => (t === type ? next : t));
      data.lanes
        .filter((l) => l.customType !== true && l.type === type)
        .forEach((l) => (l.type = next));
      render();
      workspaceSettingsRefresh();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "種別「" + type + "」を選択肢から外す");
    remove.onclick = () => {
      if (data.lanes.some((l) => l.customType !== true && l.type === type)) {
        toast("使用中の種別は先に各行の種別を変更してください");
        return;
      }
      checkpoint();
      data.types = getTypes().filter((t) => t !== type);
      workspaceSettingsRefresh();
    };
    row.append(input, remove);
    types.append(row);
  });
  const typeAdd = document.createElement("div");
  typeAdd.className = "workspace-type-row";
  const newType = document.createElement("input");
  newType.placeholder = "新しい種別";
  newType.maxLength = 100;
  newType.setAttribute("aria-label", "追加する種別名");
  const addType = document.createElement("button");
  addType.type = "button";
  addType.textContent = "追加";
  function addTypeValue() {
    const text = newType.value.trim();
    if (
      !text ||
      text === "自由入力" ||
      getTypes().includes(text) ||
      getTypes().length >= 50
    )
      return;
    checkpoint();
    data.types = [...getTypes(), text];
    workspaceSettingsRefresh();
  }
  addType.onclick = addTypeValue;
  newType.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTypeValue();
    }
  };
  typeAdd.append(newType, addType);
  section.append(typeAdd);
  const laneHeading = document.createElement("h3");
  laneHeading.textContent = "部署・システムの行";
  section.append(laneHeading);
  const cards = document.createElement("div");
  cards.className = "workspace-lanes";
  section.append(cards);
  data.lanes.forEach((lane, index) => {
    const card = document.createElement("section");
    card.className = "workspace-lane";
    const top = document.createElement("div");
    top.className = "workspace-lane-heading";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "削除";
    remove.onclick = async () => {
      const nodes = data.nodes.filter((n) => n.lane === lane.id);
      if (
        !(await confirmAction(
          "部署・システムの行を削除しますか？",
          `「${lane.name}」${nodes.length ? "と図形" + nodes.length + "個、および接続線" : ""}を削除します。`,
          "削除する",
        ))
      )
        return;
      checkpoint();
      const ids = new Set(nodes.map((n) => n.id));
      data.lanes = data.lanes.filter((l) => l.id !== lane.id);
      data.nodes = data.nodes.filter((n) => !ids.has(n.id));
      data.edges = data.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
      render();
      workspaceSettingsRefresh();
    };
    top.append(number, remove);
    card.append(top);
    function field(label, input) {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      wrap.append(input);
      card.append(wrap);
    }
    const name = document.createElement("input");
    name.type = "text";
    name.value = lane.name;
    name.setAttribute("aria-label", "行" + (index + 1) + "の名前");
    name.onfocus = () => checkpoint();
    name.oninput = () => {
      lane.name = name.value;
      render();
    };
    field("行の名前", name);
    const type = document.createElement("select");
    type.setAttribute("aria-label", "行" + (index + 1) + "の種別");
    [...new Set([...getTypes(), lane.type])].forEach((t) => {
      const option = document.createElement("option");
      option.value = t;
      option.textContent = t;
      type.append(option);
    });
    type.value = lane.type;
    type.onchange = () => {
      checkpoint();
      lane.type = type.value;
      lane.customType = !getTypes().includes(type.value);
      render();
    };
    field("種別", type);
    const rowControls = document.createElement("div");
    rowControls.className = "workspace-row-controls";
    const rows = document.createElement("input");
    rows.type = "number";
    rows.min = "1";
    rows.max = "20";
    rows.value = laneRows(lane);
    rows.setAttribute("aria-label", "行" + (index + 1) + "の配置行数");
    async function updateRows(value) {
      if (await setWorkspaceRows(lane, value)) workspaceSettingsRefresh();
      else rows.value = laneRows(lane);
    }
    rows.onchange = () => updateRows(rows.value);
    for (const [label, delta] of [
      ["増やす", 1],
      ["減らす", -1],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = delta === 1 ? "↑" : "↓";
      b.setAttribute("aria-label", lane.name + "の配置行を" + label);
      b.disabled =
        (delta < 0 && laneRows(lane) === 1) ||
        (delta > 0 && laneRows(lane) === 20);
      b.onclick = () => updateRows(laneRows(lane) + delta);
      rowControls.append(b);
    }
    rowControls.prepend(rows);
    field("図形を配置できる行数", rowControls);
    rowNamesEditor(card, lane);
    const background = document.createElement("details");
    background.className = "workspace-color";
    const summary = document.createElement("summary");
    summary.textContent = "背景色";
    background.append(summary);
    colorEditor(
      background,
      "背景色",
      color(lane.fill, index % 2 ? "#edf7fd" : "#f4faff"),
      (c) => {
        lane.fill = c;
        workspaceSettingsRefresh();
      },
    );
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "デフォルトに戻す";
    reset.disabled = !lane.fill;
    reset.onclick = () => {
      checkpoint();
      delete lane.fill;
      render();
      workspaceSettingsRefresh();
    };
    background.append(reset);
    card.append(background);
    const order = document.createElement("div");
    order.className = "workspace-order";
    for (const [text, offset] of [
      ["↑ 上へ", -1],
      ["↓ 下へ", 1],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.disabled =
        index + offset < 0 || index + offset >= data.lanes.length;
      button.onclick = () => {
        checkpoint();
        [data.lanes[index], data.lanes[index + offset]] = [
          data.lanes[index + offset],
          data.lanes[index],
        ];
        render();
        workspaceSettingsRefresh();
      };
      order.append(button);
    }
    card.append(order);
    cards.append(card);
  });
  const addLane = document.createElement("button");
  addLane.type = "button";
  addLane.className = "workspace-add-lane";
  addLane.textContent = "行を追加";
  addLane.onclick = () => {
    if (!canAdd({ lanes: 1 })) return;
    checkpoint();
    data.lanes.push({
      id: uid(),
      name: "",
      type: getTypes()[0] || "部署",
      rows: 1,
    });
    render();
    workspaceSettingsRefresh();
  };
  section.append(addLane);
}
function workspaceSettingsRefresh() {
  function refresh(root, build, scroller) {
    const openIds = new Set(
        Array.from(root.querySelectorAll(".row-names-editor[open]")).map(
          (el) => el.dataset.laneId,
        ),
      ),
      scroll = scroller.scrollTop;
    root.innerHTML = "";
    build(root);
    root
      .querySelectorAll(".row-names-editor")
      .forEach((el) => (el.open = openIds.has(el.dataset.laneId)));
    scroller.scrollTop = scroll;
  }
  if ($("#setup-dialog").open) {
    const root = $("#setup-content");
    refresh(root, workspaceSettings, root);
  }
  if (selected?.kind === "global") {
    const root = $("#properties");
    refresh(root, globalProperties, root.parentElement);
  }
}
const previousProperties = properties;
properties = function () {
  previousProperties();
  if (selected?.kind === "edges") {
    const edge = data.edges.find((e) => e.id === selected.id);
    if (edge?.route) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "経路を自動調整";
      reset.onclick = () => {
        checkpoint();
        delete edge.route;
        render();
        properties();
      };
      $("#properties").append(reset);
    }
  }
};
$("#close-setup").onclick = () => $("#setup-dialog").close();
$("#finish-setup").onclick = () => $("#setup-dialog").close();
workspaceSettings($("#setup-content"));
$("#setup-dialog").showModal();
