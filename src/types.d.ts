type Side = "top" | "right" | "bottom" | "left";
type Shape = "action" | "decision";
type LineShape = "straight" | "orthogonal" | "curve";
type LineDash = "solid" | "dashed" | "dotted";
type ItemKind = "lanes" | "nodes" | "edges";
type EditorMode = "select" | "edit";
type EditorSelection =
  | { kind: "global"; id?: never }
  | { kind: ItemKind; id: string };
type Point = { x: number; y: number };
type Anchor = Point & { side: Side; nodeId?: string };
type ConnectionStart = { id: string; side: Side };
type Snap = { node: FlowNode; side: Side; point: Anchor; distance: number };
interface Lane {
  id: string;
  name: string;
  type: string;
  rows?: number;
  rowNames?: string[];
  customType?: boolean;
  fill?: string;
}
interface FlowNode {
  id: string;
  lane: string;
  row?: number;
  x: number;
  type: Shape;
  text: string;
  fill?: string;
  stroke?: string;
}
interface FlowEdge {
  id: string;
  from: string;
  to: string;
  fromPort?: Side;
  toPort?: Side;
  label: string;
  color?: string;
  labelFill?: string;
  shape?: LineShape;
  dash?: LineDash;
  width?: number;
  startArrow?: boolean;
  endArrow?: boolean;
  route?: Point[];
}
interface Project {
  version: 1;
  title: string;
  lanes: Lane[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  laneWidth?: number;
  types?: string[];
  customColors?: string[];
}
