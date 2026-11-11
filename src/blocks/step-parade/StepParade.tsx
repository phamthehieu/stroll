import {
  Canvas,
  createPicture,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  type SkCanvas,
} from "@shopify/react-native-skia";
import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { KubaiIcon } from "@/components/kubai/KubaiIcon";

import { H0, H1, SAMPLES, type Friend, type Scene } from "./sp-data";

/*
 Step Parade — the friends tab of an invented step-counting app, Stroll.

 Look (a Pinterest video of a social step counter): a white page with a Friends switcher, a week strip
 of who won each day, "Steps today" in a big number, then a wide snowy panorama where everyone's
 character walks along, name bubbles over their heads, and a tab bar of friends' faces.

 Ours: the panorama is the chart. Each friend walks their own lane and stands exactly as far along
 as their steps at the scrubbed time; their legs move only when their steps go up, so a morning
 runner sprints at 7 AM while the evening walker stands still until dinner, and footprints in the
 snow trace the day. Drag across the scene to scrub the day from 6 AM to 10 PM: the sky moves from
 dawn pink to night blue, the sun turns into the moon, your counter, distance and active time follow;
 release and everyone walks back up to now. Tap a walker to see their steps in their bubble.

 autoPlay: LOOP = 9 s — the day plays from 6 AM to now (0–6.5 s, smootherstep), holds, then rewinds
 to 6 AM (7.8–9.0 s, everyone moonwalks back). Frame 9 = frame 0. Reduced motion: no scrubbing
 animation in autoplay (the scene rests at now); drag still works and snaps.
*/

let debugState = "";

const LOOP = 9;

const clamp01 = (v: number) => {
  "worklet";
  return v < 0 ? 0 : v > 1 ? 1 : v;
};
const smoother = (k: number) => {
  "worklet";
  const x = clamp01(k);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const mixN = (a: number, b: number, k: number) => {
  "worklet";
  return a + (b - a) * k;
};
const scriptH = (now: number, t: number) => {
  "worklet";
  if (t < 6.5) return H0 + (now - H0) * smoother(t / 6.5);
  if (t < 7.8) return now;
  return now - (now - H0) * smoother((t - 7.8) / 1.2);
};
/** Steps of friend i at hour h (linear between the 15-minute samples). */
const stepsAt = (d: Scene, i: number, h: number) => {
  "worklet";
  const u = (clamp01((h - H0) / (H1 - H0)) * (SAMPLES - 1)) as number;
  const k = Math.floor(u);
  const c = d.curves[i];
  if (k >= SAMPLES - 1) return c[SAMPLES - 1];
  return mixN(c[k], c[k + 1], u - k);
};
const hex = (c: string) => {
  "worklet";
  return [
    parseInt(c.slice(1, 3), 16) / 255,
    parseInt(c.slice(3, 5), 16) / 255,
    parseInt(c.slice(5, 7), 16) / 255,
  ];
};
const SKY_H = [6, 9, 13, 17.5, 19.5, 22];
const SKY_TOP = [
  "#FFB9A6",
  "#BFDBFF",
  "#A9CEFF",
  "#9EC2F7",
  "#FF9F7A",
  "#1F2A57",
];
const SKY_BOT = [
  "#FFE9DD",
  "#EFF6FF",
  "#EAF4FF",
  "#F2EADF",
  "#FFD9BF",
  "#4B5B95",
];
const skyAt = (h: number, top: boolean) => {
  "worklet";
  const arr = top ? SKY_TOP : SKY_BOT;
  let i = 0;
  while (i < SKY_H.length - 2 && h > SKY_H[i + 1]) i++;
  const k = clamp01((h - SKY_H[i]) / (SKY_H[i + 1] - SKY_H[i]));
  const a = hex(arr[i]);
  const b = hex(arr[i + 1]);
  return Skia.Color(
    `rgb(${Math.round(mixN(a[0], b[0], k) * 255)},${Math.round(mixN(a[1], b[1], k) * 255)},${Math.round(mixN(a[2], b[2], k) * 255)})`,
  );
};
const fmtTime = (h: number) => {
  "worklet";
  const m = Math.floor(h * 4) * 15;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh < 10 ? "0" : ""}${hh}:${mm < 10 ? "0" : ""}${mm}`;
};
const fmtNum = (n: number) => {
  "worklet";
  const v = Math.round(n);
  const s = `${v}`;
  return s.length > 3
    ? `${s.slice(0, s.length - 3)},${s.slice(s.length - 3)}`
    : s;
};

type Geo = { x: number; y: number; w: number; h: number };
/** where friend i stands: lane y, depth scale and x for a step count */
const placeOf = (d: Scene, g: Geo, i: number, steps: number) => {
  "worklet";
  const lane = d.friends[i].lane;
  const depth = 0.86 + lane * 0.09;
  const y = g.y + g.h * 0.5 + lane * (g.h * 0.086);
  const x = g.x + 24 + lane * 7 + (steps / d.max) * (g.w - 84);
  return { x, y, s: depth };
};

const fill = (c: string, a = 1) => {
  "worklet";
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(c));
  p.setAlphaf(a);
  return p;
};
const line = (c: string, w: number, a = 1) => {
  "worklet";
  const p = fill(c, a);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(w);
  p.setStrokeCap(StrokeCap.Round);
  return p;
};

/** A toy walker standing on (x, y), scale s, walk phase ph, facing right. */
const drawWalker = (
  cv: SkCanvas,
  x: number,
  y: number,
  s: number,
  ph: number,
  i: number,
  sel: number,
  d: Scene,
) => {
  "worklet";
  const f = d.friends[i];
  const sw = Math.sin(ph);
  const bob = Math.abs(Math.cos(ph)) * 2 * s;
  cv.drawOval(
    Skia.XYWHRect(x - 13 * s, y - 3 * s, 26 * s, 6 * s),
    fill("#5C7A99", 0.18),
  );
  const hip = y - 17 * s - bob;
  const legs = line("#2B2F3A", 6.5 * s);
  cv.drawLine(
    x,
    hip,
    x + Math.sin(sw * 0.55) * 14 * s,
    hip + Math.cos(sw * 0.55) * 15 * s,
    legs,
  );
  cv.drawLine(
    x,
    hip,
    x - Math.sin(sw * 0.55) * 14 * s,
    hip + Math.cos(sw * 0.55) * 15 * s,
    line("#3A3F4C", 6.5 * s),
  );
  // back arm, body, front arm
  const sh = hip - 17 * s;
  cv.drawLine(
    x - 2 * s,
    sh + 3 * s,
    x - 2 * s + Math.sin(sw * 0.6) * 11 * s,
    sh + 3 * s + Math.cos(sw * 0.6) * 12 * s,
    line(f.coat, 6 * s, 0.8),
  );
  cv.drawRRect(
    Skia.RRectXY(
      Skia.XYWHRect(x - 11 * s, sh - 4 * s, 22 * s, 24 * s),
      10 * s,
      10 * s,
    ),
    fill(f.coat),
  );
  cv.drawLine(
    x - 9 * s,
    sh + 8 * s,
    x + 9 * s,
    sh + 8 * s,
    line("#FFFFFF", 1.4 * s, 0.35),
  );
  cv.drawLine(
    x + 2 * s,
    sh + 3 * s,
    x + 2 * s - Math.sin(sw * 0.6) * 11 * s,
    sh + 3 * s + Math.cos(sw * 0.6) * 12 * s,
    line(f.coat, 6 * s),
  );
  // head, eyes looking ahead, beanie with a pom
  const hy = sh - 12 * s;
  cv.drawCircle(x + 1 * s, hy, 10 * s, fill(f.skin));
  cv.drawCircle(x + 5 * s, hy + 1 * s, 1.4 * s, fill("#1B1E26"));
  cv.drawCircle(x + 9 * s, hy + 1 * s, 1.4 * s, fill("#1B1E26"));
  const hat = Skia.PathBuilder.Make();
  hat.addArc(Skia.XYWHRect(x - 9 * s, hy - 12 * s, 20 * s, 20 * s), 180, 180);
  hat.close();
  cv.drawPath(hat.detach(), fill(f.hat));
  cv.drawRRect(
    Skia.RRectXY(
      Skia.XYWHRect(x - 10 * s, hy - 4 * s, 22 * s, 5 * s),
      2.5 * s,
      2.5 * s,
    ),
    fill(f.hat),
  );
  cv.drawCircle(x + 1 * s, hy - 13 * s, 3.4 * s, fill("#FFFFFF"));
  if (sel === i) cv.drawCircle(x, y - 1, 16 * s, line("#1B1E26", 1.5, 0.25));
};

type Out = { h: number; sel: number };

const drawScene = (cv: SkCanvas, g: Geo, o: Out, d: Scene) => {
  "worklet";
  const h = o.h;
  cv.save();
  cv.clipRRect(
    Skia.RRectXY(Skia.XYWHRect(g.x, g.y, g.w, g.h), 28, 28),
    1,
    true,
  );
  // sky
  const sky = Skia.Paint();
  sky.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: g.y },
      { x: 0, y: g.y + g.h * 0.5 },
      [skyAt(h, true), skyAt(h, false)],
      null,
      0,
    ),
  );
  cv.drawRect(Skia.XYWHRect(g.x, g.y, g.w, g.h), sky);
  // sun by day, moon after 19:30, travelling one arc
  const night = clamp01((h - 19) / 1.5);
  const arc = clamp01((h - H0) / (H1 - H0));
  const sx = g.x + 30 + arc * (g.w - 60);
  const sy = g.y + g.h * 0.36 - Math.sin(arc * Math.PI) * g.h * 0.22;
  cv.drawCircle(sx, sy, 15, fill("#FFD36B", 1 - night));
  cv.drawCircle(sx, sy, 24, fill("#FFD36B", 0.18 * (1 - night)));
  if (night > 0) {
    cv.drawCircle(sx, sy, 12, fill("#F4F1E1", night));
    cv.drawCircle(sx + 5, sy - 3, 10, fill(SKY_TOP[5], night));
    for (let k = 0; k < 14; k++) {
      cv.drawCircle(
        g.x + ((k * 97) % 360) * (g.w / 360),
        g.y + 12 + ((k * 53) % 60),
        1.2,
        fill("#FFFFFF", 0.8 * night),
      );
    }
  }
  // far hills, then the snow field
  const hor = g.y + g.h * 0.4;
  const hills = Skia.PathBuilder.Make();
  hills.moveTo(g.x, hor);
  for (let k = 0; k <= 24; k++) {
    const xx = g.x + (g.w * k) / 24;
    hills.lineTo(xx, hor - 16 - 12 * Math.sin(k * 0.9) - 8 * Math.sin(k * 2.3));
  }
  hills.lineTo(g.x + g.w, hor);
  hills.close();
  cv.drawPath(hills.detach(), fill(night > 0.5 ? "#9AA9CF" : "#D8E6F4"));
  const snow = Skia.Paint();
  snow.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: hor },
      { x: 0, y: g.y + g.h },
      [Skia.Color("#F3F8FD"), Skia.Color("#DCE9F5")],
      null,
      0,
    ),
  );
  cv.drawRect(Skia.XYWHRect(g.x, hor, g.w, g.h), snow);
  // pines and a snowman
  for (let k = 0; k < 5; k++) {
    const px = g.x + 40 + k * (g.w / 5) + (k % 2) * 18;
    const py = hor + 2 + (k % 2) * 4;
    const tr = Skia.PathBuilder.Make();
    tr.moveTo(px, py - 34);
    tr.lineTo(px + 11, py - 8);
    tr.lineTo(px - 11, py - 8);
    tr.close();
    tr.moveTo(px, py - 24);
    tr.lineTo(px + 14, py + 2);
    tr.lineTo(px - 14, py + 2);
    tr.close();
    cv.drawPath(tr.detach(), fill("#2E6B5E"));
    cv.drawCircle(px - 4, py - 22, 2.2, fill("#FFFFFF", 0.9));
  }
  const snx = g.x + g.w - 34;
  cv.drawCircle(snx, hor + 22, 13, fill("#FFFFFF"));
  cv.drawCircle(snx, hor + 4, 9, fill("#FFFFFF"));
  cv.drawCircle(snx + 3, hor + 3, 1.3, fill("#1B1E26"));
  cv.drawLine(snx + 6, hor + 6, snx + 13, hor + 7, line("#FF8A3D", 2.4));
  // walkers back to front, each with footprints along their lane
  for (let lane = 0; lane < d.lanes; lane++) {
    let i = 0;
    while (d.friends[i].lane !== lane) i++;
    const st = stepsAt(d, i, h);
    const p = placeOf(d, g, i, st);
    const start = g.x + 24 + d.friends[i].lane * 7;
    const prints = fill("#B8CCE0", 0.75);
    for (let fx = start; fx < p.x - 10 * p.s; fx += 9 * p.s) {
      const odd = Math.round((fx - start) / (9 * p.s)) % 2;
      cv.drawOval(
        Skia.XYWHRect(
          fx,
          p.y - 1.5 * p.s + (odd ? 2.5 : -1) * p.s,
          4.5 * p.s,
          2.2 * p.s,
        ),
        prints,
      );
    }
    drawWalker(cv, p.x, p.y, p.s, st * 0.006, i, o.sel, d);
  }
  // dusk tint over everything as night falls
  if (night > 0)
    cv.drawRect(
      Skia.XYWHRect(g.x, g.y, g.w, g.h),
      fill("#1E2A57", 0.22 * night),
    );
  cv.restore();
};

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

type Props = {
  scene: Scene;
  groupName: string;
  onSwitchGroup?: () => void;
  autoPlay?: boolean;
};

export function StepParade({ scene, groupName, onSwitchGroup, autoPlay = false }: Props) {
  const d = scene;
  const NOW = d.now;
  const reduced = useReducedMotion();
  const auto = autoPlay && !reduced;
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const [fontsOk] = useFonts({
    "SP-Regular": require("./assets/fonts/Inter-Regular.ttf"),
    "SP-SemiBold": require("./assets/fonts/Inter-SemiBold.ttf"),
    "SP-Bold": require("./assets/fonts/Inter-Bold.ttf"),
  });

  const top = insets.top;
  // Màn hình ngắn thì thu nhỏ cảnh để khối Quãng đường / Thời gian vận động không bị che.
  const [avail, setAvail] = useState(0);
  const sceneH = avail > 0 ? Math.max(170, Math.min(252, avail - (top + 268) - 140)) : 252;
  const g: Geo = { x: 16, y: top + 268, w: W - 32, h: sceneH };

  const st = useSharedValue({
    h: auto ? H0 : NOW,
    hv: 0,
    drag: 0,
    h0: NOW,
    lastTouch: -100,
    scripted: 0,
    loopT: 0,
    sel: -1,
    lastHour: 0,
  });
  const clock = useSharedValue(0);
  const debugT = useSharedValue(-1);
  const out = useSharedValue<Out>({ h: auto ? H0 : NOW, sel: -1 });
  const [selName, setSelName] = useState(-1);

  useEffect(() => {
    if (!__DEV__) return;
    const gl = globalThis as { __stepParade?: unknown };
    gl.__stepParade = {
      at: (x: number) => debugT.set(x),
      play: () => debugT.set(-1),
      state: () => debugState,
    };
    return () => {
      delete gl.__stepParade;
    };
  }, [debugT]);
  const mirror = (s: string) => {
    debugState = s;
  };
  const tick = () => {
    if (process.env.EXPO_OS === "web") return;
    Haptics.selectionAsync().catch(() => {});
  };

  useFrameCallback((info) => {
    const wall = Math.max(0, (info.timeSincePreviousFrame ?? 16) / 1000);
    const dt = Math.min(wall, 0.05);
    const now = clock.get() + wall;
    clock.set(now);
    const s = st.get();
    const dbg = debugT.get();
    if (dbg >= 0) {
      out.set({ h: scriptH(NOW, dbg % LOOP), sel: -1 });
      return;
    }
    if (
      auto &&
      s.drag === 0 &&
      now - s.lastTouch > 3.5 &&
      (s.scripted === 1 || Math.abs(s.h - NOW) < 0.01)
    ) {
      if (s.scripted === 0) {
        s.scripted = 1;
        s.loopT = 7.0; // rest at now, so nothing jumps
        s.sel = -1;
      }
      s.loopT = (s.loopT + wall) % LOOP;
      s.h = scriptH(NOW, s.loopT);
      s.hv = 0;
    } else {
      s.scripted = 0;
      if (s.drag === 0) {
        // walk back up to now: a critically damped spring
        const k = reduced ? 400 : 18;
        const c = 2 * Math.sqrt(k);
        s.hv += (k * (NOW - s.h) - c * s.hv) * dt;
        s.h += s.hv * dt;
      }
    }
    out.set({ h: s.h, sel: s.sel });
    if (__DEV__ && Math.floor(now * 4) !== Math.floor((now - wall) * 4)) {
      scheduleOnRN(
        mirror,
        `h=${s.h.toFixed(2)} scripted=${s.scripted} drag=${s.drag} sel=${s.sel}`,
      );
    }
  });

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onStart(() => {
      const s = st.get();
      s.drag = 1;
      s.scripted = 0;
      s.h0 = s.h;
      s.hv = 0;
      s.lastHour = Math.floor(s.h);
    })
    .onUpdate((e) => {
      const s = st.get();
      let h = s.h0 + (e.translationX / g.w) * (H1 - H0);
      if (h < H0) h = H0 - (1 - Math.exp(-(H0 - h))) * 0.4;
      if (h > NOW) h = NOW + (1 - Math.exp(-(h - NOW))) * 0.3;
      s.h = h;
      const hr = Math.floor(h);
      if (hr !== s.lastHour) {
        s.lastHour = hr;
        scheduleOnRN(tick);
      }
      s.lastTouch = clock.get();
    })
    .onFinalize(() => {
      const s = st.get();
      s.drag = 0;
      s.lastTouch = clock.get();
    });
  const tapG = Gesture.Tap().onEnd((e) => {
    const s = st.get();
    s.lastTouch = clock.get();
    let best = -1;
    let bd = 34;
    for (let i = 0; i < d.friends.length; i++) {
      if (d.friends[i].lane < 0) continue;
      const p = placeOf(d, g, i, stepsAt(d, i, s.h));
      const dist = Math.hypot(e.absoluteX - p.x, e.absoluteY - (p.y - 30 * p.s));
      if (dist < bd) {
        bd = dist;
        best = i;
      }
    }
    s.sel = best === s.sel ? -1 : best;
    scheduleOnRN(setSelName, s.sel);
    scheduleOnRN(tick);
  });
  const gesture = Gesture.Race(pan, tapG);

  const picture = useDerivedValue(() =>
    createPicture((cv) => drawScene(cv, g, out.get(), d)),
  );
  const youSteps = useAnimatedProps(() => {
    const v = fmtNum(stepsAt(d, d.me, out.get().h));
    return { text: v, defaultValue: v } as never;
  });
  const timeText = useAnimatedProps(() => {
    const v = fmtTime(out.get().h);
    return { text: v, defaultValue: v } as never;
  });
  const km = useAnimatedProps(() => {
    const v = `${((stepsAt(d, d.me, out.get().h) * 0.72) / 1000).toFixed(1)} km`;
    return { text: v, defaultValue: v } as never;
  });
  const active = useAnimatedProps(() => {
    const m = Math.round(stepsAt(d, d.me, out.get().h) / 110);
    const v = `${Math.floor(m / 60)}h ${m % 60}p`;
    return { text: v, defaultValue: v } as never;
  });
  const rankText = useAnimatedProps(() => {
    const h = out.get().h;
    const mine = stepsAt(d, d.me, h);
    let rank = 1;
    let lead = 0;
    let leader = d.me;
    for (let i = 0; i < d.friends.length; i++) {
      const v = stepsAt(d, i, h);
      if (i !== d.me && v > mine) rank++;
      if (v > lead) {
        lead = v;
        leader = i;
      }
    }
    const n = d.friends.length;
    const v =
      n === 1
        ? "Bạn là thành viên duy nhất, hãy mời bạn bè"
        : leader === d.me || lead <= mine
          ? `Hạng ${rank}/${n} · đang dẫn đầu`
          : `Hạng ${rank}/${n} · kém ${d.friends[leader].name} ${fmtNum(lead - mine)}`;
    return { text: v, defaultValue: v } as never;
  });
  const thumb = useAnimatedStyle(() => ({
    transform: [
      { translateX: clamp01((out.get().h - H0) / (H1 - H0)) * (g.w - 40) },
    ],
  }));

  if (!fontsOk) return <View style={styles.screen} />;

  return (
    <View
      style={styles.screen}
      onLayout={(e) => setAvail(e.nativeEvent.layout.height)}
    >
      <StatusBar style="dark" />
      <View style={[styles.header, { top: top + 4 }]}>
        <Pressable
          style={styles.switcher}
          onPress={onSwitchGroup}
          accessibilityRole="button"
          accessibilityLabel={`Đang xem nhóm ${groupName}. Đổi nhóm`}
        >
          <Text style={styles.switcherText} numberOfLines={1}>
            {groupName}
          </Text>
          <KubaiIcon name="chevron-down" size={18} variant="soft" />
        </Pressable>
        <View accessible accessibilityLabel="Hồ sơ của bạn">
          <Avatar f={d.friends[d.me]} size={38} />
        </View>
      </View>

      <View
        style={[styles.week, { top: top + 60 }]}
        accessible
        accessibilityLabel={`Người thắng 7 ngày qua: ${d.week.map((w) => `${w.d} ${w.win >= 0 ? d.friends[w.win].name : "chưa có"}`).join(", ")}`}
      >
        {d.week.map((w, i) => (
          <View key={i} style={styles.day}>
            <Text style={[styles.dayText, i === 6 && styles.dayToday]}>
              {w.d}
            </Text>
            <Avatar f={w.win >= 0 ? d.friends[w.win] : undefined} size={32} ring={i === 6} />
          </View>
        ))}
      </View>

      <View style={[styles.hero, { top: top + 140 }]}>
        <Text style={styles.label}>Số bước hôm nay</Text>
        <AnimatedInput
          editable={false}
          style={styles.big}
          animatedProps={youSteps}
          accessibilityLabel="Số bước hôm nay của bạn"
        />
        <AnimatedInput
          editable={false}
          style={styles.rank}
          animatedProps={rankText}
        />
      </View>

      <GestureDetector gesture={gesture}>
        <View
          style={[
            styles.sceneHit,
            { top: g.y, height: g.h, left: g.x, width: g.w },
          ]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Các thành viên đang đi bộ trong ngày. Vuốt ngang để xem lại diễn biến trong ngày"
        />
      </GestureDetector>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Picture picture={picture} />
      </Canvas>
      <View
        style={[styles.timePill, { top: g.y + 14, left: g.x + 14 }]}
        pointerEvents="none"
      >
        <KubaiIcon name="clock" size={18} variant="soft" />
        <AnimatedInput
          editable={false}
          style={styles.timeText}
          animatedProps={timeText}
        />
      </View>
      <Bubbles d={d} g={g} out={out} sel={selName} />

      <View
        style={[
          styles.timeline,
          { top: g.y + g.h + 16, left: g.x, width: g.w },
        ]}
        pointerEvents="none"
      >
        <View style={styles.track} />
        <Animated.View style={[styles.thumb, thumb]} />
        <View style={styles.hours}>
          {["6h", "10h", "14h", "18h", "22h"].map((l) => (
            <Text key={l} style={styles.hour}>
              {l}
            </Text>
          ))}
        </View>
      </View>

      <View style={[styles.stats, { top: g.y + g.h + 70 }]}>
        <View style={styles.stat} accessible accessibilityLabel="Quãng đường">
          <View style={[styles.statIcon, { backgroundColor: "#3D6BFF1A" }]}>
            <KubaiIcon name="navigation" size={22} />
          </View>
          <View>
            <AnimatedInput
              editable={false}
              style={styles.statNum}
              animatedProps={km}
            />
            <Text style={styles.statLabel}>Quãng đường</Text>
          </View>
        </View>
        <View style={styles.stat} accessible accessibilityLabel="Thời gian vận động">
          <View style={[styles.statIcon, { backgroundColor: "#FF7A451A" }]}>
            <KubaiIcon name="flame" size={22} />
          </View>
          <View>
            <AnimatedInput
              editable={false}
              style={styles.statNum}
              animatedProps={active}
            />
            <Text style={styles.statLabel}>Thời gian vận động</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function Avatar({
  f,
  size,
  ring,
}: {
  f?: Friend;
  size: number;
  ring?: boolean;
}) {
  if (!f) {
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: "#EEF0F4",
          },
          ring && styles.faceToday,
        ]}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: f.coat + "33",
        },
        ring && styles.faceToday,
      ]}
    >
      <View
        style={{
          position: "absolute",
          bottom: -size * 0.18,
          width: size * 0.78,
          height: size * 0.5,
          borderRadius: size * 0.25,
          backgroundColor: f.coat,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.26,
          width: size * 0.46,
          height: size * 0.46,
          borderRadius: size * 0.23,
          backgroundColor: f.skin,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.14,
          width: size * 0.5,
          height: size * 0.24,
          borderTopLeftRadius: size * 0.25,
          borderTopRightRadius: size * 0.25,
          backgroundColor: f.hat,
        }}
      />
    </View>
  );
}

function Bubbles({
  d,
  g,
  out,
  sel,
}: {
  d: Scene;
  g: Geo;
  out: SharedValue<Out>;
  sel: number;
}) {
  return (
    <>
      {d.friends.map((f, i) =>
        f.lane < 0 ? null : (
          <Bubble key={f.id} d={d} g={g} out={out} i={i} showSteps={sel === i} />
        ),
      )}
    </>
  );
}

function Bubble({
  d,
  g,
  out,
  i,
  showSteps,
}: {
  d: Scene;
  g: Geo;
  out: SharedValue<Out>;
  i: number;
  showSteps: boolean;
}) {
  const st = useAnimatedStyle(() => {
    const p = placeOf(d, g, i, stepsAt(d, i, out.get().h));
    return {
      transform: [
        { translateX: p.x - 40 },
        { translateY: p.y - 60 * p.s - 28 },
      ],
    };
  });
  const steps = useAnimatedProps(() => {
    const v = fmtNum(stepsAt(d, i, out.get().h));
    return { text: v, defaultValue: v } as never;
  });
  const you = i === d.me;
  return (
    <Animated.View style={[styles.bubbleWrap, st]} pointerEvents="none">
      <View style={[styles.bubble, you && styles.bubbleYou]}>
        <Text style={[styles.bubbleText, you && styles.bubbleTextYou]}>
          {d.friends[i].name}
        </Text>
        {showSteps ? (
          <AnimatedInput
            editable={false}
            style={[
              styles.bubbleText,
              styles.bubbleSteps,
              you && styles.bubbleTextYou,
            ]}
            animatedProps={steps}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8FA" },
  header: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switcher: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6E8EE",
  },
  switcherText: { fontFamily: "SP-SemiBold", fontSize: 15, color: "#1B1E26" },
  week: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  day: { alignItems: "center", gap: 6, width: 40 },
  dayText: { fontFamily: "SP-SemiBold", fontSize: 12, color: "#9AA0AE" },
  dayToday: { color: "#1B1E26" },
  avatar: { overflow: "hidden", alignItems: "center" },
  faceToday: { borderWidth: 2.5, borderColor: "#1B1E26" },
  hero: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  label: { fontFamily: "SP-SemiBold", fontSize: 15, color: "#6B7280" },
  big: {
    fontFamily: "SP-Bold",
    fontSize: 56,
    lineHeight: 64,
    color: "#1B1E26",
    padding: 0,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    minWidth: 220,
  },
  rank: {
    fontFamily: "SP-Regular",
    fontSize: 14,
    color: "#6B7280",
    padding: 0,
    textAlign: "center",
    minWidth: 300,
  },
  sceneHit: { position: "absolute" },
  timePill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.86)",
  },
  timeText: {
    fontFamily: "SP-SemiBold",
    fontSize: 13,
    color: "#1B1E26",
    padding: 0,
    fontVariant: ["tabular-nums"],
    minWidth: 62,
  },
  bubbleWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 80,
    alignItems: "center",
  },
  bubble: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E3E7EE",
  },
  bubbleYou: { backgroundColor: "#1B1E26", borderColor: "#1B1E26" },
  bubbleText: {
    fontFamily: "SP-SemiBold",
    fontSize: 11,
    color: "#1B1E26",
    padding: 0,
  },
  bubbleTextYou: { color: "#FFFFFF" },
  bubbleSteps: {
    fontFamily: "SP-Regular",
    minWidth: 36,
    fontVariant: ["tabular-nums"],
  },
  timeline: { position: "absolute", height: 40 },
  track: {
    position: "absolute",
    left: 20,
    right: 20,
    top: 9,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E3E7EE",
  },
  thumb: {
    position: "absolute",
    left: 10,
    top: 1,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 5,
    borderColor: "#1B1E26",
  },
  hours: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 24,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  hour: {
    fontFamily: "SP-Regular",
    fontSize: 11,
    color: "#9AA0AE",
    width: 40,
    textAlign: "center",
  },
  stats: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 12,
  },
  stat: {
    flex: 1,
    height: 64,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#ECEEF2",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statNum: {
    fontFamily: "SP-Bold",
    fontSize: 17,
    color: "#1B1E26",
    padding: 0,
    fontVariant: ["tabular-nums"],
    minWidth: 80,
  },
  statLabel: {
    fontFamily: "SP-Regular",
    fontSize: 12,
    color: "#9AA0AE",
    marginTop: 1,
  },
});
