// Extracted game logic for the fighting game
// This keeps App.jsx cleaner and easier to manage

export const WORLD_W = 900;
export const WORLD_H = 500;
export const GROUND = 380;
export const RECURSION_GROUND = 460;
export const GRAVITY = 1.2;
export const JUMP_DISTANCE = 120;

export const DARK_VARIANT = { red: "#b91c1c", blue: "#1d4ed8", green: "#15803d", black: "#4b5563" };

export const toRGBA = (hex, a) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export const getColorData = (color, variant = "normal") => {
  const base = (() => {
    switch (color) {
      case "red":
        return { hex: "#ef4444", name: "Red", type: "fire" };
      case "blue":
        return { hex: "#3b82f6", name: "Blue", type: "ice" };
      case "green":
        return { hex: "#22c55e", name: "Green", type: "poison" };
      case "black":
        return { hex: "#1f2937", name: "Black", type: "void" };
      default:
        return { hex: "#ef4444", name: "Red", type: "fire" };
    }
  })();
  const hex = variant === "dark" ? DARK_VARIANT[color] || base.hex : base.hex;
  return { ...base, hex, light: toRGBA(hex, 0.4) };
};

export const difficultySettings = {
  easy: { reactionTime: 45, accuracy: 0.50, specialUse: 0.25, aggression: 0.45, jumpFreq: 0.02, retreatThreshold: 0 },
  medium: { reactionTime: 22, accuracy: 0.72, specialUse: 0.60, aggression: 0.75, jumpFreq: 0.06, retreatThreshold: 30 },
  hard: { reactionTime: 8, accuracy: 0.92, specialUse: 0.90, aggression: 0.95, jumpFreq: 0.12, retreatThreshold: 50 },
};

export const makeFighter = (opts) => {
  const { id, team, isHuman, bindsRef, data, x, y, facing, dummy, label } = opts;
  return {
    id,
    team,
    label,
    isHuman,
    bindsRef,
    dummy: !!dummy,
    alive: true,
    x,
    y,
    width: 40,
    height: 60,
    vx: 0,
    vy: 0,
    health: 100,
    color: data.hex,
    lightColor: data.light,
    name: data.name,
    type: data.type,
    speed: 5,
    jumpPower: facing === 1 ? -22 : -20,
    grounded: true,
    facing,
    attacking: false,
    attackTimer: 0,
    attackType: "",
    attackHeight: "",
    blocking: false,
    ducking: false,
    frozen: false,
    frozenTimer: 0,
    jumpDisabled: false,
    jumpDisabledTimer: 0,
    blockDisabled: false,
    blockDisabledTimer: 0,
    specialDisabled: false,
    specialDisabledTimer: 0,
    poisoned: false,
    poisonTicksLeft: 0,
    poisonTickTimer: 0,
    healing: false,
    healTickTimer: 0,
    canProjectile: true,
    canSpecial2: true,
    dashTimer: 0,
    dashHasHit: false,
    charging: false,
    chargeFrames: 0,
    punchCooldown: 0,
    kickCooldown: 0,
    upperCooldown: 0,
    sweepCooldown: 0,
    hitstun: false,
    hitstunTimer: 0,
    hitbox: { x: 0, y: 0, width: 0, height: 0 },
    hurtbox: { x: 0, y: 0, width: 40, height: 60 },
    aiTimer: 0,
    aiAction: "idle",
    aiActionTimer: 0,
  };
};

export const calculateEloChange = (p1Rounds, p2Rounds) => {
  if (p1Rounds === 2 && p2Rounds === 0) return 20;
  if (p1Rounds === 2 && p2Rounds === 1) return 10;
  if (p1Rounds === 1 && p2Rounds === 2) return -10;
  if (p1Rounds === 0 && p2Rounds === 2) return -20;
  return 0;
};
