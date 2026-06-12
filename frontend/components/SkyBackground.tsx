"use client";

export default function SkyBackground({ theme }: { theme: "light" | "dark" }) {
  const light = theme === "light";

  const c = light
    ? { d0: "#1a3a15", d1: "#2d5a27", d2: "#3a6b32", d3: "#4a7c42", d4: "#5a8f52" }
    : { d0: "#030603", d1: "#060d05", d2: "#0a1508", d3: "#0e1d0c", d4: "#122210" };

  type C = [number, number, number, keyof typeof c, number];
  const left: C[] = [
    [  0, 270, 200, "d0", 0.70],
    [110,  80, 180, "d1", 0.65],
    [255,  45, 155, "d1", 0.60],
    [-55, 115, 120, "d0", 0.65],
    [ 60, 110, 130, "d2", 0.58],
    [205,  20, 120, "d2", 0.55],
    [330,  85, 100, "d3", 0.55],
    [100,  40,  88, "d3", 0.50],
    [235,  65,  80, "d4", 0.48],
    [145,   5,  70, "d3", 0.45],
    [310, 130,  62, "d4", 0.42],
    [ 32,  20,  60, "d4", 0.45],
    [375,  45,  50, "d4", 0.35],
    [168,  98,  55, "d4", 0.30],
  ];

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
      {/* Sky gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: light
            ? "linear-gradient(to bottom, #a8d8ea 0%, #c4e8f4 20%, #d8f0f8 45%, #e8f7fb 70%, #f3fbfd 100%)"
            : "linear-gradient(to bottom, #020408 0%, #060d18 22%, #091220 50%, #0c1726 75%, #101c2e 100%)",
        }}
      />

      {/* Tree canopy circles */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {left.map(([cx, cy, r, col, op], i) => (
          <circle key={`l${i}`} cx={cx} cy={cy} r={r} fill={c[col]} opacity={op} />
        ))}
        {left.map(([cx, cy, r, col, op], i) => (
          <circle key={`r${i}`} cx={1440 - cx} cy={cy} r={r} fill={c[col]} opacity={op} />
        ))}
      </svg>

      {/* Legibility overlay — ensures text contrast over sky */}
      <div
        className="absolute inset-0"
        style={{
          background: light
            ? "rgba(235, 248, 252, 0.55)"
            : "rgba(8, 13, 22, 0.60)",
        }}
      />
    </div>
  );
}
