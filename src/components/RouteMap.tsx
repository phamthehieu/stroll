import { useMemo } from "react";
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

import type { Mode, StoredPoint } from "@/lib/route-store";

export const MODE_COLORS: Record<Mode, string> = {
  walk: "#22B573",
  run: "#3D6BFF",
  vehicle: "#E5484D",
  still: "#9AA0AE",
  unknown: "#C0C5D0",
};

const GAP_MS = 10 * 60 * 1000; // quá 10 phút không có điểm thì không nối đường
const M_PER_DEG = 111320;
const SCALE_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

type Run = { mode: Mode; pts: StoredPoint[] };

/** Chia lộ trình thành các đoạn liền mạch cùng cách di chuyển. */
function toRuns(points: StoredPoint[]): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  let prev: StoredPoint | null = null;
  for (const p of points) {
    const gap = prev ? p.t - prev.t > GAP_MS : true;
    if (!cur || gap || cur.mode !== p.mode) {
      cur = { mode: p.mode, pts: gap || !prev ? [p] : [prev, p] };
      runs.push(cur);
    } else {
      cur.pts.push(p);
    }
    prev = p;
  }
  return runs;
}

type Props = { points: StoredPoint[]; width: number; height: number };

/** Vẽ lộ trình bằng SVG (không có nền bản đồ): đường tô màu theo cách di chuyển, điểm đầu xanh, điểm cuối đỏ. */
export function RouteMap({ points, width, height }: Props) {
  const view = useMemo(() => {
    if (points.length === 0) return null;
    const pad = 20;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    // Tối thiểu ~40 m để lộ trình rất ngắn không bị phóng quá đà.
    const spanX = Math.max((maxLng - minLng) * k, 0.0004);
    const spanY = Math.max(maxLat - minLat, 0.0004);
    const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
    const offX = (width - spanX * scale) / 2;
    const offY = (height - spanY * scale) / 2;
    const project = (p: StoredPoint) => ({
      x: offX + (p.lng - minLng) * k * scale,
      y: offY + (maxLat - p.lat) * scale,
    });
    const pxPerM = scale / M_PER_DEG;
    let bar = SCALE_STEPS[0];
    for (const s of SCALE_STEPS) if (s * pxPerM <= 110) bar = s;
    return { project, bar, barPx: bar * pxPerM };
  }, [points, width, height]);

  if (!view) return null;
  const { project, bar, barPx } = view;
  const runs = toRuns(points);
  const first = project(points[0]);
  const last = project(points[points.length - 1]);

  return (
    <Svg width={width} height={height} accessibilityLabel="Bản vẽ lộ trình">
      <Rect x={0} y={0} width={width} height={height} rx={16} fill="#F4F7FB" />
      {runs.map((r, i) => {
        const pts = r.pts.map((p) => {
          const { x, y } = project(p);
          return x.toFixed(1) + "," + y.toFixed(1);
        });
        if (pts.length < 2) {
          const { x, y } = project(r.pts[0]);
          return <Circle key={i} cx={x} cy={y} r={2.5} fill={MODE_COLORS[r.mode]} />;
        }
        return (
          <Polyline
            key={i}
            points={pts.join(" ")}
            fill="none"
            stroke={MODE_COLORS[r.mode]}
            strokeWidth={r.mode === "still" ? 2 : 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={r.mode === "still" ? 0.7 : 1}
          />
        );
      })}
      <Circle cx={first.x} cy={first.y} r={7} fill="#fff" stroke="#22B573" strokeWidth={3} />
      <Circle cx={last.x} cy={last.y} r={7} fill="#fff" stroke="#E5484D" strokeWidth={3} />
      <G x={16} y={height - 22}>
        <Line x1={0} y1={0} x2={barPx} y2={0} stroke="#5B6475" strokeWidth={2} />
        <Line x1={0} y1={-4} x2={0} y2={4} stroke="#5B6475" strokeWidth={2} />
        <Line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="#5B6475" strokeWidth={2} />
        <SvgText x={barPx + 8} y={4} fontSize={11} fill="#5B6475">
          {bar >= 1000 ? bar / 1000 + " km" : bar + " m"}
        </SvgText>
      </G>
    </Svg>
  );
}
