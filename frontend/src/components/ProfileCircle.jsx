// frontend/src/components/ProfileCircle.jsx
// Clickable profile circle. Shows profile photo if set, otherwise a
// weight-plate SVG with the user's initials. Clicking opens the profile menu.

export default function ProfileCircle({ user, onClick, size = 40 }) {
  const initials = getInitials(user);

  if (user?.profile_picture) {
    return (
      <button
        className="profile-circle-btn"
        onClick={onClick}
        aria-label="Open profile menu"
        style={{ width: size, height: size }}
      >
        <img
          src={user.profile_picture}
          alt="Profile"
          className="profile-circle-photo"
          style={{ width: size, height: size }}
        />
      </button>
    );
  }

  return (
    <button
      className="profile-circle-btn"
      onClick={onClick}
      aria-label="Open profile menu"
      style={{ width: size, height: size }}
    >
      <PlateSVG initials={initials} size={size} />
    </button>
  );
}

// Derives up to 2 initials from display_name, falling back to username.
function getInitials(user) {
  if (!user) return '?';
  // Explicit initials field takes priority (set in User Preferences)
  if (user.initials) return user.initials.toUpperCase().slice(0, 3);
  // Fall back to first+last initial from display_name
  const name = user.display_name || '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  // Last resort: first two chars of username
  return (user.username || '?').slice(0, 2).toUpperCase();
}

// Weight plate SVG. Outer ring with "RipFit" arcing along the top,
// inner hub with user initials, bolt holes around the ring for realism.
function PlateSVG({ initials, size }) {
  const cx = 50;
  const cy = 50;
  const outerR = 46;   // outer plate edge
  const ringR  = 38;   // inner edge of the ring face
  const hubR   = 24;   // centre hub where initials sit
  const boltR  = 31;   // radius bolts sit at
  const boltCount = 5;

  // Arc path for "RipFit" text along the top of the ring.
  // textPathRadius sits mid-ring between ringR and outerR.
  const textPathRadius = 42;
  const arcId = 'ripfit-arc';

  // Generate bolt hole positions evenly spaced (start from top)
  const bolts = Array.from({ length: boltCount }, (_, i) => {
    const angle = (i * 2 * Math.PI) / boltCount - Math.PI / 2;
    return {
      x: cx + boltR * Math.cos(angle),
      y: cy + boltR * Math.sin(angle),
    };
  });

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className="profile-plate-svg"
    >
      <defs>
        {/* Arc path for the "RipFit" label — upper semicircle */}
        <path
          id={arcId}
          d={describeArc(cx, cy, textPathRadius, -155, -25)}
        />
      </defs>

      {/* Outer plate edge */}
      <circle cx={cx} cy={cy} r={outerR} className="plate-outer" />

      {/* Ring face */}
      <circle cx={cx} cy={cy} r={ringR} className="plate-ring-face" />

      {/* Bolt holes */}
      {bolts.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={2.2} className="plate-bolt" />
      ))}

      {/* Centre hub */}
      <circle cx={cx} cy={cy} r={hubR} className="plate-hub" />

      {/* RipFit label arcing along the top */}
      <text className="plate-brand-text">
        <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
          RipFit
        </textPath>
      </text>

      {/* User initials centred in hub */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        className="plate-initials-text"
      >
        {initials}
      </text>
    </svg>
  );
}

// Converts polar coordinates to an SVG arc path string.
// Angles in degrees, 0 = right, increasing clockwise.
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end   = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}
