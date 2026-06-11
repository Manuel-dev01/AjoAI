// The "Circle & Baton" mark — 8 members, the agent at centre, the clay baton passing round.
// Circles are inlined (not <use>/<symbol>) so the .member/.agent/.active fill CSS — including
// per-context overrides (hero, celebrate, etc.) — applies cleanly. Colours come from CSS.

const MEMBERS: [number, number][] = [
  [50, 16], [74.04, 25.96], [84, 50], [74.04, 74.04],
  [50, 84], [25.96, 74.04], [16, 50], [25.96, 25.96],
];

export function RingMark({
  variant = "full",
  size,
  className = "",
}: {
  variant?: "full" | "static";
  size?: number;
  className?: string;
}) {
  const px = size ? { width: size, height: size } : undefined;
  return (
    <svg viewBox="0 0 100 100" style={px} className={className} aria-hidden="true">
      {variant === "static" ? (
        <>
          <circle className="active" cx={50} cy={16} r={7.5} />
          {MEMBERS.slice(1).map(([cx, cy], i) => (
            <circle key={i} className="member" cx={cx} cy={cy} r={5} />
          ))}
          <circle className="agent" cx={50} cy={50} r={8.5} />
        </>
      ) : (
        <>
          {MEMBERS.map(([cx, cy], i) => (
            <circle key={i} className="member" cx={cx} cy={cy} r={5} />
          ))}
          <g className="spin">
            <circle className="active" cx={50} cy={16} r={8} />
          </g>
          <circle className="agent" cx={50} cy={50} r={9} />
        </>
      )}
    </svg>
  );
}
