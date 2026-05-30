import background1Url from "./assets/Background1.png";
import background2Url from "./assets/Background2.png";
import React, { useEffect, useMemo, useRef, useState } from "react";

function FighterGame() {
  const [tailwindLoaded, setTailwindLoaded] = useState(false);

  const [mode, setMode] = useState("home");

  const [menuStep, setMenuStep] = useState("idle");

  const [p1Color, setP1Color] = useState(null);
  const [p2Color, setP2Color] = useState(null);
  const [opp1Color, setOpp1Color] = useState(null);
  const [opp2Color, setOpp2Color] = useState(null);
  const [difficulty, setDifficulty] = useState(null);
  const [stage, setStage] = useState(null);

  const [ladderIndex, setLadderIndex] = useState(0);
  const [ladderLoss, setLadderLoss] = useState(false);
  const [ladderWin, setLadderWin] = useState(false);
  const [ladderOppOrder, setLadderOppOrder] = useState([]);

  const canvasRef = useRef(null);

  const [isFullscreen, setIsFullscreen] = useState(false);

const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  } catch (err) {
    console.error("Fullscreen failed:", err);
  }
};

  const loopRef = useRef(null);
  const runningRef = useRef(false);
  const runTokenRef = useRef(0);

  const keysPressed = useRef({});
  const projectiles = useRef([]);
  const pausedRef = useRef(false);

  const practiceRefreshRef = useRef(null);

  const timeoutsRef = useRef([]);
  const setManagedTimeout = (fn, ms) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  };
  const clearAllTimeouts = () => {
    for (const id of timeoutsRef.current) window.clearTimeout(id);
    timeoutsRef.current = [];
  };

  const viewportRef = useRef({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => (viewportRef.current = { w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [gameOver, setGameOver] = useState(false);
  const [roundWinnerText, setRoundWinnerText] = useState(null);
  const [matchWinnerText, setMatchWinnerText] = useState(null);

  const [team1Rounds, setTeam1Rounds] = useState(0);
  const [team2Rounds, setTeam2Rounds] = useState(0);

  const ROUND_TIME_SECONDS = 120;
  const [roundTime, setRoundTime] = useState(null);

  const [roundPhase, setRoundPhase] = useState("countdown");
  const [countdownValue, setCountdownValue] = useState(3);
  const roundPhaseRef = useRef("countdown");
  const countdownRef = useRef(3);
  const roundMsRemainingRef = useRef(null);
  const lastShownSecondRef = useRef(null);

  const DEFAULT_P1 = {
    moveLeft: "a",
    moveRight: "d",
    jump: "w",
    duck: "s",
    block: "p",
    punch: "i",
    kick: "o",
    special1: "k",
    special2: "l",
  };
  const DEFAULT_P2 = {
    moveLeft: "",
    moveRight: "",
    jump: "",
    duck: "",
    block: "",
    punch: "",
    kick: "",
    special1: "",
    special2: "",
  };

  const loadBinds = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        moveLeft: (parsed.moveLeft ?? fallback.moveLeft ?? "").toLowerCase(),
        moveRight: (parsed.moveRight ?? fallback.moveRight ?? "").toLowerCase(),
        jump: (parsed.jump ?? fallback.jump ?? "").toLowerCase(),
        duck: (parsed.duck ?? fallback.duck ?? "").toLowerCase(),
        block: (parsed.block ?? fallback.block ?? "").toLowerCase(),
        punch: (parsed.punch ?? fallback.punch ?? "").toLowerCase(),
        kick: (parsed.kick ?? fallback.kick ?? "").toLowerCase(),
        special1: (parsed.special1 ?? fallback.special1 ?? "").toLowerCase(),
        special2: (parsed.special2 ?? fallback.special2 ?? "").toLowerCase(),
      };
    } catch {
      return fallback;
    }
  };

  const [p1Binds, setP1Binds] = useState(() => loadBinds("rgb_fighters_keybinds_p1_v3", DEFAULT_P1));
  const [p2Binds, setP2Binds] = useState(() => loadBinds("rgb_fighters_keybinds_p2_v3", DEFAULT_P2));
  const p1BindsRef = useRef(p1Binds);
  const p2BindsRef = useRef(p2Binds);

  useEffect(() => {
    p1BindsRef.current = p1Binds;
    try {
      localStorage.setItem("rgb_fighters_keybinds_p1_v3", JSON.stringify(p1Binds));
    } catch {}
  }, [p1Binds]);

  useEffect(() => {
  const onFullscreenChange = () => {
    setIsFullscreen(!!document.fullscreenElement);
    viewportRef.current = {
      w: window.innerWidth,
      h: window.innerHeight,
    };
  };

  document.addEventListener("fullscreenchange", onFullscreenChange);

  return () => {
    document.removeEventListener("fullscreenchange", onFullscreenChange);
  };
}, []);

  useEffect(() => {
    p2BindsRef.current = p2Binds;
    try {
      localStorage.setItem("rgb_fighters_keybinds_p2_v3", JSON.stringify(p2Binds));
    } catch {}
  }, [p2Binds]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listeningFor, setListeningFor] = useState(null);

  useEffect(() => {
    pausedRef.current = settingsOpen;
  }, [settingsOpen]);

  const prettyKey = (k) => {
    if (!k) return "";
    const key = String(k);
    if (key === " ") return "Space";
    if (key === "escape") return "Esc";
    if (key.startsWith("arrow")) {
      return key.replace("arrow", "Arrow ").replace("up", "Up").replace("down", "Down").replace("left", "Left").replace("right", "Right");
    }
    return key.length === 1 ? key.toUpperCase() : key;
  };

  const applyNewBinding = (player, action, key) => {
    const k = (key || "").toLowerCase();
    if (!k) return;
    const blocked = ["meta", "shift", "control", "alt", "capslock", "tab", "dead"];
    if (blocked.includes(k)) return;

    const setter = player === "p1" ? setP1Binds : setP2Binds;
    setter((prev) => {
      const next = { ...prev };
      for (const a of Object.keys(next)) {
        if (a !== action && next[a] === k) next[a] = "";
      }
      next[action] = k;
      return next;
    });
  };

  useEffect(() => {
    if (!settingsOpen || !listeningFor) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const k = (e.key || "").toLowerCase();
      if (k === "escape") {
        setListeningFor(null);
        return;
      }
      applyNewBinding(listeningFor.player, listeningFor.action, k);
      setListeningFor(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [settingsOpen, listeningFor]);

  useEffect(() => {
    if (!document.getElementById("tailwind-script")) {
      const s = document.createElement("script");
      s.id = "tailwind-script";
      s.src = "https://cdn.tailwindcss.com";
      s.onload = () => setManagedTimeout(() => setTailwindLoaded(true), 100);
      document.head.appendChild(s);
    } else {
      setTailwindLoaded(true);
    }
  }, []);

  useEffect(() => {
    document.body.style.background = "#F9E4BC";
    document.documentElement.style.minHeight = "100%";
    return () => {
      document.body.style.background = "";
      document.documentElement.style.minHeight = "";
    };
  }, []);

  const primeNewRound = () => {
    roundMsRemainingRef.current = null;
    lastShownSecondRef.current = null;
    setRoundTime(null);

    setRoundPhase("countdown");
    setCountdownValue(3);
    roundPhaseRef.current = "countdown";
    countdownRef.current = 3;
  };

  useEffect(() => {
    roundPhaseRef.current = roundPhase;
  }, [roundPhase]);
  useEffect(() => {
    countdownRef.current = countdownValue === "GO" ? 0 : countdownValue;
  }, [countdownValue]);

  const randPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randStage = () => randPick(["default", "recursion"]);
  const randColor = () => randPick(["red", "blue", "green", "black"]);
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const gameConfig = useMemo(() => {
    const base = {
      mode,
      humans: [],
      ai: [],
      practiceDummy: false,
      ladder: false,
    };

    if (mode === "practice") {
      return {
        ...base,
        practiceDummy: true,
        humans: [{ slot: "p1", team: 1, color: p1Color }],
        ai: [{ slot: "dummy", team: 2, color: opp1Color || randColor(), dummy: true }],
        difficulty: "easy",
        stage: stage || "default",
      };
    }

    if (mode === "single") {
      return {
        ...base,
        humans: [{ slot: "p1", team: 1, color: p1Color }],
        ai: [{ slot: "ai1", team: 2, color: opp1Color, dummy: false }],
        difficulty: difficulty || "easy",
        stage: stage || "default",
      };
    }

    if (mode === "offline") {
      return {
        ...base,
        humans: [
          { slot: "p1", team: 1, color: p1Color },
          { slot: "p2", team: 2, color: p2Color },
        ],
        ai: [],
        difficulty: null,
        stage: stage || "default",
      };
    }

    if (mode === "coop") {
      return {
        ...base,
        humans: [
          { slot: "p1", team: 1, color: p1Color },
          { slot: "p2", team: 1, color: p2Color },
        ],
        ai: [
          { slot: "ai1", team: 2, color: opp1Color, dummy: false },
          { slot: "ai2", team: 2, color: opp2Color, dummy: false },
        ],
        difficulty: difficulty || "easy",
        stage: stage || "default",
      };
    }

    if (mode === "ladder") {
      const idx = ladderIndex;
      const isLast = idx === 3;

      const oppColor = isLast ? p1Color : ladderOppOrder[idx];
      const diffByStep = ["easy", "medium", "hard", "hard"][idx] || "medium";

      return {
        ...base,
        ladder: true,
        humans: [{ slot: "p1", team: 1, color: p1Color }],
        ai: [{ slot: "ai1", team: 2, color: oppColor, dummy: false }],
        difficulty: difficulty || diffByStep,
        stage: randStage(),
        ladderIndex: idx,
      };
    }

    return { ...base, humans: [], ai: [], difficulty: null, stage: "default" };
  }, [mode, p1Color, p2Color, opp1Color, opp2Color, difficulty, stage, ladderIndex, ladderOppOrder]);

  const resetAll = () => {
    setGameOver(false);
    setRoundWinnerText(null);
    setMatchWinnerText(null);
    setTeam1Rounds(0);
    setTeam2Rounds(0);

    keysPressed.current = {};
    projectiles.current = [];

    primeNewRound();
  };

  const goHome = () => {
    setSettingsOpen(false);
    setListeningFor(null);

    setMode("home");
    setMenuStep("idle");

    setP1Color(null);
    setP2Color(null);
    setOpp1Color(null);
    setOpp2Color(null);
    setDifficulty(null);
    setStage(null);

    setLadderIndex(0);
    setLadderLoss(false);
    setLadderWin(false);
    setLadderOppOrder([]);

    resetAll();
  };

  const startModeFlow = (m) => {
    setMode(m);
    setSettingsOpen(false);
    setListeningFor(null);

    setP1Color(null);
    setP2Color(null);
    setOpp1Color(null);
    setOpp2Color(null);
    setDifficulty(null);
    setStage(null);

    setLadderIndex(0);
    setLadderLoss(false);
    setLadderWin(false);
    setLadderOppOrder([]);

    resetAll();

    if (m === "online") {
      setMenuStep("comingsoon");
      return;
    }

    if (m === "single") setMenuStep("p1");
    else if (m === "practice") setMenuStep("p1");
    else if (m === "offline") setMenuStep("p1");
    else if (m === "coop") setMenuStep("p1");
    else if (m === "ladder") setMenuStep("p1");
    else setMenuStep("idle");
  };

  const proceedAfterP1 = () => {
    if (mode === "single") setMenuStep("opp1");
    else if (mode === "practice") setMenuStep("opp1");
    else if (mode === "offline") setMenuStep("p2");
    else if (mode === "coop") setMenuStep("p2");
    else if (mode === "ladder") setMenuStep("difficulty");
  };

  const proceedAfterOpp1 = () => {
    if (mode === "single") setMenuStep("difficulty");
    else if (mode === "practice") setMenuStep("stage");
    else if (mode === "coop") setMenuStep("opp2");
  };

  const proceedAfterOpp2 = () => {
    if (mode === "coop") setMenuStep("difficulty");
  };

  const proceedAfterP2 = () => {
    if (mode === "offline") setMenuStep("stage");
    else if (mode === "coop") setMenuStep("opp1");
  };

  const proceedAfterDifficulty = () => {
    if (mode === "ladder") {
      setStage("random");
      setMenuStep("playing");
      resetAll();
    } else {
      setMenuStep("stage");
    }
  };

  const proceedAfterStage = () => {
    setMenuStep("playing");
    resetAll();
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!tailwindLoaded) return;
    if (menuStep !== "playing") return;

    if (!gameConfig?.humans?.length) return;
    if (gameConfig.humans.some((h) => !h.color)) return;
    if (gameConfig.ai?.some((a) => !a.color)) return;

    if (runningRef.current) return;
    runningRef.current = true;
    const myToken = ++runTokenRef.current;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const background1 = new Image();
    background1.src = background1Url;

    const background2 = new Image();
    background2.src = background2Url;

    const WORLD_W = 900;
    const WORLD_H = 500;

    const GROUND = 380;
    const RECURSION_GROUND = 460;
    const GRAVITY = 1.2;
    const JUMP_DISTANCE = 120;

    const DARK_VARIANT = { red: "#b91c1c", blue: "#1d4ed8", green: "#15803d", black: "#4b5563" };

    const toRGBA = (hex, a) => {
      const h = hex.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    };

    const getColorData = (color, variant = "normal") => {
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
      return { ...base, hex, light: toRGBA(hex, 0.75) };
    };

    const difficultySettings = {
      easy: { reactionTime: 36, accuracy: 0.62, specialUse: 0.75, aggression: 0.65 },
      medium: { reactionTime: 18, accuracy: 0.78, specialUse: 0.88, aggression: 0.8 },
      hard: { reactionTime: 10, accuracy: 0.9, specialUse: 0.95, aggression: 0.92 },
    };
    const aiSettings = difficultySettings[gameConfig.difficulty || "easy"];

    const selectedStage = gameConfig.stage || "default";
    const groundLevel = selectedStage === "default" ? GROUND : RECURSION_GROUND;

    const platforms =
      selectedStage === "default"
        ? [
            { x: 0, y: GROUND, width: WORLD_W, height: 20 },
            { x: 250, y: 280, width: 150, height: 20 },
            { x: 500, y: 280, width: 150, height: 20 },
          ]
        : [
            { x: 0, y: RECURSION_GROUND, width: WORLD_W, height: 20 },
            { x: 225, y: RECURSION_GROUND - JUMP_DISTANCE, width: 450, height: 20 },
            { x: 337.5, y: RECURSION_GROUND - JUMP_DISTANCE * 2, width: 225, height: 20 },
            { x: 393.75, y: RECURSION_GROUND - JUMP_DISTANCE * 3, width: 112.5, height: 20 },
          ];

    const makeFighter = (opts) => {
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
        jumpPower: -22,
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
        hitFlashTimer: 0,
        hitFlashColor: "rgba(255,255,255,0.9)",
        hitbox: { x: 0, y: 0, width: 0, height: 0 },
        hurtbox: { x: 0, y: 0, width: 40, height: 60 },
        aiTimer: 0,
        aiAction: "idle",
        aiActionTimer: 0,
      };
    };

    const fighters = [];

    const mirrorVariant = (color, otherColor) => (color === otherColor ? "dark" : "normal");
    const is2v2 = gameConfig.humans.length + (gameConfig.ai?.length || 0) === 4;

    const spawn = () => {
      if (!is2v2) {
        const h = gameConfig.humans[0];
        const o = (gameConfig.ai?.[0] || gameConfig.humans[1]) ?? null;

        const p1Data = getColorData(h.color, "normal");
        const p2Data = getColorData(o.color, mirrorVariant(o.color, h.color));

        fighters.push(
          makeFighter({
            id: h.slot,
            team: 1,
            isHuman: true,
            bindsRef: p1BindsRef,
            data: p1Data,
            x: 150,
            y: groundLevel - 60,
            facing: 1,
            dummy: false,
            label: "P1",
          })
        );

        if (o) {
          const isHuman2 = !!(gameConfig.humans[1] && gameConfig.humans[1].slot === "p2" && gameConfig.humans[1].team === 2);
          fighters.push(
            makeFighter({
              id: o.slot,
              team: 2,
              isHuman: isHuman2,
              bindsRef: isHuman2 ? p2BindsRef : null,
              data: p2Data,
              x: 700,
              y: groundLevel - 60,
              facing: -1,
              dummy: !!o.dummy,
              label: isHuman2 ? "P2" : gameConfig.practiceDummy ? "Dummy" : "AI",
            })
          );
        }
        return;
      }

      const t1 = gameConfig.humans.filter((h) => h.team === 1);
      const t2ai = gameConfig.ai || [];
      const p1 = t1.find((x) => x.slot === "p1");
      const p2 = t1.find((x) => x.slot === "p2");

      const e1 = t2ai[0];
      const e2 = t2ai[1];

      const p1Data = getColorData(p1.color, "normal");
      const p2Data = getColorData(p2.color, mirrorVariant(p2.color, p1.color));
      const e1Data = getColorData(e1.color, mirrorVariant(e1.color, p1.color));
      const e2Data = getColorData(e2.color, mirrorVariant(e2.color, p2.color));

      fighters.push(makeFighter({ id: "p1", team: 1, isHuman: true, bindsRef: p1BindsRef, data: p1Data, x: 120, y: groundLevel - 60, facing: 1, label: "P1" }));
      fighters.push(makeFighter({ id: "p2", team: 1, isHuman: true, bindsRef: p2BindsRef, data: p2Data, x: 220, y: groundLevel - 60, facing: 1, label: "P2" }));

      fighters.push(makeFighter({ id: "ai1", team: 2, isHuman: false, bindsRef: null, data: e1Data, x: 650, y: groundLevel - 60, facing: -1, label: "E1" }));
      fighters.push(makeFighter({ id: "ai2", team: 2, isHuman: false, bindsRef: null, data: e2Data, x: 760, y: groundLevel - 60, facing: -1, label: "E2" }));
    };

    spawn();

    const resetPositions = () => {
      if (!is2v2) {
        const f1 = fighters.find((f) => f.team === 1);
        const f2 = fighters.find((f) => f.team === 2);
        if (f1) Object.assign(f1, { x: 150, y: groundLevel - 60, vx: 0, vy: 0, facing: 1 });
        if (f2) Object.assign(f2, { x: 700, y: groundLevel - 60, vx: 0, vy: 0, facing: -1 });
        projectiles.current = [];
        keysPressed.current = {};
        return;
      }

      const p1 = fighters.find((f) => f.id === "p1");
      const p2 = fighters.find((f) => f.id === "p2");
      const e1 = fighters.find((f) => f.id === "ai1");
      const e2 = fighters.find((f) => f.id === "ai2");

      if (p1) Object.assign(p1, { x: 120, y: groundLevel - 60, vx: 0, vy: 0, facing: 1 });
      if (p2) Object.assign(p2, { x: 220, y: groundLevel - 60, vx: 0, vy: 0, facing: 1 });
      if (e1) Object.assign(e1, { x: 650, y: groundLevel - 60, vx: 0, vy: 0, facing: -1 });
      if (e2) Object.assign(e2, { x: 760, y: groundLevel - 60, vx: 0, vy: 0, facing: -1 });

      projectiles.current = [];
      keysPressed.current = {};
    };

    const refreshPractice = () => {
      if (mode !== "practice") return;

      for (const p of fighters) {
        if (p.team === 2 && p.dummy) {
          p.alive = true;
          p.health = 100;

          p.frozen = false;
          p.frozenTimer = 0;

          p.poisoned = false;
          p.poisonTicksLeft = 0;
          p.poisonTickTimer = 0;

          p.hitstun = false;
          p.hitstunTimer = 0;

          p.attacking = false;
          p.attackTimer = 0;
          p.attackType = "";
          p.attackHeight = "";

          p.blocking = false;
          p.ducking = false;

          p.specialDisabled = false;
          p.specialDisabledTimer = 0;

          p.blockDisabled = false;
          p.blockDisabledTimer = 0;

          p.jumpDisabled = false;
          p.jumpDisabledTimer = 0;

          p.healing = false;
          p.healTickTimer = 0;

          p.charging = false;
          p.chargeFrames = 0;

          p.canProjectile = true;
          p.canSpecial2 = true;

          p.vx = 0;
          p.vy = 0;
        }
      }

      resetPositions();
    };

    practiceRefreshRef.current = refreshPractice;

    const handleKeyDown = (e) => (keysPressed.current[(e.key || "").toLowerCase()] = true);
    const handleKeyUp = (e) => (keysPressed.current[(e.key || "").toLowerCase()] = false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const breakFreezeIfNeeded = (def) => {
      if (def.frozen) {
        def.frozen = false;
        def.frozenTimer = 0;
      }
    };

    const updateHitboxes = (p) => {
      const drawHeight = p.ducking ? p.height * 0.6 : p.height;
      const drawY = p.ducking ? p.y + p.height * 0.4 : p.y;

      p.hurtbox = { x: p.x, y: drawY, width: p.width, height: drawHeight };

      if (p.attacking) {
        let hitboxWidth = 0;
        let hitboxHeight = drawHeight;
        let hitboxY = drawY;

        switch (p.attackType) {
          case "punch":
            hitboxWidth = 50;
            break;
          case "kick":
            hitboxWidth = 80;
            break;
          case "uppercut":
            hitboxWidth = 55;
            hitboxHeight = drawHeight * 0.5;
            break;
          case "sweep":
            hitboxWidth = 85;
            hitboxHeight = drawHeight * 0.4;
            hitboxY = drawY + drawHeight * 0.6;
            break;
          case "dash":
            hitboxWidth = 100;
            break;
          default:
            hitboxWidth = 0;
        }

        const hitboxX = p.facing > 0 ? p.x + p.width : p.x - hitboxWidth;
        p.hitbox = { x: hitboxX, y: hitboxY, width: hitboxWidth, height: hitboxHeight };
      } else {
        p.hitbox = { x: 0, y: 0, width: 0, height: 0 };
      }
    };

    const rectOverlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

    const checkHitboxCollision = (attacker, defender) => {
      if (!attacker.attacking) return false;
      if (!defender.alive) return false;
      if (attacker.attackHeight === "high" && defender.ducking) return false;
      return rectOverlap(attacker.hitbox, defender.hurtbox);
    };

    const checkPlatformCollision = (p) => {
      if (p.vy < 0) return;
      for (const plat of platforms) {
        if (p.x + p.width > plat.x && p.x < plat.x + plat.width && p.y + p.height >= plat.y && p.y + p.height <= plat.y + 20) {
          p.y = plat.y - p.height;
          p.vy = 0;
          p.grounded = true;
          return;
        }
      }
    };

    const canBlockAttack = (attacker, defender, attackType, attackHeightOverride = null) => {
      if (!defender.blocking || defender.blockDisabled) return false;
      if (attackType === "dash") return false;
      if (attackType === "poisonorb") return false;

      const h = attackHeightOverride ?? attacker.attackHeight;

      if (h === "low") return defender.ducking;
      if (h === "overhead") return !defender.ducking;
      if (h === "mid") return true;
      if (h === "high") return !defender.ducking;
      return false;
    };

    const applyDamage = (attacker, defender, attackType, extra = {}) => {
      if (!defender.alive) return 0;
      if (attackType === "iceball" && defender.frozen) return 0;

      breakFreezeIfNeeded(defender);

      let damage = 0;
      let knockback = 0;
      let launchUp = false;
      let hitstunFrames = 12;

      let freezeFrames = 0;
      let disableBlock = false;
      let disableSpecial = false;
      let applyPoisonTicks = 0;
      let applyJumpDisable = 0;

      switch (attackType) {
        case "punch":
          damage = 3;
          knockback = 6;
          hitstunFrames = 10;
          break;
        case "kick":
          damage = 5;
          knockback = 14;
          hitstunFrames = 14;
          break;
        case "uppercut":
          damage = 10;
          knockback = 8;
          launchUp = true;
          hitstunFrames = 18;
          break;
        case "sweep":
          damage = 8;
          knockback = 8;
          hitstunFrames = 16;
          break;
        case "dash":
          damage = 4;
          knockback = 12;
          launchUp = true;
          hitstunFrames = 16;
          break;
        case "fireball":
          damage = 5;
          knockback = 15;
          hitstunFrames = 12;
          break;
        case "iceball":
          damage = 2;
          knockback = 4;
          hitstunFrames = 10;
          freezeFrames = 180;
          break;
        case "sloworb":
          damage = 8;
          knockback = 5;
          hitstunFrames = 14;
          applyJumpDisable = 900;
          launchUp = true;
          break;
        case "poisonorb":
          damage = 3;
          knockback = 3;
          applyPoisonTicks = 12;
          break;
        case "blackball":
          damage = 3;
          knockback = 3;
          launchUp = true;
          disableBlock = true;
          disableSpecial = true;
          break;
        case "chargeball":
          damage = extra.damage ?? 1;
          knockback = Math.min(24, 6 + Math.floor(damage / 2));
          hitstunFrames = Math.min(30, 10 + damage);
          break;
        default:
          break;
      }

      if (defender.healing) {
        defender.healing = false;
        hitstunFrames += 30;
      }

      const blocked = canBlockAttack(attacker, defender, attackType, extra.attackHeight ?? null);

      if (blocked) {
        damage = Math.floor(damage * 0.25);
        knockback = Math.floor(knockback * 0.3);
        hitstunFrames = 0;
        freezeFrames = 0;
        disableBlock = false;
        disableSpecial = false;
        applyPoisonTicks = 0;
        applyJumpDisable = 0;
      }

      if (!blocked) {
        if (freezeFrames > 0) {
          defender.frozen = true;
          defender.frozenTimer = freezeFrames;
        }
        if (disableBlock) {
          defender.blockDisabled = true;
          defender.blockDisabledTimer = 420;
        }
        if (disableSpecial) {
          defender.specialDisabled = true;
          defender.specialDisabledTimer = 420;
        }
        if (applyPoisonTicks > 0) {
          defender.poisoned = true;
          defender.poisonTicksLeft = applyPoisonTicks;
          defender.poisonTickTimer = 60;
        }
        if (applyJumpDisable > 0) {
          defender.jumpDisabled = true;
          defender.jumpDisabledTimer = applyJumpDisable;
        }
        if (hitstunFrames > 0 && attackType !== "poisonorb") {
          defender.hitstun = true;
          defender.hitstunTimer = hitstunFrames;
          defender.attacking = false;
          defender.attackTimer = 0;
          defender.attackType = "";
          defender.attackHeight = "";
        }
      }

      defender.health -= damage;
      if (!blocked && damage > 0) {
        defender.hitFlashTimer = 14;
      defender.hitFlashColor = attacker.lightColor || attacker.color || "rgba(255,255,255,0.9)";
      }

      const dir = extra.knockbackDir ?? attacker.facing ?? 1;
      defender.vx = dir * knockback;

      if (launchUp && !blocked) {
        defender.vy = -25;
        defender.grounded = false;
      }

      return damage;
    };

    const getNearestEnemy = (ai) => {
      const enemies = fighters.filter((f) => f.alive && f.team !== ai.team);
      if (!enemies.length) return null;
      let best = enemies[0];
      let bestD = Math.abs(best.x - ai.x);
      for (const e of enemies) {
        const d = Math.abs(e.x - ai.x);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      return best;
    };

    const updateAI = (ai) => {
      if (pausedRef.current) return;
      if (roundPhaseRef.current !== "fight") {
        ai.vx = 0;
        ai.blocking = false;
        ai.ducking = false;
        return;
      }
      if (!ai.alive) return;
      if (ai.dummy) {
        ai.vx *= 0.92;
        ai.blocking = false;
        ai.ducking = false;
        ai.attacking = false;
        return;
      }
      if (ai.frozen || ai.healing || ai.hitstun) return;

      const opp = getNearestEnemy(ai);
      if (!opp) return;

      if (ai.charging && ai.type === "void") {
        const distance = opp.x - ai.x;
        ai.facing = distance > 0 ? 1 : -1;
        ai.vx = distance > 0 ? ai.speed * 0.8 : -ai.speed * 0.8;
        ai.blocking = false;
        ai.ducking = false;
        return;
      }

      ai.aiTimer++;
      if (ai.aiTimer > aiSettings.reactionTime) {
        ai.aiTimer = 0;

        const distance = opp.x - ai.x;
        const abs = Math.abs(distance);
        ai.facing = distance > 0 ? 1 : -1;

        const wantsSpecial = Math.random() < aiSettings.specialUse;

        if (abs > 140 && Math.random() < aiSettings.aggression) {
          if (abs > 220 && ai.canProjectile && !ai.specialDisabled && wantsSpecial) {
            ai.aiAction = "projectile";
            ai.aiActionTimer = 1;
          } else if (abs > 160 && ai.canSpecial2 && !ai.specialDisabled && wantsSpecial) {
            ai.aiAction = "special2";
            ai.aiActionTimer = 1;
          } else {
            ai.aiAction = "chase";
            ai.aiActionTimer = 28;
          }
        } else if (abs < 80) {
          const r = Math.random();
          if (opp.attacking && r > 1 - aiSettings.accuracy * 0.75 && !ai.blockDisabled) {
            ai.aiAction = "smartblock";
            ai.aiActionTimer = 18;
          } else if (r > 0.72 && ai.sweepCooldown === 0) {
            ai.aiAction = "lowattack";
            ai.aiActionTimer = 18;
          } else if (r > 0.52 && ai.kickCooldown === 0) {
            ai.aiAction = "overhead";
            ai.aiActionTimer = 18;
          } else if (r > 0.32 && ai.punchCooldown === 0) {
            ai.aiAction = "midattack";
            ai.aiActionTimer = 18;
          } else if (wantsSpecial && ai.canSpecial2 && !ai.specialDisabled && r > 0.18) {
            ai.aiAction = "special2";
            ai.aiActionTimer = 1;
          } else {
            ai.aiAction = "back";
            ai.aiActionTimer = 10;
          }
        } else {
          const r = Math.random();
          if (ai.canSpecial2 && !ai.specialDisabled && wantsSpecial && r > 0.58) {
            ai.aiAction = "special2";
            ai.aiActionTimer = 1;
          } else if (ai.canProjectile && !ai.specialDisabled && wantsSpecial && r > 0.34) {
            ai.aiAction = "projectile";
            ai.aiActionTimer = 1;
          } else if (r > 0.45) {
            ai.aiAction = "chase";
            ai.aiActionTimer = 22;
          } else if (r > 0.25) {
            ai.aiAction = "jump";
            ai.aiActionTimer = 1;
          } else {
            ai.aiAction = "smartblock";
            ai.aiActionTimer = 14;
          }
        }
      }

      ai.aiActionTimer--;
      if (ai.aiActionTimer > 0) {
        const distance = opp.x - ai.x;

        switch (ai.aiAction) {
          case "chase":
            ai.vx = distance > 0 ? ai.speed * 1.2 : -ai.speed * 1.2;
            ai.blocking = false;
            ai.ducking = false;
            if ((Math.random() > 0.9 && ai.grounded && !ai.jumpDisabled) || (ai.grounded && Math.abs(distance) > 150 && Math.random() > 0.85 && !ai.jumpDisabled)) {
              ai.vy = ai.jumpPower;
              ai.grounded = false;
            }
            break;

          case "back":
            ai.vx = distance > 0 ? -ai.speed : ai.speed;
            ai.blocking = false;
            ai.ducking = false;
            break;

          case "lowattack":
            ai.vx = 0;
            if (!ai.attacking && ai.aiActionTimer > 8) {
              ai.attacking = true;
              ai.attackType = "sweep";
              ai.attackHeight = "low";
              ai.attackTimer = 15;
              ai.ducking = true;
              ai.sweepCooldown = 50;
            }
            break;

          case "overhead":
            ai.vx = 0;
            if (!ai.attacking && ai.aiActionTimer > 8) {
              ai.attacking = true;
              ai.attackType = "kick";
              ai.attackHeight = "overhead";
              ai.attackTimer = 15;
              ai.kickCooldown = 40;
            }
            break;

          case "midattack":
            ai.vx = 0;
            if (!ai.attacking && ai.aiActionTimer > 8) {
              ai.attacking = true;
              ai.attackType = "punch";
              ai.attackHeight = "mid";
              ai.attackTimer = 15;
              ai.punchCooldown = 20;
            }
            break;

          case "smartblock":
            ai.vx = 0;
            ai.ducking = opp.ducking ? false : Math.random() > 0.5;
            ai.blocking = !ai.blockDisabled;
            break;

          case "jump":
            if (ai.grounded && !ai.jumpDisabled) {
              ai.vy = ai.jumpPower;
              ai.grounded = false;
              ai.vx = distance > 0 ? ai.speed * 0.7 : -ai.speed * 0.7;
            }
            break;

          case "projectile":
            if (ai.canProjectile && !ai.specialDisabled) {
              let projectileCooldown = 2500;
              const projX = ai.x + (ai.facing > 0 ? ai.width : 0);
              const projY = ai.y + 25;

              if (ai.type === "fire") {
                projectiles.current.push({ x: projX, y: projY, vx: ai.facing * 8, owner: ai, team: ai.team, type: "fireball", attackHeight: "high", color: ai.color, radius: 8 });
                projectileCooldown = 900;
              } else if (ai.type === "ice") {
                projectiles.current.push({ x: projX, y: projY, vx: ai.facing * 7, owner: ai, team: ai.team, type: "iceball", attackHeight: "high", color: "#60a5fa", radius: 8 });
                projectileCooldown = 4200;
              } else if (ai.type === "poison") {
                projectiles.current.push({ x: projX, y: projY, vx: ai.facing * 4, owner: ai, team: ai.team, type: "poisonorb", attackHeight: "mid", color: "#4ade80", radius: 10 });
                projectileCooldown = 2200;
              } else {
                projectiles.current.push({ x: projX, y: projY, vx: ai.facing * 10, owner: ai, team: ai.team, type: "blackball", attackHeight: "mid", color: ai.color, radius: 8 });
                projectileCooldown = 2200;
              }

              ai.canProjectile = false;
              setManagedTimeout(() => (ai.canProjectile = true), projectileCooldown);
            }
            break;

          case "special2":
            if (ai.canSpecial2 && !ai.specialDisabled) {
              if (ai.type === "fire") {
                ai.attacking = true;
                ai.attackType = "dash";
                ai.attackHeight = "mid";
                ai.attackTimer = 25;
                ai.dashTimer = 25;
                ai.dashHasHit = false;
                ai.canSpecial2 = false;
                setManagedTimeout(() => (ai.canSpecial2 = true), 1800);
              } else if (ai.type === "ice") {
                projectiles.current.push({ x: ai.x + (ai.facing > 0 ? ai.width : 0), y: ai.y + 25, vx: ai.facing * 2.2, owner: ai, team: ai.team, type: "sloworb", attackHeight: "mid", color: "#93c5fd", radius: 12 });
                ai.canSpecial2 = false;
                setManagedTimeout(() => (ai.canSpecial2 = true), 9000);
              } else if (ai.type === "poison" && ai.health < 75) {
                ai.healing = true;
                ai.healTickTimer = 120;
              } else if (ai.type === "void") {
                const chargeTime = Math.floor(Math.random() * 100) + 70;
                ai.charging = true;
                ai.chargeFrames = 0;

                setManagedTimeout(() => {
                  if (ai.charging) {
                    const chargeDamage = 1 + Math.floor(ai.chargeFrames / 20);
                    projectiles.current.push({
                      x: ai.x + (ai.facing > 0 ? ai.width : 0),
                      y: ai.y + 25,
                      vx: ai.facing * 10,
                      owner: ai,
                      team: ai.team,
                      type: "chargeball",
                      attackHeight: "mid",
                      color: ai.color,
                      radius: 8 + Math.min(ai.chargeFrames / 30, 8),
                      damage: chargeDamage,
                    });
                    ai.charging = false;
                    ai.chargeFrames = 0;
                  }
                }, chargeTime * 16.67);

                ai.canSpecial2 = false;
                setManagedTimeout(() => (ai.canSpecial2 = true), 4500);
              }
            }
            break;

          default:
            ai.vx = 0;
            ai.blocking = false;
            ai.ducking = false;
        }
      } else {
        ai.aiAction = "idle";
        ai.vx = 0;
        ai.blocking = false;
        ai.ducking = false;
      }
    };

    const drawHealthBarSmall = (label, health, x, y, color, roundsWon, alignRight = false) => {
      const barW = 190;
      const barH = 16;
      const boxH = 60;

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(x, y, barW, boxH);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, barW, boxH);

      ctx.fillStyle = "#111827";
      ctx.font = "12px Arial";
      const hpText = `${label}  ${Math.max(0, Math.floor(health))} HP`;
      const tw = ctx.measureText(hpText).width;
      ctx.fillText(hpText, alignRight ? x + barW - 10 - tw : x + 10, y + 16);

      ctx.fillStyle = "#e5e7eb";
ctx.fillRect(x + 10, y + 24, barW - 20, barH);
ctx.strokeStyle = "#000000";
ctx.lineWidth = 2;
ctx.strokeRect(x + 10, y + 24, barW - 20, barH);

const hpW = ((Math.max(0, Math.min(100, health)) / 100) * (barW - 20)) | 0;
ctx.fillStyle = color;
ctx.fillRect(x + 10, y + 24, hpW, barH);

if (hpW > 0) {
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 10, y + 24, hpW, barH);
}

      if (roundsWon != null) {
        for (let i = 0; i < 2; i++) {
  const coinX = x + barW - 16 - i * 16;
  const coinY = y + 50;

  ctx.fillStyle = i < roundsWon ? "#fbbf24" : "#e5e7eb";
  ctx.beginPath();
  ctx.arc(coinX, coinY, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.stroke();
}
      }
    };

    const drawRoundTimer = (secondsLeft) => {
      const boxW = 120;
      const boxH = 44;
      const x = WORLD_W / 2 - boxW / 2;
      const y = 18;

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(x, y, boxW, boxH);

      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, boxW, boxH);

      ctx.fillStyle = "#111827";
      ctx.font = "bold 22px Arial";
      const t = String(secondsLeft).padStart(2, "0");
      const textW = ctx.measureText(t).width;
      ctx.fillText(t, x + boxW / 2 - textW / 2, y + 30);
    };

    const drawCountdown = (value) => {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(WORLD_W / 2 - 130, WORLD_H / 2 - 80, 260, 160);

      ctx.strokeStyle = "rgba(17,24,39,0.25)";
      ctx.lineWidth = 3;
      ctx.strokeRect(WORLD_W / 2 - 130, WORLD_H / 2 - 80, 260, 160);

      ctx.fillStyle = "#111827";
      ctx.font = "bold 64px Arial";
      const text = String(value);
      const w = ctx.measureText(text).width;
      ctx.fillText(text, WORLD_W / 2 - w / 2, WORLD_H / 2 + 22);
      ctx.restore();
    };

    const drawPaused = () => {
      ctx.save();
      ctx.fillStyle = "rgba(17,24,39,0.25)";
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(WORLD_W / 2 - 170, WORLD_H / 2 - 55, 340, 110);
      ctx.strokeStyle = "rgba(17,24,39,0.25)";
      ctx.lineWidth = 2;
      ctx.strokeRect(WORLD_W / 2 - 170, WORLD_H / 2 - 55, 340, 110);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 28px Arial";
      const t = "PAUSED";
      const w = ctx.measureText(t).width;
      ctx.fillText(t, WORLD_W / 2 - w / 2, WORLD_H / 2 + 10);
      ctx.restore();
    };

    const aliveOnTeam = (team) => fighters.filter((f) => f.alive && f.team === team);
    const teamTotalHP = (team) => aliveOnTeam(team).reduce((sum, f) => sum + Math.max(0, f.health), 0);

    const markKOIfNeeded = (p) => {
      if (!p.alive) return;
      if (p.health > 0) return;

      p.alive = false;
      p.vx = 0;
      p.vy = 0;
      p.attacking = false;
      p.attackTimer = 0;
      p.attackType = "";
      p.attackHeight = "";
      p.blocking = false;
      p.ducking = false;
    };

    const endRound = (winningTeam, reasonText) => {
      setRoundWinnerText(reasonText);

      if (winningTeam === 1) {
        const newR = team1Rounds + 1;
        setTeam1Rounds(newR);
        if (newR >= 2) {
          setMatchWinnerText("Team 1");
          setGameOver(true);
          return;
        }
      } else if (winningTeam === 2) {
        const newR = team2Rounds + 1;
        setTeam2Rounds(newR);
        if (newR >= 2) {
          setMatchWinnerText("Team 2");
          setGameOver(true);
          return;
        }
      }

      setGameOver(true);
    };

    const tieRedoRound = () => {
      for (const p of fighters) {
        p.alive = true;
        p.health = 100;

        p.frozen = false;
        p.frozenTimer = 0;

        p.poisoned = false;
        p.poisonTicksLeft = 0;
        p.poisonTickTimer = 0;

        p.hitstun = false;
        p.hitstunTimer = 0;

        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";

        p.blocking = false;
        p.ducking = false;

        p.specialDisabled = false;
        p.specialDisabledTimer = 0;

        p.blockDisabled = false;
        p.blockDisabledTimer = 0;

        p.jumpDisabled = false;
        p.jumpDisabledTimer = 0;

        p.canProjectile = true;
        p.canSpecial2 = true;

        p.healing = false;
        p.healTickTimer = 0;

        p.charging = false;
        p.chargeFrames = 0;
      }

      resetPositions();
      primeNewRound();
      setRoundWinnerText(null);
      setMatchWinnerText(null);
      setGameOver(false);
      projectiles.current = [];
      keysPressed.current = {};
    };

    const nextRoundReset = () => {
      for (const p of fighters) {
        p.alive = true;
        p.health = 100;

        p.frozen = false;
        p.frozenTimer = 0;

        p.poisoned = false;
        p.poisonTicksLeft = 0;
        p.poisonTickTimer = 0;

        p.hitstun = false;
        p.hitstunTimer = 0;

        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";

        p.blocking = false;
        p.ducking = false;

        p.specialDisabled = false;
        p.specialDisabledTimer = 0;

        p.blockDisabled = false;
        p.blockDisabledTimer = 0;

        p.jumpDisabled = false;
        p.jumpDisabledTimer = 0;

        p.canProjectile = true;
        p.canSpecial2 = true;

        p.healing = false;
        p.healTickTimer = 0;

        p.charging = false;
        p.chargeFrames = 0;
      }
      resetPositions();
      primeNewRound();
      setRoundWinnerText(null);
      setGameOver(false);
      projectiles.current = [];
      keysPressed.current = {};
    };

    const doHumanControls = (p) => {
      if (!p.alive) return;
      if (pausedRef.current) return;
      if (roundPhaseRef.current !== "fight") return;
      if (p.dummy) return;
      if (p.frozen || p.hitstun) return;

      const binds = p.bindsRef?.current;
      if (!binds) return;

      if (p.type === "poison" && binds.special2) {
        const wantsHeal = !!keysPressed.current[binds.special2] && !p.specialDisabled && !p.frozen && p.health < 100;
        p.healing = wantsHeal;
        if (p.healing && !p.healTickTimer) p.healTickTimer = 120;
      }

      if (p.healing) {
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        return;
      }

      if (p.type === "void" && p.charging) {
        p.vx = 0;
        p.ducking = false;

        if (binds.moveLeft && keysPressed.current[binds.moveLeft]) {
          p.vx = -p.speed;
          p.facing = -1;
        }
        if (binds.moveRight && keysPressed.current[binds.moveRight]) {
          p.vx = p.speed;
          p.facing = 1;
        }

        if (binds.jump && !p.jumpDisabled && keysPressed.current[binds.jump] && p.grounded) {
          p.vy = p.jumpPower;
          p.grounded = false;
        }

        if (binds.duck && keysPressed.current[binds.duck]) p.ducking = true;

        p.blocking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        p.dashTimer = 0;
      } else {
        p.blocking = !p.blockDisabled && !!(binds.block && keysPressed.current[binds.block]);

        if (p.blocking) {
          p.vx = 0;
          p.ducking = !!(binds.duck && keysPressed.current[binds.duck]);
          p.attacking = false;
          p.attackTimer = 0;
          p.attackType = "";
          p.attackHeight = "";
          return;
        }

        p.vx = 0;
        p.ducking = false;

        if (binds.moveLeft && keysPressed.current[binds.moveLeft]) {
          p.vx = -p.speed;
          p.facing = -1;
        }
        if (binds.moveRight && keysPressed.current[binds.moveRight]) {
          p.vx = p.speed;
          p.facing = 1;
        }

        if (binds.jump && !p.jumpDisabled && keysPressed.current[binds.jump] && p.grounded) {
          p.vy = p.jumpPower;
          p.grounded = false;
        }

        if (binds.duck && keysPressed.current[binds.duck]) p.ducking = true;

        if (binds.punch && keysPressed.current[binds.punch] && !p.attacking) {
          if (p.ducking && p.upperCooldown === 0) {
            p.attacking = true;
            p.attackType = "uppercut";
            p.attackHeight = "high";
            p.attackTimer = 15;
            p.upperCooldown = 60;
            keysPressed.current[binds.punch] = false;
          } else if (!p.ducking && p.punchCooldown === 0) {
            p.attacking = true;
            p.attackType = "punch";
            p.attackHeight = "mid";
            p.attackTimer = 15;
            p.punchCooldown = 20;
            keysPressed.current[binds.punch] = false;
          }
        }

        if (binds.kick && keysPressed.current[binds.kick] && !p.attacking) {
          if (p.ducking && p.sweepCooldown === 0) {
            p.attacking = true;
            p.attackType = "sweep";
            p.attackHeight = "low";
            p.attackTimer = 15;
            p.sweepCooldown = 50;
            keysPressed.current[binds.kick] = false;
          } else if (!p.ducking && p.kickCooldown === 0) {
            p.attacking = true;
            p.attackType = "kick";
            p.attackHeight = "overhead";
            p.attackTimer = 15;
            p.kickCooldown = 40;
            keysPressed.current[binds.kick] = false;
          }
        }

        if (p.dashTimer > 0) {
          p.vx = p.facing * 18;
          p.dashTimer--;
        }

        if (binds.special1 && keysPressed.current[binds.special1] && p.canProjectile && !p.specialDisabled) {
          const projX = p.x + (p.facing > 0 ? p.width : 0);
          const projY = p.y + 25;
          let cooldown = 2500;

          if (p.type === "fire") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 8, owner: p, team: p.team, type: "fireball", attackHeight: "high", color: p.color, radius: 8 });
            cooldown = 500;
          } else if (p.type === "ice") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 7, owner: p, team: p.team, type: "iceball", attackHeight: "high", color: "#60a5fa", radius: 8 });
            cooldown = 5000;
          } else if (p.type === "poison") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 4, owner: p, team: p.team, type: "poisonorb", attackHeight: "mid", color: "#4ade80", radius: 10 });
            cooldown = 2500;
          } else {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 10, owner: p, team: p.team, type: "blackball", attackHeight: "mid", color: p.color, radius: 8 });
            cooldown = 2500;
          }

          p.canProjectile = false;
          setManagedTimeout(() => (p.canProjectile = true), cooldown);
          keysPressed.current[binds.special1] = false;
        }

        if (binds.special2 && keysPressed.current[binds.special2] && !p.specialDisabled) {
          if (p.canSpecial2) {
            if (p.type === "fire") {
              p.attacking = true;
              p.attackType = "dash";
              p.attackHeight = "mid";
              p.attackTimer = 25;
              p.dashTimer = 25;
              p.dashHasHit = false;
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), 2000);
              keysPressed.current[binds.special2] = false;
            } else if (p.type === "ice") {
              projectiles.current.push({ x: p.x + (p.facing > 0 ? p.width : 0), y: p.y + 25, vx: p.facing * 2.2, owner: p, team: p.team, type: "sloworb", attackHeight: "mid", color: "#93c5fd", radius: 12 });
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), 10000);
              keysPressed.current[binds.special2] = false;
            } else if (p.type === "void") {
              if (!p.charging) {
                p.charging = true;
                p.chargeFrames = 0;
              }
            }
          }
        }

        if (p.type === "void" && p.charging && binds.special2 && !keysPressed.current[binds.special2]) {
          const chargeDamage = 1 + Math.floor(p.chargeFrames / 20);
          projectiles.current.push({
            x: p.x + (p.facing > 0 ? p.width : 0),
            y: p.y + 25,
            vx: p.facing * 10,
            owner: p,
            team: p.team,
            type: "chargeball",
            attackHeight: "mid",
            color: p.color,
            radius: 8 + Math.min(p.chargeFrames / 30, 8),
            damage: chargeDamage,
          });
          p.charging = false;
          p.chargeFrames = 0;
          p.canSpecial2 = false;
          setManagedTimeout(() => (p.canSpecial2 = true), 3000);
        }

        return;
      }

      if (p.type === "void" && p.charging && binds.special2 && !keysPressed.current[binds.special2]) {
        const chargeDamage = 1 + Math.floor(p.chargeFrames / 20);
        projectiles.current.push({
          x: p.x + (p.facing > 0 ? p.width : 0),
          y: p.y + 25,
          vx: p.facing * 10,
          owner: p,
          team: p.team,
          type: "chargeball",
          attackHeight: "mid",
          color: p.color,
          radius: 8 + Math.min(p.chargeFrames / 30, 8),
          damage: chargeDamage,
        });
        p.charging = false;
        p.chargeFrames = 0;
        p.canSpecial2 = false;
        setManagedTimeout(() => (p.canSpecial2 = true), 3000);
      }
    };

    const updatePerFrame = (p) => {
      if (!p.alive) return;
      
      if (p.punchCooldown > 0) p.punchCooldown--;
      if (p.kickCooldown > 0) p.kickCooldown--;
      if (p.upperCooldown > 0) p.upperCooldown--;
      if (p.sweepCooldown > 0) p.sweepCooldown--;

      if (p.charging) p.chargeFrames++;

      if (p.hitFlashTimer > 0) p.hitFlashTimer--;

      if (p.blockDisabled) {
        p.blockDisabledTimer--;
        if (p.blockDisabledTimer <= 0) p.blockDisabled = false;
      }
      if (p.specialDisabled) {
        p.specialDisabledTimer--;
        if (p.specialDisabledTimer <= 0) p.specialDisabled = false;
      }
      if (p.jumpDisabled) {
        p.jumpDisabledTimer--;
        if (p.jumpDisabledTimer <= 0) {
          p.jumpDisabled = false;
          p.jumpDisabledTimer = 0;
        }
      }

      if (p.healing) {
        p.healTickTimer--;
        if (p.healTickTimer <= 0 && p.health < 100) {
          p.health = Math.min(100, p.health + 1);
          p.healTickTimer = 20;
        }
      }

      if (p.poisoned && p.poisonTicksLeft > 0) {
        p.poisonTickTimer--;
        if (p.poisonTickTimer <= 0) {
          p.health -= 1;
          p.poisonTicksLeft--;
          p.poisonTickTimer = 60;
          if (p.poisonTicksLeft <= 0) {
            p.poisoned = false;
            p.poisonTicksLeft = 0;
          }
        }
      }

      if (p.frozen) {
        p.frozenTimer--;
        if (p.frozenTimer <= 0) {
          p.frozen = false;
          p.frozenTimer = 0;
        }
        p.vx = 0;
      }

      if (p.hitstun) {
        p.hitstunTimer--;
        if (p.hitstunTimer <= 0) {
          p.hitstun = false;
          p.hitstunTimer = 0;
        }
        p.vx *= 0.92;
      }

      if (p.attacking) {
        p.attackTimer--;
        if (p.attackTimer <= 0) {
          p.attacking = false;
          p.attackType = "";
          p.attackHeight = "";
          p.dashHasHit = false;
        }
      }

      updateHitboxes(p);

      if (!p.grounded) p.vy += GRAVITY;

      p.x += p.vx;
      p.y += p.vy;

      if (!p.hitstun) p.vx *= 0.85;

      if (p.y + p.height >= groundLevel) {
        p.y = groundLevel - p.height;
        p.vy = 0;
        p.grounded = true;
      } else {
        p.grounded = false;
      }

      checkPlatformCollision(p);

      if (p.x < 0) {
        p.x = 0;
        p.vx = 0;
      }
      if (p.x + p.width > WORLD_W) {
        p.x = WORLD_W - p.width;
        p.vx = 0;
      }
    };

    const tryDashHit = (attacker, defender) => {
      if (!attacker.alive || !defender.alive) return false;
      if (!attacker.attacking) return false;
      if (attacker.attackType !== "dash") return false;
      if (attacker.dashHasHit) return false;
      if (attacker.team === defender.team) return false;

      if (checkHitboxCollision(attacker, defender)) {
        applyDamage(attacker, defender, "dash");
        attacker.dashHasHit = true;
        return true;
      }
      return false;
    };

    const checkRoundEndByHP = () => {
      for (const p of fighters) markKOIfNeeded(p);

      const t1Alive = aliveOnTeam(1).length;
      const t2Alive = aliveOnTeam(2).length;

      if (mode === "practice") {
        if (t1Alive === 0) {
          endRound(2, "You were KO'd");
          return true;
        }
        return false;
      }

      if (!is2v2) {
        if (t1Alive === 0 && t2Alive === 0) {
          tieRedoRound();
          return true;
        }
        if (t1Alive === 0) {
          endRound(2, "Team 2 wins (KO)");
          return true;
        }
        if (t2Alive === 0) {
          endRound(1, "Team 1 wins (KO)");
          return true;
        }
        return false;
      }

      if (t1Alive === 0 && t2Alive === 0) {
        tieRedoRound();
        return true;
      }
      if (t1Alive === 0) {
        endRound(2, "Team 2 wins (Team KO)");
        return true;
      }
      if (t2Alive === 0) {
        endRound(1, "Team 1 wins (Team KO)");
        return true;
      }
      return false;
    };

    const endRoundByTimer = () => {
      if (mode === "practice") return false;

      const t1 = teamTotalHP(1);
      const t2 = teamTotalHP(2);

      if (t1 > t2) {
        endRound(1, "Team 1 wins (Time)");
        return true;
      }
      if (t2 > t1) {
        endRound(2, "Team 2 wins (Time)");
        return true;
      }
      tieRedoRound();
      return false;
    };

    const drawPlatforms = () => {
      platforms.forEach((p) => {
        ctx.fillStyle = "#64748b";
        ctx.fillRect(p.x, p.y, p.width, p.height);

        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, p.width, p.height);

        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(p.x, p.y, p.width, 4);
     });
    };
    
  const drawStageBackground = () => {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  const bg = selectedStage === "recursion" ? background2 : background1;

  if (bg.complete && bg.naturalWidth > 0) {
    ctx.drawImage(bg, 0, 0, WORLD_W, WORLD_H);
  }
};

    const drawProjectile = (proj) => {
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    const drawFighter = (p) => {
      if (!p.alive) return;
      ctx.save();

      const drawHeight = p.ducking ? p.height * 0.6 : p.height;
      const drawY = p.ducking ? p.y + p.height * 0.4 : p.y;

      if (p.frozen) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = "#93c5fd";
        ctx.fillRect(p.x - 5, drawY - 5, p.width + 10, drawHeight + 10);
        ctx.globalAlpha = 1;
      }

      if (p.jumpDisabled) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#60a5fa";
        ctx.fillRect(p.x - 6, drawY - 6, p.width + 12, drawHeight + 12);
        ctx.globalAlpha = 1;
      }

      if (p.poisoned && p.poisonTicksLeft > 0) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#4ade80";
        ctx.fillRect(p.x - 5, drawY - 5, p.width + 10, drawHeight + 10);
        ctx.globalAlpha = 1;
      }

      if (p.healing) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#86efac";
        ctx.fillRect(p.x - 8, drawY - 8, p.width + 16, drawHeight + 16);
        ctx.globalAlpha = 1;
      }

      if (p.charging) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = "#1f2937";
        const chargeSize = Math.min(p.chargeFrames / 10, 20);
        ctx.fillRect(p.x - chargeSize / 2, drawY - chargeSize / 2, p.width + chargeSize, drawHeight + chargeSize);
        ctx.globalAlpha = 1;

        const dmg = 1 + Math.floor(p.chargeFrames / 20);
        ctx.fillStyle = "#111827";
        ctx.font = "bold 12px Arial";
        const txt = `DMG ${dmg}`;
        const tw = ctx.measureText(txt).width;
        ctx.fillText(txt, p.x + p.width / 2 - tw / 2, drawY - 18);
      }

      if (p.specialDisabled) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#a855f7";
        ctx.fillRect(p.x - 6, drawY - 6, p.width + 12, drawHeight + 12);
        ctx.globalAlpha = 1;
      }

      if (p.blockDisabled) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(p.x - 5, drawY - 5, p.width + 10, drawHeight + 10);
        ctx.globalAlpha = 1;
      }

      if (p.hitFlashTimer > 0) {
  ctx.save();

  ctx.globalAlpha = p.hitFlashTimer % 4 < 2 ? 0.95 : 0.65;
  ctx.fillStyle = p.hitFlashColor;
  ctx.fillRect(p.x - 8, drawY - 8, p.width + 16, drawHeight + 16);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.strokeRect(p.x - 8, drawY - 8, p.width + 16, drawHeight + 16);

  ctx.restore();
}

ctx.fillStyle = p.color;
ctx.fillRect(p.x, drawY, p.width, drawHeight);

// Strong black outline
ctx.strokeStyle = "#000000";
ctx.lineWidth = 4;
ctx.strokeRect(p.x - 1, drawY - 1, p.width + 2, drawHeight + 2);

// Small inner outline so the body still looks pixel-art
ctx.strokeStyle = "rgba(255,255,255,0.35)";
ctx.lineWidth = 1;
ctx.strokeRect(p.x + 2, drawY + 2, p.width - 4, drawHeight - 4);

      ctx.fillStyle = "rgba(0,0,0,0.4)";
      const faceX = p.facing > 0 ? p.x + p.width - 10 : p.x + 2;
      ctx.fillRect(faceX, drawY + 15, 8, 8);

      if (p.attacking && p.hitbox.width > 0) {
  ctx.save();

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = p.lightColor;
  ctx.fillRect(p.hitbox.x, p.hitbox.y, p.hitbox.width, p.hitbox.height);

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(p.hitbox.x, p.hitbox.y, p.hitbox.width, p.hitbox.height);

  ctx.restore();
}

      if (p.blocking) {
        ctx.strokeStyle = "rgba(251,191,36,0.95)";
        ctx.lineWidth = 4;
        ctx.strokeRect(p.x - 5, drawY - 5, p.width + 10, drawHeight + 10);
      }

      if (is2v2) {
        ctx.fillStyle = "#111827";
        ctx.globalAlpha = 0.9;
        ctx.font = "bold 12px Arial";
        const text = p.label;
        const tw = ctx.measureText(text).width;
        ctx.fillText(text, p.x + p.width / 2 - tw / 2, drawY - 8);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    };

    let lastTime = 0;
    let countdownMsAcc = 0;

    const gameLoop = (time) => {
      if (runTokenRef.current !== myToken) return;

      if (lastTime === 0) {
        lastTime = time;
      }

      const paused = pausedRef.current;
      const delta = time - lastTime;

      if (delta < 16) {
        loopRef.current = requestAnimationFrame(gameLoop);
        return;
      }
      lastTime = time;

      const WIDTH = viewportRef.current.w;
      const HEIGHT = viewportRef.current.h;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(WIDTH * dpr);
      canvas.height = Math.floor(HEIGHT * dpr);
      canvas.style.width = `${WIDTH}px`;
      canvas.style.height = `${HEIGHT}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      const padding = 0;
      let scale = Math.min(WIDTH / WORLD_W, HEIGHT / WORLD_H);

      const offsetX = (WIDTH - WORLD_W * scale) / 2;
      const offsetY = (HEIGHT - WORLD_H * scale) / 2;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      ctx.save();
      ctx.beginPath();
      ctx.rect(offsetX, offsetY, WORLD_W * scale, WORLD_H * scale);
      ctx.clip();

      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      ctx.imageSmoothingEnabled = false;
      drawStageBackground();
      drawPlatforms();

      if (!paused && !gameOver && roundPhaseRef.current === "countdown") {
        countdownMsAcc += delta;

        while (countdownMsAcc >= 1000) {
          countdownMsAcc -= 1000;
          const next = countdownRef.current - 1;

          if (next >= 1) {
            setCountdownValue(next);
            countdownRef.current = next;
          } else if (next === 0) {
            setCountdownValue("GO");
            countdownRef.current = 0;
          } else {
            setRoundPhase("fight");
            roundPhaseRef.current = "fight";
            setCountdownValue(3);
            countdownRef.current = 3;
            countdownMsAcc = 0;

            roundMsRemainingRef.current = ROUND_TIME_SECONDS * 1000;
            lastShownSecondRef.current = ROUND_TIME_SECONDS;
            setRoundTime(ROUND_TIME_SECONDS);
          }
        }
      }

      let secondsLeft = lastShownSecondRef.current ?? ROUND_TIME_SECONDS;
      if (!paused && !gameOver && roundPhaseRef.current === "fight") {
        if (roundMsRemainingRef.current == null) {
          roundMsRemainingRef.current = ROUND_TIME_SECONDS * 1000;
          lastShownSecondRef.current = ROUND_TIME_SECONDS;
          setRoundTime(ROUND_TIME_SECONDS);
        }

        roundMsRemainingRef.current -= delta;
        if (roundMsRemainingRef.current < 0) roundMsRemainingRef.current = 0;

        secondsLeft = Math.ceil(roundMsRemainingRef.current / 1000);
        if (secondsLeft !== lastShownSecondRef.current) {
          lastShownSecondRef.current = secondsLeft;
          setRoundTime(secondsLeft);
        }

        if (roundMsRemainingRef.current <= 0) {
          endRoundByTimer();
        }
      }

      const canAct = !paused && !gameOver && roundPhaseRef.current === "fight";

      if (canAct) {
        for (const p of fighters) {
          if (p.isHuman) doHumanControls(p);
        }

        for (const p of fighters) {
          if (!p.isHuman && p.team === 2) updateAI(p);
        }

        for (const p of fighters) updatePerFrame(p);

        for (const attacker of fighters) {
          if (!attacker.alive) continue;
          if (!attacker.attacking) continue;

          if (attacker.attackType === "dash") {
            for (const defender of fighters) {
              if (!defender.alive) continue;
              if (defender.team === attacker.team) continue;
              if (tryDashHit(attacker, defender)) {
                markKOIfNeeded(defender);
              }
            }
          } else {
            if (attacker.attackTimer === 12) {
              for (const defender of fighters) {
                if (!defender.alive) continue;
                if (defender.team === attacker.team) continue;
                if (checkHitboxCollision(attacker, defender)) {
                  applyDamage(attacker, defender, attacker.attackType);
                  markKOIfNeeded(defender);
                }
              }
            }
          }
        }

        for (let i = projectiles.current.length - 1; i >= 0; i--) {
          const proj = projectiles.current[i];
          proj.x += proj.vx;

          let hitSomeone = false;
          for (const target of fighters) {
            if (!target.alive) continue;
            if (target.team === proj.team) continue;

            if (proj.attackHeight === "high" && target.ducking) continue;

            const dx = target.x + target.width / 2 - proj.x;
            const dy = target.y + target.height / 2 - proj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < target.width / 2 + proj.radius) {
              if (proj.type === "chargeball") {
                breakFreezeIfNeeded(target);

                const blocked = canBlockAttack(proj.owner, target, "chargeball", proj.attackHeight);
                let actualDamage = proj.damage;
                let knockback = Math.min(24, 6 + Math.floor((proj.damage || 1) / 2));

                if (blocked) {
                  actualDamage = Math.floor(actualDamage * 0.25);
                  knockback = Math.floor(knockback * 0.3);
                }

                target.health -= actualDamage;

                target.vx = (Math.sign(proj.vx) || proj.owner?.facing || 1) * knockback;
                if (!blocked) {
                  target.hitstun = true;
                  target.hitstunTimer = Math.min(30, 10 + (proj.damage || 1));
                  target.attacking = false;
                  target.attackTimer = 0;
                  target.attackType = "";
                }
              } else if (proj.type === "sloworb") {
  applyDamage(proj.owner, target, "sloworb", {
    attackHeight: proj.attackHeight,
    knockbackDir: Math.sign(proj.vx) || 1,
  });
} else {
  applyDamage(proj.owner, target, proj.type, {
    attackHeight: proj.attackHeight,
    knockbackDir: Math.sign(proj.vx) || 1,
  });
}

              markKOIfNeeded(target);

              projectiles.current.splice(i, 1);
              hitSomeone = true;
              break;
            }
          }
          if (hitSomeone) continue;

          if (proj.x < -50 || proj.x > WORLD_W + 50) projectiles.current.splice(i, 1);
        }

        checkRoundEndByHP();
      }

      projectiles.current.forEach(drawProjectile);
      fighters.forEach(drawFighter);

      if (!is2v2) {
        const f1 = fighters.find((f) => f.team === 1);
        const f2 = fighters.find((f) => f.team === 2);
        drawHealthBarSmall(`${f1.name} (You)`, f1.alive ? f1.health : 0, 30, 20, f1.color, team1Rounds, false);
        drawHealthBarSmall(`${f2.name} (${f2.isHuman ? "P2" : gameConfig.practiceDummy ? "Dummy" : "AI"})`, f2.alive ? f2.health : 0, WORLD_W - 220, 20, f2.color, team2Rounds, true);
      } else {
        const p1 = fighters.find((f) => f.id === "p1");
        const p2 = fighters.find((f) => f.id === "p2");
        const e1 = fighters.find((f) => f.id === "ai1");
        const e2 = fighters.find((f) => f.id === "ai2");

        drawHealthBarSmall(`${p1.name} (P1)`, p1.alive ? p1.health : 0, 20, 18, p1.color, team1Rounds, false);
        drawHealthBarSmall(`${p2.name} (P2)`, p2.alive ? p2.health : 0, 20, 86, p2.color, null, false);

        drawHealthBarSmall(`${e1.name} (E1)`, e1.alive ? e1.health : 0, WORLD_W - 210, 18, e1.color, team2Rounds, true);
        drawHealthBarSmall(`${e2.name} (E2)`, e2.alive ? e2.health : 0, WORLD_W - 210, 86, e2.color, null, true);
      }

      drawRoundTimer(Math.max(0, secondsLeft));

      if (mode === "practice") {
        ctx.fillStyle = "rgba(17,24,39,0.75)";
        ctx.font = "12px Arial";
        // ctx.fillText("Practice: Dummy has 100 HP, takes knockback/launch, and disappears on KO. Use Refresh to bring it back.", 18, WORLD_H - 18);
      }

      if (roundPhaseRef.current === "countdown") {
        const v = countdownRef.current === 0 ? "GO" : countdownRef.current;
        drawCountdown(v);
      }

      if (paused) drawPaused();

      ctx.restore();

      loopRef.current = requestAnimationFrame(gameLoop);
    };

    loopRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      clearAllTimeouts();
      runTokenRef.current++;
      runningRef.current = false;
      practiceRefreshRef.current = null;
    };
  }, [tailwindLoaded, menuStep, gameConfig, gameOver, team1Rounds, team2Rounds, mode]);

  useEffect(() => {
  if (menuStep !== "playing") return;
  if (!gameOver) return;
  if (matchWinnerText) return;

  const id = window.setTimeout(() => {
    setGameOver(false);
    setRoundWinnerText(null);

    keysPressed.current = {};
    projectiles.current = [];

    roundMsRemainingRef.current = null;
    lastShownSecondRef.current = null;
    setRoundTime(null);

    setRoundPhase("countdown");
    setCountdownValue(3);
    roundPhaseRef.current = "countdown";
    countdownRef.current = 3;
  }, 1200);

  return () => window.clearTimeout(id);
}, [gameOver, matchWinnerText, menuStep]);

  if (!tailwindLoaded) return <div style={{ padding: 20, textAlign: "center" }}>Loading…</div>;

  const GlobalSettingsButton = () => (
    <button
      className="fixed top-6 right-6 z-40 bg-white/90 backdrop-blur border border-gray-200 rounded-2xl px-4 py-3 hover:bg-white transition flex items-center gap-2"
      onClick={() => setSettingsOpen(true)}
    >
      <span className="text-lg">⚙️</span>
      <span className="text-sm text-gray-800 font-light">Settings</span>
    </button>
  );

  const SettingsModal = () => {
    if (!settingsOpen) return null;

    const Row = ({ title, currentKey, onChange }) => (
      <div className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-gray-100 bg-white">
        <div>
          <div className="text-sm text-gray-900 font-light">{title}</div>
          <div className="text-xs text-gray-500 font-light mt-1">
            Current: <span className="font-medium text-gray-700">{prettyKey(currentKey) || "Unbound"}</span>
          </div>
        </div>
        <button className="rounded-2xl px-4 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light" onClick={onChange}>
          Change
        </button>
      </div>
    );

    const P1 = p1BindsRef.current;
    const P2 = p2BindsRef.current;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/30"
          onClick={() => {
            setListeningFor(null);
            setSettingsOpen(false);
          }}
        />
        <div className="relative bg-white rounded-3xl w-[820px] max-w-[94vw] p-8 border border-gray-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-light text-gray-900">Settings</div>
              <div className="text-sm text-gray-500 font-light mt-1">Keybinds (P1 + P2)</div>
            </div>

            <button
              className="rounded-2xl px-4 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light"
              onClick={() => {
                setListeningFor(null);
                setSettingsOpen(false);
              }}
            >
              Close
            </button>
          </div>

          {listeningFor && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm font-light text-gray-800">
              Press a key… <span className="text-gray-500">(Esc to cancel)</span>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm font-light text-gray-700">Player 1</div>
              <Row title="Move Left" currentKey={P1.moveLeft} onChange={() => setListeningFor({ player: "p1", action: "moveLeft" })} />
              <Row title="Move Right" currentKey={P1.moveRight} onChange={() => setListeningFor({ player: "p1", action: "moveRight" })} />
              <Row title="Jump" currentKey={P1.jump} onChange={() => setListeningFor({ player: "p1", action: "jump" })} />
              <Row title="Duck" currentKey={P1.duck} onChange={() => setListeningFor({ player: "p1", action: "duck" })} />
              <Row title="Block" currentKey={P1.block} onChange={() => setListeningFor({ player: "p1", action: "block" })} />
              <Row title="Punch" currentKey={P1.punch} onChange={() => setListeningFor({ player: "p1", action: "punch" })} />
              <Row title="Kick" currentKey={P1.kick} onChange={() => setListeningFor({ player: "p1", action: "kick" })} />
              <Row title="Special Move 1" currentKey={P1.special1} onChange={() => setListeningFor({ player: "p1", action: "special1" })} />
              <Row title="Special Move 2" currentKey={P1.special2} onChange={() => setListeningFor({ player: "p1", action: "special2" })} />
            </div>

            <div className="space-y-3">
              <div className="text-sm font-light text-gray-700">Player 2</div>
              <Row title="Move Left" currentKey={P2.moveLeft} onChange={() => setListeningFor({ player: "p2", action: "moveLeft" })} />
              <Row title="Move Right" currentKey={P2.moveRight} onChange={() => setListeningFor({ player: "p2", action: "moveRight" })} />
              <Row title="Jump" currentKey={P2.jump} onChange={() => setListeningFor({ player: "p2", action: "jump" })} />
              <Row title="Duck" currentKey={P2.duck} onChange={() => setListeningFor({ player: "p2", action: "duck" })} />
              <Row title="Block" currentKey={P2.block} onChange={() => setListeningFor({ player: "p2", action: "block" })} />
              <Row title="Punch" currentKey={P2.punch} onChange={() => setListeningFor({ player: "p2", action: "punch" })} />
              <Row title="Kick" currentKey={P2.kick} onChange={() => setListeningFor({ player: "p2", action: "kick" })} />
              <Row title="Special Move 1" currentKey={P2.special1} onChange={() => setListeningFor({ player: "p2", action: "special1" })} />
              <Row title="Special Move 2" currentKey={P2.special2} onChange={() => setListeningFor({ player: "p2", action: "special2" })} />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <button
              className="rounded-2xl px-4 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light"
              onClick={() => {
                setListeningFor(null);
                setP1Binds(DEFAULT_P1);
                setP2Binds(DEFAULT_P2);
              }}
            >
              Reset Defaults
            </button>

            <button
              className="rounded-2xl px-4 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light"
              onClick={() => {
                setListeningFor(null);
                setSettingsOpen(false);
                goHome();
              }}
            >
              Return to Home
            </button>
            <button
  onClick={toggleFullscreen}
  className="bg-white/80 backdrop-blur border border-gray-200 rounded-2xl px-5 py-3 hover:bg-white transition"
>
  <span className="text-sm text-gray-800 font-light">
    {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
  </span>
</button>
          </div>

          <div className="mt-4 text-xs text-gray-500 font-light">Tip: Opening settings pauses gameplay (and the timer).</div>
        </div>
      </div>
    );
  };

  const Layout = ({ children }) => (
    <div
      className="min-h-screen flex items-center justify-center p-12 relative"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        background: "#F9E4BC",
      }}
    >
      <GlobalSettingsButton />
      <SettingsModal />
      {children}
    </div>
  );

  const ColorCard = ({ color, selected, onClick, note }) => (
    <button
      onClick={onClick}
      className="group relative bg-white border rounded-3xl p-10 hover:scale-[0.98] active:scale-95 transition-all duration-150"
      style={{
        boxShadow:
          selected
            ? `0 15px 40px ${
                color === "red"
                  ? "rgba(239, 68, 68, 0.2)"
                  : color === "blue"
                  ? "rgba(59, 130, 246, 0.2)"
                  : color === "green"
                  ? "rgba(34, 197, 94, 0.2)"
                  : "rgba(31, 41, 55, 0.2)"
              }`
            : "0 10px 30px rgba(0, 0, 0, 0.05)",
        borderColor:
          selected
            ? color === "red"
              ? "#ef4444"
              : color === "blue"
              ? "#3b82f6"
              : color === "green"
              ? "#22c55e"
              : "#1f2937"
            : "#f3f4f6",
      }}
    >
      <div className="mb-6">
        <div
          className={`w-24 h-32 rounded-2xl mx-auto border-4 ${
            color === "red"
              ? "bg-red-500 border-red-600"
              : color === "blue"
              ? "bg-blue-500 border-blue-600"
              : color === "green"
              ? "bg-green-500 border-green-600"
              : "bg-gray-800 border-black"
          }`}
        />
      </div>
      <h2 className="text-2xl font-light text-gray-900 mb-2 capitalize">{color}</h2>
      <p className="text-xs font-light text-gray-500">{note}</p>
    </button>
  );

  if (mode === "home") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-6xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">RGB Fighters</h1>
          <p className="text-4xl font-light text-gray-500 mb-12">Choose a Mode</p>

          <div className="grid grid-cols-3 gap-6">
            {[
              { key: "practice", title: "Practice", desc: "100-HP dummy (KO disappears) + Refresh button" },
              { key: "single", title: "Single Player", desc: "Fight an AI (best of 3)" },
              { key: "coop", title: "Multi Player", desc: "2v2: P1+P2 vs AI team (pick both enemies)" },
              { key: "ladder", title: "Ladder", desc: "Face all the colors, and the last fight is a mirror match." },
              { key: "offline", title: "1v1 Offline", desc: "Local PvP (P1 vs P2)" },
              { key: "online", title: "1v1 Online (Coming Soon)", desc: "Not playable yet" },
            ].map((m) => {
              const disabled = m.key === "online";
              return (
                <button
                  key={m.key}
                  disabled={disabled}
                  onClick={() => (disabled ? startModeFlow("online") : startModeFlow(m.key))}
                  className={`text-left rounded-3xl p-8 border transition ${
                    disabled ? "bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed" : "bg-white border-gray-100 hover:scale-[0.99] active:scale-95"
                  }`}
                  style={{ boxShadow: disabled ? "none" : "0 10px 30px rgba(0,0,0,0.06)" }}
                >
                  <div className="text-2xl font-light text-gray-900">{m.title}</div>
                  <div className="text-sm font-light text-gray-500 mt-2">{m.desc}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-10 text-sm text-gray-500 font-light"></div>
        </div>
      </Layout>
    );
  }

  if (menuStep === "comingsoon" || mode === "online") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-3xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">Online 1v1</h1>
          <p className="text-lg font-light text-gray-500 mb-10">Coming Soon — this mode is not playable yet.</p>
          <button onClick={goHome} className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition">
            Return Home
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "p1") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-6xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">Choose Player 1</h1>
          <p className="text-xl font-light text-gray-500 mb-10">
            {mode === "practice"
              ? "Practice — Pick your fighter"
              : mode === "single"
              ? "Single Player — Pick your fighter"
              : mode === "offline"
              ? "Offline 1v1 — Pick P1 fighter"
              : mode === "coop"
              ? "2v2 — Pick P1 fighter"
              : "Ladder — Pick your fighter"}
          </p>

          <div className="grid grid-cols-4 gap-6">
            {["red", "blue", "green", "black"].map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={p1Color === c}
                onClick={() => {
                  setP1Color(c);

                  if (mode === "ladder") {
                    const others = ["red", "blue", "green", "black"].filter((x) => x !== c);
                    setLadderOppOrder(shuffle(others));
                  }

                  setManagedTimeout(() => proceedAfterP1(), 0);
                }}
                note={c === "red" ? "Fire & Dash" : c === "blue" ? "Ice Control" : c === "green" ? "Poison & Heal" : "Void & Charge"}
              />
            ))}
          </div>

          <button onClick={goHome} className="mt-10 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors">
            {"\u2190"} Back to Home
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "opp1") {
    const title = mode === "practice" ? "Choose Dummy Color" : mode === "coop" ? "Choose Opponent 1" : "Choose Opponent";
    const subtitle =
      mode === "practice" ? "Dummy doesn’t fight back. 100 HP, (use Refresh to bring it back)." : "Pick AI Fighter";

    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-6xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">{title}</h1>
          <p className="text-xl font-light text-gray-500 mb-10">{subtitle}</p>

          <div className="grid grid-cols-4 gap-6">
            {["red", "blue", "green", "black"].map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={opp1Color === c}
                onClick={() => {
                  setOpp1Color(c);
                  setManagedTimeout(() => proceedAfterOpp1(), 0);
                }}
                note={c === "red" ? "Fire" : c === "blue" ? "Ice" : c === "green" ? "Poison" : "Void"}
              />
            ))}
          </div>

          <button
            onClick={() => {
              setOpp1Color(null);
              if (mode === "coop") setMenuStep("p2");
              else setMenuStep("p1");
            }}
            className="mt-10 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors"
          >
            {"\u2190"} Back
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "opp2") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-6xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">Choose Opponent 2</h1>
          <p className="text-xl font-light text-gray-500 mb-10">Pick the AI Fighter 2</p>

          <div className="grid grid-cols-4 gap-6">
            {["red", "blue", "green", "black"].map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={opp2Color === c}
                onClick={() => {
                  setOpp2Color(c);
                  setManagedTimeout(() => proceedAfterOpp2(), 0);
                }}
                note={c === "red" ? "Fire" : c === "blue" ? "Ice" : c === "green" ? "Poison" : "Void"}
              />
            ))}
          </div>

          <button
            onClick={() => {
              setOpp2Color(null);
              setMenuStep("opp1");
            }}
            className="mt-10 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors"
          >
            {"\u2190"} Back
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "p2") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-6xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">Choose Player 2</h1>
          <p className="text-xl font-light text-gray-500 mb-10">{mode === "offline" ? "Offline 1v1 — Pick P2 Fighter" : "2v2 — Pick P2 Fighter"}</p>

          <div className="grid grid-cols-4 gap-6">
            {["red", "blue", "green", "black"].map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={p2Color === c}
                onClick={() => {
                  setP2Color(c);
                  setManagedTimeout(() => proceedAfterP2(), 0);
                }}
                note={c === "red" ? "Fire & Dash" : c === "blue" ? "Ice Control" : c === "green" ? "Poison & Heal" : "Void & Charge"}
              />
            ))}
          </div>

          <button
            onClick={() => {
              setP2Color(null);
              setMenuStep("p1");
            }}
            className="mt-10 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors"
          >
            {"\u2190"} Back
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "difficulty") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-3xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">Select Difficulty</h1>
          <p className="text-lg font-light text-gray-500 mb-12">{mode === "ladder" ? "Choose your difficulty level." : ""}</p>

          <div className="space-y-4">
            {[
              { name: "easy", desc: "" },
              { name: "medium", desc: "" },
              { name: "hard", desc: "" },
            ].map(({ name, desc }) => (
              <button
                key={name}
                onClick={() => {
                  setDifficulty(name);
                  setManagedTimeout(() => proceedAfterDifficulty(), 0);
                }}
                className="w-full py-8 bg-white border border-gray-100 rounded-2xl hover:scale-[0.98] active:scale-95 transition-all duration-150"
                style={{ boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)" }}
              >
                <h2 className="text-3xl font-light mb-2 capitalize">{name}</h2>
                <p className="text-sm text-gray-500 font-light">{desc}</p>
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setDifficulty(null);
              if (mode === "single") setMenuStep("opp1");
              else if (mode === "coop") setMenuStep("opp2");
              else if (mode === "ladder") setMenuStep("p1");
            }}
            className="mt-8 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors"
          >
            {"\u2190"} Back
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "stage") {
    const stageChoices = [
      { key: "default", title: "Default Stage", desc: "Classic arena with platforms" },
      { key: "recursion", title: "Recursion", desc: "Pyramid platforms" },
    ];

    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-4xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">Select Stage</h1>
          <p className="text-lg font-light text-gray-500 mb-12 mt-12">Choose your battlefield.</p>

          <div className="grid grid-cols-2 gap-6">
            {stageChoices.map((s) => (
              <button
                key={s.key}
                onClick={() => {
  setStage(s.key);

  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  setManagedTimeout(() => proceedAfterStage(), 0);
}}
                className="p-10 bg-white border border-gray-100 rounded-2xl hover:scale-[0.98] active:scale-95 transition-all duration-150"
                style={{ boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)" }}
              >
                <div className={`mb-6 h-40 rounded-2xl flex items-center justify-center ${s.key === "recursion" ? "bg-gradient-to-b from-gray-700 to-gray-900" : "bg-gradient-to-b from-gray-100 to-gray-200"}`}>
                  <div className="text-6xl">{s.key === "recursion" ? "🔺" : "🏛️"}</div>
                </div>
                <h2 className="text-2xl font-light text-gray-900 mb-2">{s.title}</h2>
                <p className="text-sm font-light text-gray-500">{s.desc}</p>
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setStage(null);
              if (mode === "practice") setMenuStep("opp1");
              else if (mode === "single") setMenuStep("difficulty");
              else if (mode === "offline") setMenuStep("p2");
              else if (mode === "coop") setMenuStep("difficulty");
            }}
            className="mt-8 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors"
          >
            {"\u2190"} Back
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "playing") {
    const ladderLabel = mode === "ladder" ? `Ladder Match ${ladderIndex + 1} / 4` : null;

    const onExit = () => {
      goHome();
    };

    const onNextMatchLadder = () => {
      if (!matchWinnerText) return;

      if (matchWinnerText === "Team 1") {
        const next = ladderIndex + 1;
        if (next >= 4) {
          setLadderWin(true);
          setMenuStep("ladder_result");
          return;
        }
        setLadderIndex(next);
        setTeam1Rounds(0);
        setTeam2Rounds(0);
        setGameOver(false);
        setRoundWinnerText(null);
        setMatchWinnerText(null);
        keysPressed.current = {};
        projectiles.current = [];
        primeNewRound();
        setMenuStep("playing");
      } else {
        setLadderLoss(true);
        setMenuStep("ladder_result");
      }
    };

    const showOverlay = gameOver;

    return (
      <div className="fixed inset-0 overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}>
        <canvas ref={canvasRef} className="absolute inset-0" />

        <GlobalSettingsButton />
        <SettingsModal />

        <div className="absolute top-6 left-6 z-40 flex items-center gap-3">
          <button onClick={onExit} className="bg-white/80 backdrop-blur border border-gray-200 rounded-2xl px-5 py-3 hover:bg-white transition">
            <span className="text-sm text-gray-800 font-light">Exit</span>
          </button>

          {mode === "practice" && (
            <button
              onClick={() => {
                if (practiceRefreshRef.current) practiceRefreshRef.current();
              }}
              className="bg-white/80 backdrop-blur border border-gray-200 rounded-2xl px-5 py-3 hover:bg-white transition"
            >
              <span className="text-sm text-gray-800 font-light">Refresh</span>
            </button>
          )}
          

          {ladderLabel && <div className="bg-white/80 backdrop-blur border border-gray-200 rounded-2xl px-4 py-3 text-sm font-light text-gray-800">{ladderLabel}</div>}
        </div>

        {showOverlay && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-white/85 backdrop-blur rounded-3xl p-10 border border-gray-200 text-center max-w-xl mx-6">
              <div className="text-3xl font-light text-gray-900 mb-2">{matchWinnerText ? `MATCH WINNER: ${matchWinnerText}` : `ROUND: ${roundWinnerText || "Complete"}`}</div>
              <div className="text-sm text-gray-600 font-light mb-6">{matchWinnerText ? "Best of 3 complete." : "Prepare for the next round."}</div>

              <div className="flex gap-3 justify-center flex-wrap">
                {!matchWinnerText ? (
                  <div className="bg-gray-900 text-white rounded-2xl px-6 py-3">
  Next round starting...
</div>
                ) : mode === "ladder" ? (
                  <button onClick={onNextMatchLadder} className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition">
                    {matchWinnerText === "Team 1" ? "Next Ladder Match" : "Ladder Failed"}
                  </button>
                ) : (
                  <button onClick={() => startModeFlow(mode)} className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition">
                    Back to Mode Menu
                  </button>
                )}

                <button onClick={goHome} className="rounded-2xl px-6 py-3 border border-gray-200 hover:bg-gray-50 transition font-light text-gray-800">
                  Home
                </button>
              </div>
                
              {mode === "practice" && <div className="mt-4 text-xs text-gray-500 font-light">Tip: Use Refresh to reset positions and bring the dummy back after a KO.</div>}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (menuStep === "ladder_result") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-3xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">Ladder</h1>

          {ladderWin ? (
            <>
              <p className="text-lg font-light text-gray-600 mb-10">You are the Ultimate RGB Fighter!</p>
              <button
                onClick={() => {
                  setLadderWin(false);
                  setLadderIndex(0);
                  startModeFlow("ladder");
                }}
                className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition"
              >
                Run Ladder Again
              </button>
            </>
          ) : (
            <>
              <p className="text-lg font-light text-gray-600 mb-10">You lost!</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => {
                    setLadderLoss(false);
                    setLadderIndex(0);
                    startModeFlow("ladder");
                  }}
                  className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition"
                >
                  Try Again
                </button>
                <button onClick={goHome} className="rounded-2xl px-6 py-3 border border-gray-200 hover:bg-gray-50 transition font-light text-gray-800">
                  Home
                </button>
              </div>
            </>
          )}
        </div>
      </Layout>
    );
  }

  return null;
}

export default FighterGame;