// Sinh src/components/kubai/kubai-data.ts từ gói kubai-icons-static.
// Chạy: node scripts/gen-kubai-icons.mjs
// Thêm icon mới: bổ sung tên vào ICONS rồi chạy lại.
//
// Bỏ <filter> và thuộc tính filter="url(#...)" (bóng đổ / highlight) để SVG nhẹ và
// render ổn định bằng react-native-svg. Mask, gradient, clipPath được giữ nguyên.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICONS = ["podium", "users", "user", "chevron-down", "clock", "navigation", "flame"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "kubai-icons-static");

function clean(svg) {
  return svg
    .replace(/<filter\b[\s\S]*?<\/filter>/g, "")
    .replace(/\sfilter="url\(#[^)]*\)"/g, "")
    .trim();
}

const data = {};
for (const name of ICONS) {
  data[name] = {
    color: clean(readFileSync(join(pkg, "svg", name + ".svg"), "utf8")),
    soft: clean(readFileSync(join(pkg, "svg-soft", name + ".svg"), "utf8")),
  };
}

const out = join(root, "src", "components", "kubai", "kubai-data.ts");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  "// TỰ SINH bởi scripts/gen-kubai-icons.mjs — đừng sửa tay.\n" +
    "// Icon: Kubai Icons (MIT) https://github.com/kubai087/kubai-icons\n\n" +
    "export const KUBAI_ICONS = " +
    JSON.stringify(data, null, 2) +
    " as const;\n\nexport type KubaiIconName = keyof typeof KUBAI_ICONS;\n",
);
console.log("Đã ghi " + ICONS.length + " icon vào " + out);
