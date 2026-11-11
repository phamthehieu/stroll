import { SvgXml } from "react-native-svg";

import { KUBAI_ICONS, type KubaiIconName } from "./kubai-data";

export type { KubaiIconName };

type Props = {
  name: KubaiIconName;
  size?: number;
  /** "color": bản nhiều màu (đang chọn). "soft": bản xám nhạt (không chọn). */
  variant?: "color" | "soft";
};

export function KubaiIcon({ name, size = 24, variant = "color" }: Props) {
  return <SvgXml xml={KUBAI_ICONS[name][variant]} width={size} height={size} />;
}
