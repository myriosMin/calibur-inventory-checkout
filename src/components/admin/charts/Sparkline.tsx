import { slotColor } from "./theme";

/** A tiny trend line for a stat tile. No axes: the tile's number is the value. */
export default function Sparkline({
  values,
  slot = 1,
  height = 32,
  label,
}: {
  values: number[];
  slot?: number;
  height?: number;
  label?: string;
}) {
  if (values.length < 2) return null;
  const width = 120;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const y = (value: number) => height - 2 - (value / max) * (height - 4);
  const line = values.map((value, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const color = slotColor(slot);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} opacity={0.15} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
