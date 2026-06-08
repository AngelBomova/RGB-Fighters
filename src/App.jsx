import background1Url from "./assets/Background1.png";
import background2Url from "./assets/Background2.png";
import background3Url from "./assets/Background3.png";
import background4Url from "./assets/Background4.png";
import background5Url from "./assets/Background5.png";
import homepageUrl from "./assets/homepage.png";
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "./api";
import Login from "./online/Login";
import Leaderboard from "./online/Leaderboard";
import { createSocket } from "./socket";

const rgbSoundModules = import.meta.glob("./assets/RGBsounds/*", { eager: true, import: "default" });
const RGB_SOUND_URLS = Object.fromEntries(
  Object.entries(rgbSoundModules).map(([path, url]) => {
    const fileName = path.split("/").pop() || "";
    const soundName = fileName.replace(/\.[^.]+$/, "");
    return [soundName, url];
  })
);

function FighterGame() {
  const [tailwindLoaded, setTailwindLoaded] = useState(false);

  const [mode, setMode] = useState("home");

  const [menuStep, setMenuStep] = useState("idle");

  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem('rgb_token');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    api.me(token).then((u) => {
      if (!mounted) return;
      setUser(u);
    }).catch(() => {
      localStorage.removeItem('rgb_token');
      setToken(null);
      setUser(null);
    });
    return () => (mounted = false);
  }, [token]);

  const refreshOnlineUser = () => {
    const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("rgb_token") : null);
    if (!authToken) return;
    api.me(authToken).then((updatedUser) => {
      setUser(updatedUser);
    }).catch(() => {});
  };

  const socketRef = useRef(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [forfeitRemaining, setForfeitRemaining] = useState(0);
  const forfeitIntervalRef = useRef(null);
  const [queueing, setQueueing] = useState(false);
  const [matched, setMatched] = useState(null); // { matchId, opponent, side }
  const [charSelect, setCharSelect] = useState(null); // { timeLeft, matchId }
  const [onlineError, setOnlineError] = useState("");
  const [onlinePlayerNames, setOnlinePlayerNames] = useState({ p1: "", p2: "" });
  const onlineMatchRef = useRef(null); // { matchId, side }
  const onlineRemoteInputsRef = useRef({});

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (forfeitIntervalRef.current) {
        clearInterval(forfeitIntervalRef.current);
        forfeitIntervalRef.current = null;
      }
      setOpponentDisconnected(false);
    };
  }, []);

  useEffect(() => {
    if (!charSelect) return;
    const start = Date.now();
    let remaining = charSelect.timeLeft || 20000;
    const iv = setInterval(() => {
      remaining -= 250;
      setCharSelect((s) => (s ? { ...s, timeLeft: Math.max(0, remaining) } : null));
      if (remaining <= 0) clearInterval(iv);
    }, 250);
    return () => clearInterval(iv);
  }, [charSelect]);

  useEffect(() => {
    if (!charSelect || charSelect.timeLeft > 0) return;
    clearOnlineSession({ disconnectSocket: false, keepLobby: false });
    setMode("home");
    setMenuStep("idle");
  }, [charSelect?.timeLeft]);

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
  const fightersRef = useRef([]);
  const onlineLastSyncSeqRef = useRef(0);
  const onlineSyncSeqRef = useRef(0);
  const onlineSyncMatchIdRef = useRef(null);
  const onlineLastStatePostAtRef = useRef(0);
  const onlineIsHostRef = useRef(false);
  const onlineMatchEndSentRef = useRef(false);
  const pausedRef = useRef(false);

  const practiceRefreshRef = useRef(null);
  const musicAudioRef = useRef({});
  const currentMusicRef = useRef("");
  const audioUnlockedRef = useRef(false);
  const [musicReady, setMusicReady] = useState(false);
  const defaultApiBaseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3001";
  const apiBaseUrl = String(import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE || defaultApiBaseUrl).replace(/\/api\/?$/, "").replace(/\/$/, "");
  const [musicVolume, setMusicVolume] = useState(() => {
    try {
      const raw = localStorage.getItem("rgb_fighters_music_volume_v1") ?? localStorage.getItem("rgb_fighters_master_volume_v1");
      const parsed = raw == null ? 50 : Number(raw);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
    } catch {
      return 50;
    }
  });
  const [sfxVolume, setSfxVolume] = useState(() => {
    try {
      const raw = localStorage.getItem("rgb_fighters_sfx_volume_v1") ?? localStorage.getItem("rgb_fighters_master_volume_v1");
      const parsed = raw == null ? 50 : Number(raw);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
    } catch {
      return 50;
    }
  });
  const musicVolumeRef = useRef(musicVolume);
  const sfxVolumeRef = useRef(sfxVolume);

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
  const countdownEndsAtRef = useRef(null);
  const roundEndsAtRef = useRef(null);
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
  const onlineOpponentBindsRef = useRef({
    moveLeft: "__remote_moveLeft",
    moveRight: "__remote_moveRight",
    jump: "__remote_jump",
    duck: "__remote_duck",
    block: "__remote_block",
    punch: "__remote_punch",
    kick: "__remote_kick",
    special1: "__remote_special1",
    special2: "__remote_special2",
  });

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

  useEffect(() => {
    musicVolumeRef.current = musicVolume;
    try {
      localStorage.setItem("rgb_fighters_music_volume_v1", String(musicVolume));
    } catch {}

    for (const audio of Object.values(musicAudioRef.current)) {
      audio.volume = 0.35 * (musicVolume / 100);
    }

    const activeName = currentMusicRef.current;
    if (activeName && musicAudioRef.current[activeName]) {
      musicAudioRef.current[activeName].volume = 0.35 * (musicVolume / 100);
    }
  }, [musicVolume]);

  useEffect(() => {
    sfxVolumeRef.current = sfxVolume;
    try {
      localStorage.setItem("rgb_fighters_sfx_volume_v1", String(sfxVolume));
    } catch {}
  }, [sfxVolume]);

  useEffect(() => {
    if (Object.keys(musicAudioRef.current).length) return;

    const musicNames = {
      menu: "menu_theme",
      default: "stage_default",
      recursion: "stage_recursion",
      sky: "stage_sky",
      hourglass: "stage_hourglass",
      bottom: "stage_bottom",
    };

    const tracks = {};

    for (const [key, soundName] of Object.entries(musicNames)) {
      const url = RGB_SOUND_URLS[soundName];
      if (!url) continue;
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = 0.35 * (musicVolumeRef.current / 100);
      audio.preload = "auto";
      tracks[key] = audio;
    }

    musicAudioRef.current = tracks;
    setMusicReady(true);
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listeningFor, setListeningFor] = useState(null);
  const listeningForRef = useRef(null);

  const ACTION_LABELS = {
    moveLeft: "Move Left",
    moveRight: "Move Right",
    jump: "Jump",
    duck: "Duck",
    block: "Block",
    punch: "Punch",
    kick: "Kick",
    special1: "Special Move 1",
    special2: "Special Move 2",
  };

  useEffect(() => {
    listeningForRef.current = listeningFor;
  }, [listeningFor]);

  useEffect(() => {
    pausedRef.current = settingsOpen && mode !== "online";

    if (settingsOpen && mode !== "online") {
      keysPressed.current = {};
    }

    if (!settingsOpen) {
      listeningForRef.current = null;
      setListeningFor(null);
    }
  }, [settingsOpen, mode]);

  useEffect(() => {
    const handleBlur = () => {
      if (mode === "online" && onlineMatchRef.current?.matchId) {
        keysPressed.current = {};
        sendOnlineInputs();
      }
    };

    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleBlur);

    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleBlur);
    };
  }, [mode]);

  const stopMusic = () => {
    const currentName = currentMusicRef.current;
    if (!currentName) return;

    const audio = musicAudioRef.current[currentName];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    currentMusicRef.current = "";
  };

  const playMusic = (name) => {
    if (!name) return;

    const audio = musicAudioRef.current[name];
    if (!audio) return;

    if (currentMusicRef.current === name && !audio.paused) return;

    if (currentMusicRef.current !== name) {
      stopMusic();
      currentMusicRef.current = name;
    }

    audio.volume = 0.35 * (musicVolumeRef.current / 100);
    audio.loop = true;
    if (audio.paused) audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  const playSfx = (name) => {
    const url = RGB_SOUND_URLS[name];
    if (!url) return;

    try {
      const audio = new Audio(url);
      audio.volume = 0.65 * (sfxVolumeRef.current / 100);
      audio.play().catch(() => {});
    } catch {}
  };

  const unlockAudio = () => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;

    const activeName = currentMusicRef.current || ((menuStep === "playing" && !settingsOpen) ? gameConfig.stage || "default" : "menu");
    const audio = musicAudioRef.current[activeName];
    if (audio) audio.play().catch(() => {});
  };

  const normalizeBindKey = (key) => {
    const k = String(key || "").toLowerCase();

    if (k === "spacebar") return " ";
    if (k === " ") return " ";
    if (k.startsWith("arrow")) return k;

    return k;
  };

  const prettyKey = (k) => {
    if (!k) return "";

    const key = normalizeBindKey(k);

    if (key === " ") return "Space";
    if (key === "escape") return "Esc";

    if (key.startsWith("arrow")) {
      return key
        .replace("arrow", "Arrow ")
        .replace("up", "Up")
        .replace("down", "Down")
        .replace("left", "Left")
        .replace("right", "Right");
    }

    return key.length === 1 ? key.toUpperCase() : key;
  };

  const isBindableKey = (k) => {
    if (!k) return false;

    const blocked = [
      "meta",
      "shift",
      "control",
      "alt",
      "capslock",
      "tab",
      "dead",
      "unidentified",
      "process",
    ];

    return !blocked.includes(k);
  };

  const clearKeyFromBindSet = (bindSet, keyToRemove) => {
    const next = { ...bindSet };

    for (const action of Object.keys(next)) {
      if (next[action] === keyToRemove) {
        next[action] = "";
      }
    }

    return next;
  };

  const applyNewBinding = (player, action, key) => {
    const k = normalizeBindKey(key);
    if (!isBindableKey(k)) return;

    keysPressed.current = {};

    if (player === "p1") {
      setP1Binds((prev) => {
        const next = clearKeyFromBindSet(prev, k);
        next[action] = k;
        return next;
      });

      setP2Binds((prev) => clearKeyFromBindSet(prev, k));
    } else {
      setP2Binds((prev) => {
        const next = clearKeyFromBindSet(prev, k);
        next[action] = k;
        return next;
      });

      setP1Binds((prev) => clearKeyFromBindSet(prev, k));
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!settingsOpen) return;

      const target = listeningForRef.current;
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }

      if (e.repeat) return;

      const k = normalizeBindKey(e.key);

      if (k === "escape") {
        listeningForRef.current = null;
        setListeningFor(null);
        keysPressed.current = {};
        return;
      }

      if (!isBindableKey(k)) return;

      applyNewBinding(target.player, target.action, k);

      listeningForRef.current = null;
      setListeningFor(null);
      keysPressed.current = {};
    };

    window.addEventListener("keydown", onKey, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [settingsOpen]);

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
    document.body.style.background = "#020617";
    document.documentElement.style.background = "#020617";
    document.documentElement.style.minHeight = "100%";
    return () => {
      document.body.style.background = "";
      document.documentElement.style.background = "";
      document.documentElement.style.minHeight = "";
    };
  }, []);

  const primeNewRound = () => {
    roundMsRemainingRef.current = null;
    lastShownSecondRef.current = null;
    countdownEndsAtRef.current = Date.now() + 4000;
    roundEndsAtRef.current = null;
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
    if (roundPhase !== "countdown") return;
    if (countdownEndsAtRef.current) return;
    countdownEndsAtRef.current = Date.now() + 4000;
  }, [roundPhase]);
  useEffect(() => {
    countdownRef.current = countdownValue === "GO" ? 0 : countdownValue;
  }, [countdownValue]);

  useEffect(() => {
    if (mode === "online" && !onlineIsHostRef.current) return;
    if (mode !== "online" || menuStep !== "playing" || roundPhase !== "countdown") return;

    const iv = setInterval(() => {
      const endAt = countdownEndsAtRef.current;
      if (!endAt) return;

      const remaining = Math.max(0, endAt - Date.now());
      if (remaining <= 0) {
        setCountdownValue(3);
        countdownRef.current = 3;
        setRoundPhase("fight");
        roundPhaseRef.current = "fight";
        roundEndsAtRef.current = Date.now() + ROUND_TIME_SECONDS * 1000;
        roundMsRemainingRef.current = ROUND_TIME_SECONDS * 1000;
        lastShownSecondRef.current = ROUND_TIME_SECONDS;
        setRoundTime(ROUND_TIME_SECONDS);
        clearInterval(iv);
        return;
      }

      const nextValue = remaining <= 1000 ? "GO" : remaining <= 2000 ? 1 : remaining <= 3000 ? 2 : 3;
      if (nextValue !== countdownValue) {
        setCountdownValue(nextValue);
        countdownRef.current = nextValue === "GO" ? 0 : nextValue;
      }
    }, 100);

    return () => clearInterval(iv);
  }, [mode, menuStep, roundPhase, countdownValue]);

  const randPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randStage = () => randPick(["default", "recursion", "sky", "hourglass", "bottom"]);
  const FIGHTER_COLORS = ["red", "blue", "green", "black", "white", "purple", "yellow", "orange"];
  const randColor = () => randPick(FIGHTER_COLORS);
  const fighterNote = (c) =>
    c === "red"
      ? "Fire & Dash"
      : c === "blue"
      ? "Ice Control"
      : c === "green"
      ? "Poison & Heal"
      : c === "black"
      ? "Void & Charge"
      : c === "white"
      ? "Low Light & Drop"
      : c === "purple"
      ? "Double Damage & Boost"
      : c === "yellow"
      ? "Spear & Reflect"
      : "Triple Fire & Slowdown";
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

    // Online match: construct humans from online-selected colors so the playing canvas initializes
    if (mode === "online") {
      // if p1/p2 colors are set from char-select or match:start, use them; otherwise pick defaults
      const c1 = p1Color || "red";
      const c2 = p2Color || "blue";
      return {
        ...base,
        humans: [
          { slot: "p1", team: 1, color: c1, username: onlinePlayerNames.p1 },
          { slot: "p2", team: 2, color: c2, username: onlinePlayerNames.p2 },
        ],
        ai: [],
        difficulty: null,
        stage: stage || "default",
      };
    }

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
      const isLast = idx === FIGHTER_COLORS.length - 1;

      const oppColor = isLast ? p1Color : ladderOppOrder[idx];
      const diffByStep = idx <= 0 ? "easy" : idx <= 3 ? "medium" : "hard";

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
  }, [mode, p1Color, p2Color, opp1Color, opp2Color, difficulty, stage, ladderIndex, ladderOppOrder, matched, onlinePlayerNames]);

  useEffect(() => {
    const handleUnlock = () => unlockAudio();
    window.addEventListener("pointerdown", handleUnlock, { once: true });
    window.addEventListener("keydown", handleUnlock, { once: true });
    window.addEventListener("touchstart", handleUnlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", handleUnlock);
      window.removeEventListener("keydown", handleUnlock);
      window.removeEventListener("touchstart", handleUnlock);
    };
  }, [menuStep, settingsOpen, gameConfig.stage, musicReady]);

  useEffect(() => {
    const nextMusic = menuStep === "playing" && !settingsOpen ? (gameConfig.stage || "default") : "menu";
    playMusic(nextMusic);

    return () => {
      if (currentMusicRef.current && currentMusicRef.current !== nextMusic) stopMusic();
    };
  }, [menuStep, settingsOpen, gameConfig.stage, musicReady]);

  useEffect(() => () => stopMusic(), []);

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

  const sendOnlineInputs = () => {
    const matchId = onlineMatchRef.current?.matchId;
    const socket = socketRef.current;
    if (!matchId || !socket) return;

    const binds = p1BindsRef.current || {};
    const actions = {};
    for (const action of Object.keys(ACTION_LABELS)) {
      const key = binds[action];
      actions[action] = !!keysPressed.current[key];
    }

    socket.emit('input:send', { matchId, inputs: actions });
  };

  const sendOnlineStateSnapshot = () => {
    const matchId = onlineMatchRef.current?.matchId;
    const socket = socketRef.current;
    const isHost = onlineMatchRef.current?.host === true || onlineMatchRef.current?.side === "left";
    if (!matchId || !socket || !isHost) return;

    onlineSyncSeqRef.current += 1;
    const state = serializeOnlineState();
    socket.emit('state:sync', { matchId, state });

    const now = Date.now();
    if (now - onlineLastStatePostAtRef.current >= 80) {
      onlineLastStatePostAtRef.current = now;
      fetch(`${apiBaseUrl}/api/match/state/${encodeURIComponent(matchId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }).catch(() => {});
    }
  };

  const clearOnlineSession = ({ disconnectSocket = false, keepLobby = true } = {}) => {
    if (forfeitIntervalRef.current) {
      clearInterval(forfeitIntervalRef.current);
      forfeitIntervalRef.current = null;
    }

    onlineMatchRef.current = null;
    onlineRemoteInputsRef.current = {};
      onlineIsHostRef.current = false;
    onlineSyncSeqRef.current = 0;
    onlineLastSyncSeqRef.current = 0;
    onlineSyncMatchIdRef.current = null;
    onlineLastStatePostAtRef.current = 0;
    onlineMatchEndSentRef.current = false;
    countdownEndsAtRef.current = null;
    roundEndsAtRef.current = null;
    setOnlinePlayerNames({ p1: "", p2: "" });
    setMatched(null);
    setCharSelect(null);
    setQueueing(false);
    setOpponentDisconnected(false);
    setForfeitRemaining(0);

    if (disconnectSocket && socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (keepLobby) {
      setMode("online");
      setMenuStep("idle");
    }
  };

  const serializeOnlineState = () => {
    const fighters = fightersRef.current || [];
    return {
      matchId: onlineMatchRef.current?.matchId || null,
      seq: onlineSyncSeqRef.current,
      roundPhase: roundPhaseRef.current,
      countdownValue: countdownRef.current === 0 ? "GO" : countdownRef.current,
      roundTime: lastShownSecondRef.current ?? roundTime,
      countdownEndsAt: countdownEndsAtRef.current,
      roundEndsAt: roundEndsAtRef.current,
      gameOver,
      team1Rounds,
      team2Rounds,
      roundWinnerText,
      matchWinnerText,
      fighters: fighters.map((p) => ({
        id: p.id,
        name: p.name,
        label: p.label,
        playerName: p.playerName,
        team: p.team,
        type: p.type,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        width: p.width,
        height: p.height,
        facing: p.facing,
        color: p.color,
        lightColor: p.lightColor,
        alive: p.alive,
        health: p.health,
        grounded: p.grounded,
        attacking: p.attacking,
        attackTimer: p.attackTimer,
        attackType: p.attackType,
        attackHeight: p.attackHeight,
        blocking: p.blocking,
        ducking: p.ducking,
        frozen: p.frozen,
        frozenTimer: p.frozenTimer,
        jumpDisabled: p.jumpDisabled,
        jumpDisabledTimer: p.jumpDisabledTimer,
        blockDisabled: p.blockDisabled,
        blockDisabledTimer: p.blockDisabledTimer,
        specialDisabled: p.specialDisabled,
        specialDisabledTimer: p.specialDisabledTimer,
        slowedTimer: p.slowedTimer,
        poisoned: p.poisoned,
        poisonTicksLeft: p.poisonTicksLeft,
        poisonTickTimer: p.poisonTickTimer,
        healing: p.healing,
        healTickTimer: p.healTickTimer,
        canProjectile: p.canProjectile,
        canSpecial2: p.canSpecial2,
        dashTimer: p.dashTimer,
        dashHasHit: p.dashHasHit,
        charging: p.charging,
        chargeFrames: p.chargeFrames,
        purpleCharging: p.purpleCharging,
        purpleChargeTimer: p.purpleChargeTimer,
        speedBoostTimer: p.speedBoostTimer,
        damageAmpTimer: p.damageAmpTimer,
        spearLocked: p.spearLocked,
        spearStunned: p.spearStunned,
        spearStunTimer: p.spearStunTimer,
        reflecting: p.reflecting,
        reflectTimer: p.reflectTimer,
        punchCooldown: p.punchCooldown,
        kickCooldown: p.kickCooldown,
        upperCooldown: p.upperCooldown,
        sweepCooldown: p.sweepCooldown,
        hitstun: p.hitstun,
        hitstunTimer: p.hitstunTimer,
        hitFlashTimer: p.hitFlashTimer,
        hitFlashColor: p.hitFlashColor,
        hitbox: p.hitbox,
        hurtbox: p.hurtbox,
      })),
      projectiles: (projectiles.current || []).map((proj) => ({
        x: proj.x,
        y: proj.y,
        vx: proj.vx,
        vy: proj.vy || 0,
        team: proj.team,
        type: proj.type,
        attackHeight: proj.attackHeight,
        color: proj.color,
        radius: proj.radius,
        knockbackDir: proj.knockbackDir,
      })),
    };
  };

  const applyOnlineState = (snapshot) => {
    if (!snapshot) return;

    const snapshotMatchId = snapshot.matchId || onlineMatchRef.current?.matchId || null;
    if (snapshotMatchId && onlineSyncMatchIdRef.current !== snapshotMatchId) {
      onlineSyncMatchIdRef.current = snapshotMatchId;
      onlineLastSyncSeqRef.current = 0;
    }

    const nextSeq = Number.isFinite(snapshot.seq) ? snapshot.seq : onlineLastSyncSeqRef.current + 1;
    if (nextSeq <= onlineLastSyncSeqRef.current) return;
    onlineLastSyncSeqRef.current = nextSeq;

    if (typeof snapshot.roundPhase !== "undefined") {
      roundPhaseRef.current = snapshot.roundPhase;
      setRoundPhase(snapshot.roundPhase);
    }
    if (typeof snapshot.countdownValue !== "undefined") setCountdownValue(snapshot.countdownValue);
    if (typeof snapshot.roundTime !== "undefined") setRoundTime(snapshot.roundTime);
    if (typeof snapshot.countdownEndsAt !== "undefined") countdownEndsAtRef.current = snapshot.countdownEndsAt;
    if (typeof snapshot.roundEndsAt !== "undefined") roundEndsAtRef.current = snapshot.roundEndsAt;
    if (typeof snapshot.gameOver !== "undefined") setGameOver(snapshot.gameOver);
    if (typeof snapshot.team1Rounds !== "undefined") setTeam1Rounds(snapshot.team1Rounds);
    if (typeof snapshot.team2Rounds !== "undefined") setTeam2Rounds(snapshot.team2Rounds);
    if (typeof snapshot.roundWinnerText !== "undefined") setRoundWinnerText(snapshot.roundWinnerText);
    if (typeof snapshot.matchWinnerText !== "undefined") setMatchWinnerText(snapshot.matchWinnerText);
    if (typeof snapshot.roundTime !== "undefined" && snapshot.roundTime != null) {
      lastShownSecondRef.current = snapshot.roundTime;
      roundMsRemainingRef.current = snapshot.roundTime * 1000;
    }
    if (typeof snapshot.countdownValue !== "undefined") {
      countdownRef.current = snapshot.countdownValue === "GO" ? 0 : snapshot.countdownValue;
    }

    const fighters = fightersRef.current || [];
    for (const data of snapshot.fighters || []) {
      const fighter = fighters.find((p) => p.id === data.id);
      if (!fighter) continue;
      Object.assign(fighter, data);
      fighter.hitbox = data.hitbox || fighter.hitbox || { x: 0, y: 0, width: 0, height: 0 };
      fighter.hurtbox = data.hurtbox || fighter.hurtbox || { x: 0, y: 0, width: 40, height: 60 };
    }

    projectiles.current = (snapshot.projectiles || []).map((proj) => ({
      ...proj,
      owner: null,
    }));
  };

  useEffect(() => {
    const match = onlineMatchRef.current;
    const isViewer = mode === "online" && menuStep === "playing" && match?.matchId && !match.host && match.side !== "left";
    if (!isViewer) return;

    let cancelled = false;

    const pollOnlineState = async () => {
      const activeMatch = onlineMatchRef.current;
      if (!activeMatch?.matchId || activeMatch.host || activeMatch.side === "left") return;

      try {
        const res = await fetch(`${apiBaseUrl}/api/match/state/${encodeURIComponent(activeMatch.matchId)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.state || data.matchId !== activeMatch.matchId) return;
        applyOnlineState({ ...data.state, matchId: data.matchId });
      } catch {}
    };

    pollOnlineState();
    const intervalId = window.setInterval(pollOnlineState, 80);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [mode, menuStep, apiBaseUrl]);

  const onlineLocalTeam = mode === "online" && onlineMatchRef.current?.matchId
    ? onlineMatchRef.current.side === "left"
      ? 1
      : 2
    : null;

  const sendLeaveForfeit = () => {
    const matchId = onlineMatchRef.current?.matchId;
    const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("rgb_token") : null);
    if (!matchId || !authToken) return;

    const payload = JSON.stringify({ token: authToken, matchId });
    const url = `${apiBaseUrl}/api/match/leave`;

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
        return;
      }
    } catch {}

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  };

  useEffect(() => {
    const handlePageExit = () => {
      if (!onlineMatchRef.current?.matchId) return;
      sendLeaveForfeit();
    };

    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);

    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
    };
  }, [token]);

  const goHome = () => {
    const hasActiveOnlineMatch = !!onlineMatchRef.current?.matchId || !!charSelect || !!matched;
    if (hasActiveOnlineMatch) {
      sendLeaveForfeit();
      clearOnlineSession({ disconnectSocket: true, keepLobby: false });
    } else if (queueing && socketRef.current) {
      socketRef.current.emit('queue:cancel');
      socketRef.current.disconnect();
      socketRef.current = null;
      setQueueing(false);
      setMatched(null);
    }

    playSfx("menu_back");
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
    playSfx("menu_select");
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

    const background3 = new Image();
    background3.src = background3Url;

    const background4 = new Image();
    background4.src = background4Url;

    const background5 = new Image();
    background5.src = background5Url;

    const WORLD_W = 900;
    const WORLD_H = 500;

    const GROUND = 380;
    const RECURSION_GROUND = 460;
    const SKY_GROUND = 405;
    const HOURGLASS_GROUND = 430;
    const BOTTOM_GROUND = 430;
    const GRAVITY = 1.2;
    const JUMP_DISTANCE = 120;

    const DARK_VARIANT = { red: "#b91c1c", blue: "#1d4ed8", green: "#15803d", black: "#4b5563", white: "#cbd5e1", purple: "#7e22ce", yellow: "#ca8a04", orange: "#c2410c" };

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
          case "white":
            return { hex: "#f8fafc", name: "White", type: "light" };
          case "purple":
            return { hex: "#a855f7", name: "Purple", type: "psychic" };
          case "yellow":
            return { hex: "#facc15", name: "Yellow", type: "electric" };
          case "orange":
            return { hex: "#f97316", name: "Orange", type: "explosion" };
          default:
            return { hex: "#ef4444", name: "Red", type: "fire" };
        }
      })();
      const hex = variant === "dark" ? DARK_VARIANT[color] || base.hex : base.hex;
      return { ...base, hex, light: toRGBA(hex, 0.75) };
    };

    const difficultySettings = {
  easy: {
    reactionTime: 34,
    blockChance: 0.35,
    projectileBlockChance: 0.4,
    specialChance: 0.35,
    aggression: 0.55,
    jumpChance: 0.18,
    mistakeChance: 0.35,
    spacing: 105,
    meleeRange: 82,
    projectileRange: 210,
    projectileReactRange: 210,
    healHealth: 55,
    healSafeDistance: 300,
    chargeMinFrames: 35,
    chargeMaxFrames: 85,
  },
  medium: {
    reactionTime: 18,
    blockChance: 0.62,
    projectileBlockChance: 0.65,
    specialChance: 0.62,
    aggression: 0.78,
    jumpChance: 0.35,
    mistakeChance: 0.16,
    spacing: 95,
    meleeRange: 88,
    projectileRange: 165,
    projectileReactRange: 270,
    healHealth: 70,
    healSafeDistance: 240,
    chargeMinFrames: 45,
    chargeMaxFrames: 105,
  },
  hard: {
    reactionTime: 8,
    blockChance: 0.86,
    projectileBlockChance: 0.9,
    specialChance: 0.88,
    aggression: 0.94,
    jumpChance: 0.55,
    mistakeChance: 0.05,
    spacing: 82,
    meleeRange: 96,
    projectileRange: 125,
    projectileReactRange: 340,
    healHealth: 82,
    healSafeDistance: 180,
    chargeMinFrames: 55,
    chargeMaxFrames: 130,
  },
};

const aiSettings = difficultySettings[gameConfig.difficulty || "easy"];

    const selectedStage = gameConfig.stage || "default";

    const groundLevel =
      selectedStage === "default"
        ? GROUND
        : selectedStage === "recursion"
        ? RECURSION_GROUND
        : selectedStage === "sky"
        ? SKY_GROUND
        : selectedStage === "hourglass"
        ? HOURGLASS_GROUND
        : BOTTOM_GROUND;

    const platforms =
      selectedStage === "default"
        ? [
            { x: 0, y: GROUND, width: WORLD_W, height: 20 },
            { x: 250, y: 280, width: 150, height: 20 },
            { x: 500, y: 280, width: 150, height: 20 },
          ]
        : selectedStage === "recursion"
        ? [
            { x: 0, y: RECURSION_GROUND, width: WORLD_W, height: 20 },
            { x: 225, y: RECURSION_GROUND - JUMP_DISTANCE, width: 450, height: 20 },
            { x: 337.5, y: RECURSION_GROUND - JUMP_DISTANCE * 2, width: 225, height: 20 },
            { x: 393.75, y: RECURSION_GROUND - JUMP_DISTANCE * 3, width: 112.5, height: 20 },
          ]
        : selectedStage === "sky"
        ? [
            { x: 0, y: SKY_GROUND, width: WORLD_W, height: 20 },
            { x: 35, y: 285, width: 220, height: 20 },
            { x: 615, y: 255, width: 250, height: 20 },
            { x: 335, y: 135, width: 230, height: 20 },
          ]
        : selectedStage === "hourglass"
        ? [
            { x: 0, y: HOURGLASS_GROUND, width: WORLD_W, height: 20 },
            { x: 70, y: 315, width: 230, height: 20 },
            { x: 600, y: 315, width: 230, height: 20 },
            { x: 360, y: 235, width: 180, height: 20 },
            { x: 115, y: 145, width: 190, height: 20 },
            { x: 595, y: 145, width: 190, height: 20 },
          ]
        : [
            { x: 0, y: BOTTOM_GROUND, width: WORLD_W, height: 20 },
            { x: 35, y: 350, width: 175, height: 20 },
            { x: 690, y: 350, width: 175, height: 20 },
            { x: 165, y: 260, width: 180, height: 20 },
            { x: 555, y: 260, width: 180, height: 20 },
            { x: 360, y: 145, width: 180, height: 20 },
          ];

    const makeFighter = (opts) => {
      const { id, team, isHuman, bindsRef, data, x, y, facing, dummy, label, playerName } = opts;
      return {
        id,
        team,
        label,
        playerName: playerName || "",
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
        slowedTimer: 0,
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
        purpleCharging: false,
        purpleChargeTimer: 0,
        speedBoostTimer: 0,
        damageAmpTimer: 0,
        spearLocked: false,
        spearStunned: false,
        spearStunTimer: 0,
        reflecting: false,
        reflectTimer: 0,
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
        aiPressureTimer: 0,
        aiPressureHits: 0,
        aiBlockHoldTimer: 0,
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
            playerName: h.username,
          })
        );

        if (o) {
          const isHuman2 = !!(gameConfig.humans[1] && gameConfig.humans[1].slot === "p2" && gameConfig.humans[1].team === 2);
          fighters.push(
            makeFighter({
              id: o.slot,
              team: 2,
              isHuman: isHuman2,
              bindsRef: isHuman2 && mode === "online" ? onlineOpponentBindsRef : isHuman2 ? p2BindsRef : null,
              data: p2Data,
              x: 700,
              y: groundLevel - 60,
              facing: -1,
              dummy: !!o.dummy,
              label: isHuman2 ? "P2" : gameConfig.practiceDummy ? "Dummy" : "AI",
              playerName: o.username,
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
    fightersRef.current = fighters;

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
          p.slowedTimer = 0;

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

          p.purpleCharging = false;
          p.purpleChargeTimer = 0;
          p.speedBoostTimer = 0;
          p.damageAmpTimer = 0;
          p.spearLocked = false;
          p.spearStunned = false;
          p.spearStunTimer = 0;
          p.reflecting = false;
          p.reflectTimer = 0;
          p.speed = 5;
          p.jumpPower = -22;

          p.vx = 0;
          p.vy = 0;
        }
      }

      resetPositions();
    };

    practiceRefreshRef.current = refreshPractice;

    const handleKeyDown = (e) => {
      if ((pausedRef.current && mode !== "online") || listeningForRef.current) return;

      const k = normalizeBindKey(e.key);
      if (!k) return;

      keysPressed.current[k] = true;
      if (mode === "online" && onlineMatchRef.current?.matchId && menuStep === "playing") {
        sendOnlineInputs();
      }
    };

    const handleKeyUp = (e) => {
      const k = normalizeBindKey(e.key);
      if (!k) return;

      keysPressed.current[k] = false;
      if (mode === "online" && onlineMatchRef.current?.matchId && menuStep === "playing") {
        sendOnlineInputs();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const breakFreezeIfNeeded = (def) => {
      if (def.frozen) {
        def.frozen = false;
        def.frozenTimer = 0;
      }
    };

    const breakSpearStunIfNeeded = (def) => {
      if (def.spearStunned) {
        def.spearStunned = false;
        def.spearStunTimer = 0;
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

      breakSpearStunIfNeeded(defender);
      breakFreezeIfNeeded(defender);

      let damage = 0;
      let knockback = 0;
      let launchUp = false;
      let hitstunFrames = 12;

      let freezeFrames = 0;
      let disableBlock = false;
      let disableSpecial = false;
      let specialDisableFrames = 420;
      let slowFrames = 0;
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
        case "purpleball":
          damage = 3;
          knockback = 15;
          hitstunFrames = 12;
          break;
        case "orangeball":
          damage = 4;
          knockback = 6;
          hitstunFrames = 10;
          break;
        case "orangeorb":
          damage = 5;
          knockback = 5;
          hitstunFrames = 14;
          slowFrames = 480;
          break;
        case "yellowspear":
          damage = 2;
          knockback = 0;
          hitstunFrames = 0;
          break;
        case "whiteball":
          damage = 5;
          knockback = 15;
          hitstunFrames = 12;
          break;
        case "whitedrop":
          damage = 7;
          knockback = 8;
          launchUp = true;
          hitstunFrames = 18;
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

      if (defender.damageAmpTimer > 0) {
        damage *= 2;
      }

      if (defender.healing) {
        defender.healing = false;
        hitstunFrames += 30;
      }

      if (defender.charging) {
        defender.charging = false;
        defender.chargeFrames = 0;
        hitstunFrames += 30;
      }

      if (defender.purpleCharging) {
        defender.purpleCharging = false;
        defender.purpleChargeTimer = 0;
        hitstunFrames += 30;
      }

      if (defender.reflecting) {
        defender.reflecting = false;
        defender.reflectTimer = 0;
      }

      if (defender.spearLocked) {
        defender.spearLocked = false;
      }

      const blocked = canBlockAttack(attacker, defender, attackType, extra.attackHeight ?? null);

      if (blocked) {
        damage = Math.floor(damage * 0.25);
        knockback = Math.floor(knockback * 0.3);
        hitstunFrames = 0;
        freezeFrames = 0;
        disableBlock = false;
        disableSpecial = false;
        slowFrames = 0;
        applyPoisonTicks = 0;
        applyJumpDisable = 0;
        playSfx("block");
      } else if (damage > 0) {
        playSfx("hit");
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
          defender.specialDisabledTimer = specialDisableFrames;
        }
        if (slowFrames > 0) {
          defender.slowedTimer = slowFrames;
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
        if (attackType === "purpleball") {
          defender.damageAmpTimer = 300;
        }
        if (attackType === "yellowspear") {
          defender.spearStunned = true;
          defender.spearStunTimer = 5;
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

  if (!defender.isHuman && !defender.dummy) {
    defender.aiPressureTimer = 100;
    defender.aiPressureHits = Math.min(5, (defender.aiPressureHits || 0) + 1);
    defender.aiBlockHoldTimer = Math.min(90, 25 + defender.aiPressureHits * 15);
  }
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

    const centerX = (p) => p.x + p.width / 2;
const centerY = (p) => p.y + p.height / 2;
const rand = () => Math.random();

const faceTarget = (ai, target) => {
  const dx = centerX(target) - centerX(ai);
  ai.facing = dx >= 0 ? 1 : -1;
  return dx;
};

const sameVerticalLane = (a, b, tolerance = 70) => {
  return Math.abs(centerY(a) - centerY(b)) <= tolerance;
};

const stopDefense = (ai) => {
  ai.blocking = false;
  ai.ducking = false;
};

  const beginMelee = (ai, attackType) => {
    if (ai.attacking || ai.hitstun || ai.frozen) return false;

    stopDefense(ai);
    ai.vx = 0;
    ai.healing = false;

    if (attackType === "punch" && ai.punchCooldown === 0) {
      ai.attacking = true;
      ai.attackType = "punch";
      ai.attackHeight = "mid";
      ai.attackTimer = 15;
      ai.punchCooldown = 20;
      playSfx("punch");
      return true;
    }

    if (attackType === "kick" && ai.kickCooldown === 0) {
      ai.attacking = true;
      ai.attackType = "kick";
      ai.attackHeight = "overhead";
      ai.attackTimer = 15;
      ai.kickCooldown = 40;
      playSfx("kick");
      return true;
    }

    if (attackType === "sweep" && ai.sweepCooldown === 0) {
      ai.attacking = true;
    ai.attackType = "sweep";
      ai.attackHeight = "low";
      ai.attackTimer = 15;
      ai.sweepCooldown = 50;
      ai.ducking = true;
      playSfx("sweep");
      return true;
    }

    if (attackType === "uppercut" && ai.upperCooldown === 0) {
      ai.attacking = true;
      ai.attackType = "uppercut";
      ai.attackHeight = "high";
      ai.attackTimer = 15;
      ai.upperCooldown = 60;
      playSfx("uppercut");
      return true;
    }

  return false;
};

const beginProjectile = (ai) => {
  if (!ai.canProjectile || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging) return false;

  const projX = ai.x + (ai.facing > 0 ? ai.width : 0);
  const projY = ai.y + 25;
  let cooldown = 2500;

    if (ai.type === "fire") {
      projectiles.current.push({
        x: projX,
        y: projY,
      vx: ai.facing * 8,
      owner: ai,
      team: ai.team,
      type: "fireball",
      attackHeight: "high",
      color: ai.color,
      radius: 8,
      });
      cooldown = 900;
      playSfx("fireball");
    } else if (ai.type === "psychic") {
      projectiles.current.push({
        x: projX,
        y: projY,
      vx: ai.facing * 8,
      owner: ai,
      team: ai.team,
      type: "purpleball",
      attackHeight: "high",
      color: "#a855f7",
      radius: 8,
      });
      cooldown = 1800;
      playSfx("purple_damage");
    } else if (ai.type === "electric") {
      ai.spearLocked = true;
      projectiles.current.push({
        x: projX,
      y: projY,
      vx: ai.facing * 20,
      owner: ai,
      team: ai.team,
      type: "yellowspear",
      attackHeight: "mid",
      color: "#facc15",
        radius: 7,
      });
      cooldown = 5000;
      playSfx("yellow_spear");
    } else if (ai.type === "explosion") {
      [-32, 0, 32].forEach((offset) => {
        projectiles.current.push({
        x: projX + ai.facing * (offset + 18),
        y: projY,
        vx: ai.facing * 8,
        owner: ai,
        team: ai.team,
        type: "orangeball",
        attackHeight: "high",
        color: "#f97316",
        radius: 8,
        });
      });
      cooldown = 5000;
      playSfx("orange_triple");
    } else if (ai.type === "ice") {
      projectiles.current.push({
        x: projX,
      y: projY,
      vx: ai.facing * 7,
      owner: ai,
      team: ai.team,
      type: "iceball",
      attackHeight: "high",
      color: "#60a5fa",
        radius: 8,
      });
      cooldown = 4200;
      playSfx("iceball");
    } else if (ai.type === "poison") {
      projectiles.current.push({
        x: projX,
      y: projY,
      vx: ai.facing * 12,
      owner: ai,
      team: ai.team,
      type: "poisonorb",
      attackHeight: "mid",
      color: "#4ade80",
        radius: 10,
      });
      cooldown = 2200;
      playSfx("poisonball");
    } else if (ai.type === "light") {
      projectiles.current.push({
        x: projX,
      y: ai.y + 48,
      vx: ai.facing * 8,
      vy: 0,
      owner: ai,
      team: ai.team,
      type: "whiteball",
      attackHeight: "low",
      color: "#f8fafc",
        radius: 8,
      });
      cooldown = 900;
      playSfx("white_low");
    } else {
      projectiles.current.push({
        x: projX,
      y: projY,
      vx: ai.facing * 10,
      owner: ai,
      team: ai.team,
      type: "blackball",
      attackHeight: "mid",
      color: ai.color,
        radius: 8,
      });
      cooldown = 2200;
      playSfx("voidball");
    }

  ai.canProjectile = false;
  setManagedTimeout(() => {
    ai.canProjectile = true;
  }, cooldown);

  return true;
};

const beginRedDash = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging) return false;

  stopDefense(ai);
  ai.attacking = true;
  ai.attackType = "dash";
  ai.attackHeight = "mid";
  ai.attackTimer = 25;
  ai.dashTimer = 25;
  ai.dashHasHit = false;
  playSfx("dash");

  ai.canSpecial2 = false;
  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 1800);

  return true;
};

const beginIceSlowOrb = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging) return false;

  projectiles.current.push({
    x: ai.x + (ai.facing > 0 ? ai.width : 0),
    y: ai.y + 25,
    vx: ai.facing * 2.2,
    owner: ai,
    team: ai.team,
    type: "sloworb",
    attackHeight: "mid",
    color: "#93c5fd",
    radius: 12,
  });
  playSfx("sloworb");

  ai.canSpecial2 = false;
  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 9000);

  return true;
};

const beginWhiteDrop = (ai, target) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || !target) return false;

  const dropX = target.x + target.width / 2;
  const knockbackDir = dropX >= centerX(ai) ? 1 : -1;

  projectiles.current.push({
    x: dropX,
    y: -40,
    vx: 0,
    vy: 13,
    owner: ai,
    team: ai.team,
    type: "whitedrop",
    attackHeight: "overhead",
    color: "#f8fafc",
    radius: 12,
    knockbackDir,
  });
  playSfx("white_drop");

  ai.canSpecial2 = false;
  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 4500);

  return true;
};

const beginPurplePowerUp = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.speedBoostTimer > 0) return false;

  stopDefense(ai);
  ai.vx = 0;
  ai.attacking = false;
  ai.attackTimer = 0;
  ai.attackType = "";
  ai.attackHeight = "";
  ai.purpleCharging = true;
  ai.purpleChargeTimer = 0;
  ai.canSpecial2 = false;

  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 13000);

  return true;
};

const beginYellowReflect = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging) return false;

  stopDefense(ai);
  ai.vx = 0;
  ai.reflecting = true;
  ai.reflectTimer = 60;
  ai.canSpecial2 = false;
  playSfx("reflect");

  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 3000);

  return true;
};

const beginOrangeOrb = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging) return false;

  projectiles.current.push({
    x: ai.x + (ai.facing > 0 ? ai.width : 0),
    y: ai.y + 25,
    vx: ai.facing * 2.2,
    owner: ai,
    team: ai.team,
    type: "orangeorb",
    attackHeight: "mid",
    color: "#fb923c",
    radius: 12,
  });
  playSfx("orange_orb");

  ai.canSpecial2 = false;
  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 9000);

  return true;
};

const beginPoisonHeal = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.health >= 100) return false;

  stopDefense(ai);
  ai.vx = 0;
  ai.attacking = false;
  ai.attackTimer = 0;
  ai.attackType = "";
  ai.attackHeight = "";
  ai.healing = true;
  ai.healTickTimer = ai.healTickTimer || 40;
  playSfx("heal");

  ai.canSpecial2 = false;
  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 3500);

  return true;
};

const beginVoidCharge = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging) return false;

  stopDefense(ai);
  ai.charging = true;
  ai.chargeFrames = 0;
  ai.vx = 0;
  playSfx("charge_start");

  ai.canSpecial2 = false;
  return true;
};

const releaseVoidCharge = (ai) => {
  if (!ai.charging) return false;

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
  playSfx("chargeball");

  ai.charging = false;
  ai.chargeFrames = 0;

  setManagedTimeout(() => {
    ai.canSpecial2 = true;
  }, 3200);

  return true;
};

const getIncomingProjectile = (ai) => {
  const aiCenter = centerX(ai);

  return projectiles.current.find((proj) => {
    if (proj.team === ai.team) return false;

    const xDist = Math.abs(proj.x - aiCenter);
    const yDist = Math.abs(proj.y - centerY(ai));

    const horizontalThreat =
      ((proj.vx > 0 && proj.x < aiCenter) ||
        (proj.vx < 0 && proj.x > aiCenter)) &&
      xDist < aiSettings.projectileReactRange &&
      yDist < 70;

    const verticalThreat =
      (proj.vy || 0) > 0 &&
      proj.y < centerY(ai) &&
      xDist < 55 &&
      yDist < aiSettings.projectileReactRange;

    return horizontalThreat || verticalThreat;
  });
};

const smartBlock = (ai, attackHeight = "mid") => {
  if (ai.blockDisabled) return false;

  ai.vx = 0;
  ai.blocking = true;

  if (attackHeight === "low") {
    ai.ducking = true;
  } else {
    ai.ducking = false;
  }

  return true;
};

const moveToward = (ai, target, speedMult = 1) => {
  const dx = faceTarget(ai, target);
  ai.vx = dx > 0 ? ai.speed * speedMult : -ai.speed * speedMult;
};

const moveAway = (ai, target, speedMult = 1) => {
  const dx = faceTarget(ai, target);
  ai.vx = dx > 0 ? -ai.speed * speedMult : ai.speed * speedMult;
};

const chooseCloseAttack = (ai, opp) => {
  if (opp.frozen || opp.hitstun) {
    return beginMelee(ai, "uppercut") || beginMelee(ai, "kick") || beginMelee(ai, "punch");
  }

  if (opp.ducking || opp.blocking) {
    if (rand() < 0.55) return beginMelee(ai, "kick");
    return beginMelee(ai, "sweep");
  }

  if (!opp.grounded) {
    return beginMelee(ai, "uppercut") || beginMelee(ai, "kick");
  }

  const r = rand();

  if (r < 0.28) return beginMelee(ai, "sweep");
  if (r < 0.56) return beginMelee(ai, "kick");
  if (r < 0.78) return beginMelee(ai, "punch");
  return beginMelee(ai, "uppercut");
};

const getPlatformFighterIsOn = (p) => {
  return platforms.find((plat) => {
    const feetY = p.y + p.height;
    return (
      p.x + p.width > plat.x &&
      p.x < plat.x + plat.width &&
      Math.abs(feetY - plat.y) < 8
    );
  });
};

const tryJumpToPlatform = (ai, opp) => {
  if (!ai.grounded || ai.jumpDisabled) return false;

  const aiFeet = ai.y + ai.height;
  const oppAbove = centerY(opp) < centerY(ai) - 65;

  if (!oppAbove) return false;

  const reachablePlatforms = platforms
    .filter((plat) => {
      const platformAbove = plat.y < aiFeet - 25;
      const notTooHigh = aiFeet - plat.y <= 150;
      const horizontallyReachable =
        centerX(ai) > plat.x - 110 &&
        centerX(ai) < plat.x + plat.width + 110;

      return platformAbove && notTooHigh && horizontallyReachable;
    })
    .sort(
      (a, b) =>
        Math.abs(centerX(opp) - (a.x + a.width / 2)) -
        Math.abs(centerX(opp) - (b.x + b.width / 2))
    );

  const targetPlatform = reachablePlatforms[0];
  if (!targetPlatform) return false;

  const targetX = Math.max(
    targetPlatform.x + 20,
    Math.min(targetPlatform.x + targetPlatform.width - 20, centerX(opp))
  );

  ai.vy = ai.jumpPower;
  ai.grounded = false;
  ai.vx = targetX > centerX(ai) ? ai.speed * 1.15 : -ai.speed * 1.15;

  return true;
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

  const opp = getNearestEnemy(ai);
  if (!opp) return;

  const dx = faceTarget(ai, opp);
  const abs = Math.abs(dx);
  const sameLane = sameVerticalLane(ai, opp);

  const targetVulnerable =
    opp.frozen ||
    opp.hitstun ||
    opp.spearStunned ||
    opp.blockDisabled ||
    opp.jumpDisabled ||
    !opp.grounded;

  const aiCornered =
    ai.x < 55 ||
    ai.x + ai.width > WORLD_W - 55;

  if (ai.spearLocked || ai.reflecting || ai.purpleCharging) {
    stopDefense(ai);
    ai.vx = 0;
    return;
  }

  if (ai.dashTimer > 0) {
    stopDefense(ai);
    ai.vx = ai.facing * 18;
    ai.dashTimer--;
    return;
  }

  if (ai.frozen || ai.hitstun || ai.spearStunned) {
    ai.healing = false;
    ai.charging = false;
    ai.chargeFrames = 0;
    ai.purpleCharging = false;
    ai.purpleChargeTimer = 0;
    ai.reflecting = false;
    ai.reflectTimer = 0;
    ai.spearLocked = false;
    if (ai.frozen || ai.spearStunned) ai.vx = 0;
    return;
  }

  if (ai.charging && ai.type === "void") {
    stopDefense(ai);
    faceTarget(ai, opp);

    const shouldRelease =
      ai.chargeFrames >= aiSettings.chargeMinFrames &&
      sameLane &&
      abs < 560 &&
      (targetVulnerable || abs < 260 || opp.blocking);

    const mustRelease =
      ai.chargeFrames >= aiSettings.chargeMaxFrames ||
      abs < 115;

    if (shouldRelease || mustRelease) {
      releaseVoidCharge(ai);
      return;
    }

    if (abs < 170) moveAway(ai, opp, 0.65);
    else if (abs > 390) moveToward(ai, opp, 0.45);
    else ai.vx = 0;

    return;
  }

  if (ai.healing) {
    const safeToKeepHealing =
      ai.health < 100 &&
      abs > aiSettings.healSafeDistance &&
      !getIncomingProjectile(ai);

    if (!safeToKeepHealing) {
      ai.healing = false;
      return;
    }

    stopDefense(ai);
    ai.vx = 0;
    return;
  }

  if (ai.attacking) {
    ai.blocking = false;
    return;
  }

  stopDefense(ai);

  const incoming = getIncomingProjectile(ai);
  if (incoming && ai.type === "electric" && ai.canSpecial2 && !ai.specialDisabled && rand() < aiSettings.projectileBlockChance + 0.2) {
    if (beginYellowReflect(ai)) return;
  }

  if (ai.aiBlockHoldTimer > 0 && !ai.blockDisabled) {
  const pressureAttackHeight =
    incoming?.attackHeight ||
    opp.attackHeight ||
    (opp.ducking ? "low" : "mid");

  if (incoming || abs < 145 || opp.attacking) {
    smartBlock(ai, pressureAttackHeight === "low" ? "low" : "mid");
    return;
  }
}
  if (incoming && rand() < aiSettings.projectileBlockChance) {
    if (incoming.type === "poisonorb") {
      if (ai.grounded && !ai.jumpDisabled && rand() < aiSettings.jumpChance) {
        ai.vy = ai.jumpPower;
        ai.grounded = false;
      }
      moveAway(ai, opp, 1.15);
      return;
    }

    smartBlock(ai, incoming.attackHeight || "mid");
    return;
  }

  if (opp.attacking && abs < 135 && rand() < aiSettings.blockChance) {
  const h = opp.attackHeight || "mid";
  smartBlock(ai, h === "low" ? "low" : "mid");
  return;
}

if (opp.ducking && abs < 115 && rand() < aiSettings.blockChance * 0.75) {
  smartBlock(ai, "low");
  return;
}

  ai.aiTimer++;
  if (ai.aiTimer < aiSettings.reactionTime) {
    if (abs > aiSettings.spacing + 40) moveToward(ai, opp, 0.75);
    else if (abs < 55) moveAway(ai, opp, 0.65);
    else ai.vx *= 0.75;

    return;
  }
  ai.aiTimer = 0;

  if (rand() < aiSettings.mistakeChance) {
    if (abs > aiSettings.spacing) moveToward(ai, opp, 0.7);
    else if (abs < 70) moveAway(ai, opp, 0.55);
    else ai.vx = 0;
    return;
  }

  if (opp.frozen) {
    if (abs > 72) {
      moveToward(ai, opp, 1.2);
      return;
    }

    chooseCloseAttack(ai, opp);
    return;
  }

  if (
  centerY(opp) < centerY(ai) - 65 &&
  abs < 280 &&
  rand() < aiSettings.jumpChance + 0.3
) {
  if (tryJumpToPlatform(ai, opp)) return;
}

  if (
    ai.type === "psychic" &&
    ai.canSpecial2 &&
    !ai.specialDisabled &&
    ai.speedBoostTimer <= 0 &&
    abs > 160 &&
    !incoming &&
    rand() < aiSettings.specialChance
  ) {
    if (beginPurplePowerUp(ai)) return;
  }

  if (
    ai.type === "psychic" &&
    ai.canProjectile &&
    !ai.specialDisabled &&
    sameLane &&
    abs > 120 &&
    abs < 440 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || opp.damageAmpTimer <= 0 || abs > 220)
  ) {
    if (beginProjectile(ai)) return;
  }

  if (
    ai.type === "electric" &&
    ai.canProjectile &&
    !ai.specialDisabled &&
    sameLane &&
    abs > 140 &&
    abs < 520 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || !opp.grounded || abs > 230)
  ) {
    if (beginProjectile(ai)) return;
  }

  if (
    ai.type === "explosion" &&
    ai.canSpecial2 &&
    !ai.specialDisabled &&
    sameLane &&
    abs > 100 &&
    abs < 430 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || opp.specialDisabled === false || abs > 190)
  ) {
    if (beginOrangeOrb(ai)) return;
  }

  if (
    ai.type === "explosion" &&
    ai.canProjectile &&
    !ai.specialDisabled &&
    sameLane &&
    abs > 115 &&
    abs < 430 &&
    rand() < aiSettings.specialChance
  ) {
    if (beginProjectile(ai)) return;
  }

  if (
    ai.type === "light" &&
    ai.canSpecial2 &&
    !ai.specialDisabled &&
    abs < 560 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || opp.blocking || abs < 250 || !opp.grounded)
  ) {
    if (beginWhiteDrop(ai, opp)) return;
  }

  if (
    ai.type === "light" &&
    ai.canProjectile &&
    !ai.specialDisabled &&
    sameLane &&
    abs > 90 &&
    abs < 430 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || (opp.blocking && !opp.ducking) || abs > 190)
  ) {
    if (beginProjectile(ai)) return;
  }

  if (
    ai.type === "poison" &&
    ai.health <= aiSettings.healHealth &&
    abs > aiSettings.healSafeDistance &&
    !incoming &&
    rand() < aiSettings.specialChance
  ) {
    if (beginPoisonHeal(ai)) return;
  }

  if (
    ai.type === "void" &&
    ai.canSpecial2 &&
    !ai.specialDisabled &&
    sameLane &&
    abs > 145 &&
    abs < 520 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || opp.blocking || abs > 260)
  ) {
    if (beginVoidCharge(ai)) return;
  }

  if (
    ai.type === "ice" &&
    ai.canSpecial2 &&
    !ai.specialDisabled &&
    sameLane &&
    abs > 100 &&
    abs < 430 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || opp.blocking || abs > 190)
  ) {
    if (beginIceSlowOrb(ai)) return;
  }

  if (
    ai.type === "fire" &&
    ai.canSpecial2 &&
    !ai.specialDisabled &&
    abs > 95 &&
    abs < 310 &&
    rand() < aiSettings.specialChance &&
    (targetVulnerable || aiCornered || abs > 180)
  ) {
    if (beginRedDash(ai)) return;
  }

  if (
    (ai.type === "void" || ai.type === "ice") &&
    (opp.blockDisabled || opp.jumpDisabled) &&
    abs > 70 &&
    abs < 290
  ) {
    moveToward(ai, opp, 1.25);
    if (abs < aiSettings.meleeRange) chooseCloseAttack(ai, opp);
    return;
  }

  if (
    ai.canProjectile &&
    !ai.specialDisabled &&
    sameLane &&
    abs > aiSettings.projectileRange &&
    rand() < aiSettings.specialChance
  ) {
    if (beginProjectile(ai)) return;
  }

  if (abs <= aiSettings.meleeRange) {
    chooseCloseAttack(ai, opp);
    return;
  }

  if (!opp.grounded && abs < 115) {
    if (beginMelee(ai, "uppercut")) return;
  }

  if (
    ai.grounded &&
    !ai.jumpDisabled &&
    abs > 115 &&
    abs < 260 &&
    rand() < aiSettings.jumpChance
  ) {
    ai.vy = ai.jumpPower;
    ai.grounded = false;
    moveToward(ai, opp, 0.85);
    return;
  }

  if (abs > aiSettings.spacing) {
    moveToward(ai, opp, aiSettings.aggression);
  } else if (abs < 58) {
    moveAway(ai, opp, 0.85);
  } else {
    ai.vx *= 0.72;

    if (rand() < aiSettings.blockChance * 0.18) {
      smartBlock(ai, "mid");
    }
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
        p.slowedTimer = 0;

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
        p.purpleCharging = false;
        p.purpleChargeTimer = 0;
        p.speedBoostTimer = 0;
        p.damageAmpTimer = 0;
        p.spearLocked = false;
        p.spearStunned = false;
        p.spearStunTimer = 0;
        p.reflecting = false;
        p.reflectTimer = 0;
        p.speed = 5;
        p.jumpPower = -22;
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
        p.slowedTimer = 0;

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
        p.purpleCharging = false;
        p.purpleChargeTimer = 0;
        p.speedBoostTimer = 0;
        p.damageAmpTimer = 0;
        p.spearLocked = false;
        p.spearStunned = false;
        p.spearStunTimer = 0;
        p.reflecting = false;
        p.reflectTimer = 0;
        p.speed = 5;
        p.jumpPower = -22;
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
      if (pausedRef.current && mode !== "online") return;
      if (roundPhaseRef.current !== "fight") return;
      if (p.dummy) return;
      if (p.frozen || p.hitstun || p.spearStunned) return;

      const binds = p.bindsRef?.current;
      const isOnline = mode === "online" && onlineLocalTeam != null;
      const isOnlineRemote = isOnline && p.team !== onlineLocalTeam;
      const actionBinds = isOnline
        ? isOnlineRemote
          ? (p.bindsRef?.current || onlineOpponentBindsRef.current)
          : (p1BindsRef.current || binds || {})
        : (binds || {});
      if (!actionBinds) return;
      const getHeld = (action) => {
        if (isOnlineRemote) return !!onlineRemoteInputsRef.current[action];
        return !!(actionBinds[action] && keysPressed.current[actionBinds[action]]);
      };
      const clearHeld = (action) => {
        if (isOnlineRemote) {
          onlineRemoteInputsRef.current[action] = false;
        } else if (actionBinds[action]) {
          keysPressed.current[actionBinds[action]] = false;
        }
      };

      if (p.spearLocked || p.reflecting || p.purpleCharging) {
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        return;
      }

      if (p.type === "poison" && actionBinds.special2) {
        const wantsHeal = getHeld("special2") && !p.specialDisabled && !p.frozen && p.health < 100;
        if (wantsHeal && !p.healing) playSfx("heal");
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

        if (getHeld("moveLeft")) {
          p.vx = -p.speed;
          p.facing = -1;
        }
        if (getHeld("moveRight")) {
          p.vx = p.speed;
          p.facing = 1;
        }

        if (getHeld("jump") && !p.jumpDisabled && p.grounded) {
          p.vy = p.jumpPower;
          p.grounded = false;
        }

        if (getHeld("duck")) p.ducking = true;

        p.blocking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        p.dashTimer = 0;
      } else {
        p.blocking = !p.blockDisabled && getHeld("block");

        if (p.blocking) {
          p.vx = 0;
          p.ducking = getHeld("duck");
          p.attacking = false;
          p.attackTimer = 0;
          p.attackType = "";
          p.attackHeight = "";
          return;
        }

        p.vx = 0;
        p.ducking = false;

        if (getHeld("moveLeft")) {
          p.vx = -p.speed;
          p.facing = -1;
        }
        if (getHeld("moveRight")) {
          p.vx = p.speed;
          p.facing = 1;
        }

        if (getHeld("jump") && !p.jumpDisabled && p.grounded) {
          p.vy = p.jumpPower;
          p.grounded = false;
        }

        if (getHeld("duck")) p.ducking = true;

        if (getHeld("punch") && !p.attacking) {
          if (p.ducking && p.upperCooldown === 0) {
            p.attacking = true;
            p.attackType = "uppercut";
            p.attackHeight = "high";
            p.attackTimer = 15;
            p.upperCooldown = 60;
            playSfx("uppercut");
            clearHeld("punch");
          } else if (!p.ducking && p.punchCooldown === 0) {
            p.attacking = true;
            p.attackType = "punch";
            p.attackHeight = "mid";
            p.attackTimer = 15;
            p.punchCooldown = 20;
            playSfx("punch");
            clearHeld("punch");
          }
        }

        if (getHeld("kick") && !p.attacking) {
          if (p.ducking && p.sweepCooldown === 0) {
            p.attacking = true;
            p.attackType = "sweep";
            p.attackHeight = "low";
            p.attackTimer = 15;
            p.sweepCooldown = 50;
            playSfx("sweep");
            clearHeld("kick");
          } else if (!p.ducking && p.kickCooldown === 0) {
            p.attacking = true;
            p.attackType = "kick";
            p.attackHeight = "overhead";
            p.attackTimer = 15;
            p.kickCooldown = 40;
            playSfx("kick");
            clearHeld("kick");
          }
        }

        if (p.dashTimer > 0) {
          p.vx = p.facing * 18;
          p.dashTimer--;
        }

        if (getHeld("special1") && p.canProjectile && !p.specialDisabled) {
          const projX = p.x + (p.facing > 0 ? p.width : 0);
          const projY = p.y + 25;
          let cooldown = 2500;

          if (p.type === "fire") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 8, owner: p, team: p.team, type: "fireball", attackHeight: "high", color: p.color, radius: 8 });
            playSfx("fireball");
            cooldown = 500;
          } else if (p.type === "psychic") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 8, owner: p, team: p.team, type: "purpleball", attackHeight: "high", color: "#a855f7", radius: 8 });
            playSfx("purple_damage");
            cooldown = 1000;
          } else if (p.type === "electric") {
            p.spearLocked = true;
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 20, owner: p, team: p.team, type: "yellowspear", attackHeight: "mid", color: "#facc15", radius: 7 });
            playSfx("yellow_spear");
            cooldown = 5000;
          } else if (p.type === "explosion") {
            [-32, 0, 32].forEach((offset) => {
              projectiles.current.push({ x: projX + p.facing * (offset + 18), y: projY, vx: p.facing * 8, owner: p, team: p.team, type: "orangeball", attackHeight: "high", color: "#f97316", radius: 8 });
            });
            playSfx("orange_triple");
            cooldown = 5000;
          } else if (p.type === "ice") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 7, owner: p, team: p.team, type: "iceball", attackHeight: "high", color: "#60a5fa", radius: 8 });
            playSfx("iceball");
            cooldown = 5000;
          } else if (p.type === "poison") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 12, owner: p, team: p.team, type: "poisonorb", attackHeight: "mid", color: "#4ade80", radius: 10 });
            playSfx("poisonball");
            cooldown = 2500;
          } else if (p.type === "light") {
            projectiles.current.push({ x: projX, y: p.y + 48, vx: p.facing * 8, vy: 0, owner: p, team: p.team, type: "whiteball", attackHeight: "low", color: "#f8fafc", radius: 8 });
            playSfx("white_low");
            cooldown = 500;
          } else {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 10, owner: p, team: p.team, type: "blackball", attackHeight: "mid", color: p.color, radius: 8 });
            playSfx("voidball");
            cooldown = 2500;
          }

          p.canProjectile = false;
          setManagedTimeout(() => (p.canProjectile = true), cooldown);
          clearHeld("special1");
        }

        if (getHeld("special2") && !p.specialDisabled) {
          if (p.canSpecial2) {
            if (p.type === "fire") {
              p.attacking = true;
              p.attackType = "dash";
              p.attackHeight = "mid";
              p.attackTimer = 25;
              p.dashTimer = 25;
              p.dashHasHit = false;
              playSfx("dash");
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), 2000);
              clearHeld("special2");
            } else if (p.type === "ice") {
              projectiles.current.push({ x: p.x + (p.facing > 0 ? p.width : 0), y: p.y + 25, vx: p.facing * 2.2, owner: p, team: p.team, type: "sloworb", attackHeight: "mid", color: "#93c5fd", radius: 12 });
              playSfx("sloworb");
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), 10000);
              clearHeld("special2");
            } else if (p.type === "psychic") {
              p.vx = 0;
              p.blocking = false;
              p.ducking = false;
              p.attacking = false;
              p.attackTimer = 0;
              p.attackType = "";
              p.attackHeight = "";
              p.purpleCharging = true;
              p.purpleChargeTimer = 0;
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), 13000);
              clearHeld("special2");
            } else if (p.type === "electric") {
              p.vx = 0;
              p.blocking = false;
              p.ducking = false;
              p.reflecting = true;
              p.reflectTimer = 60;
              playSfx("reflect");
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), 3000);
              clearHeld("special2");
            } else if (p.type === "explosion") {
              projectiles.current.push({ x: p.x + (p.facing > 0 ? p.width : 0), y: p.y + 25, vx: p.facing * 2.2, owner: p, team: p.team, type: "orangeorb", attackHeight: "mid", color: "#fb923c", radius: 12 });
              playSfx("orange_orb");
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), 10000);
              clearHeld("special2");
            } else if (p.type === "light") {
              const target = getNearestEnemy(p);
              if (target) {
                const dropX = target.x + target.width / 2;
                const knockbackDir = dropX >= p.x + p.width / 2 ? 1 : -1;
                projectiles.current.push({ x: dropX, y: -40, vx: 0, vy: 13, owner: p, team: p.team, type: "whitedrop", attackHeight: "overhead", color: "#f8fafc", radius: 12, knockbackDir });
                playSfx("white_drop");
                p.canSpecial2 = false;
                setManagedTimeout(() => (p.canSpecial2 = true), 4500);
                clearHeld("special2");
              }
            } else if (p.type === "void") {
              if (!p.charging) {
                p.charging = true;
                p.chargeFrames = 0;
                playSfx("charge_start");
              }
            }
          }
        }

        if (p.type === "void" && p.charging && !getHeld("special2")) {
          const chargeDamage = 8 + Math.floor(p.chargeFrames / 15);
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
          playSfx("chargeball");
          p.charging = false;
          p.chargeFrames = 0;
          p.canSpecial2 = false;
          setManagedTimeout(() => (p.canSpecial2 = true), 3000);
        }

        return;
      }

      if (p.type === "void" && p.charging && !getHeld("special2")) {
        const chargeDamage = 8 + Math.floor(p.chargeFrames / 15);
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
        playSfx("chargeball");
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

      if (p.purpleCharging) {
        p.purpleChargeTimer++;
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.purpleChargeTimer >= 60) {
          p.purpleCharging = false;
          p.purpleChargeTimer = 0;
          p.speedBoostTimer = 480;
          playSfx("purple_boost");
        }
      }

      if (p.speedBoostTimer > 0) {
        p.speedBoostTimer--;
        p.speed = 6;
        p.jumpPower = -26.4;
      } else {
        p.speed = 5;
        p.jumpPower = -22;
      }

      if (p.slowedTimer > 0) {
        p.slowedTimer--;
        p.speed *= 0.75;
        p.jumpPower *= 0.75;
      }

      if (p.damageAmpTimer > 0) p.damageAmpTimer--;

      if (p.spearStunned) {
        p.spearStunTimer--;
        p.vx = 0;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.spearStunTimer <= 0) {
          p.spearStunned = false;
          p.spearStunTimer = 0;
        }
      }

      if (p.reflecting) {
        p.reflectTimer--;
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.reflectTimer <= 0) {
          p.reflecting = false;
          p.reflectTimer = 0;
        }
      }

      if (p.spearLocked) {
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
      }

      if (p.hitFlashTimer > 0) p.hitFlashTimer--;

      if (p.aiPressureTimer > 0) {
  p.aiPressureTimer--;
} else {
  p.aiPressureHits = 0;
}

if (p.aiBlockHoldTimer > 0) {
  p.aiBlockHoldTimer--;
}

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

  const bg =
    selectedStage === "recursion"
      ? background2
      : selectedStage === "sky"
      ? background3
      : selectedStage === "hourglass"
      ? background4
      : selectedStage === "bottom"
      ? background5
      : background1;

  if (bg.complete && bg.naturalWidth > 0) {
    ctx.drawImage(bg, 0, 0, WORLD_W, WORLD_H);
  }
};

    const drawProjectile = (proj) => {
      ctx.save();

      if (proj.type === "yellowspear") {
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(proj.x - Math.sign(proj.vx || 1) * 18, proj.y);
        ctx.lineTo(proj.x + Math.sign(proj.vx || 1) * 18, proj.y);
        ctx.stroke();

        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(proj.x - Math.sign(proj.vx || 1) * 18, proj.y);
        ctx.lineTo(proj.x + Math.sign(proj.vx || 1) * 18, proj.y);
        ctx.stroke();
        ctx.restore();
        return;
      }

      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle =
        proj.type === "whiteball" ||
        proj.type === "whitedrop" ||
        proj.type === "purpleball" ||
        proj.type === "orangeball" ||
        proj.type === "orangeorb"
          ? "#000000"
          : "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth =
        proj.type === "whiteball" ||
        proj.type === "whitedrop" ||
        proj.type === "purpleball" ||
        proj.type === "orangeball" ||
        proj.type === "orangeorb"
          ? 3
          : 2;
      ctx.stroke();

      ctx.restore();
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

      if (p.damageAmpTimer > 0) {
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = "#c084fc";
        ctx.fillRect(p.x - 7, drawY - 7, p.width + 14, drawHeight + 14);
        ctx.globalAlpha = 1;
      }

      if (p.spearStunned) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#facc15";
        ctx.fillRect(p.x - 7, drawY - 7, p.width + 14, drawHeight + 14);
        ctx.globalAlpha = 1;
      }

      if (p.purpleCharging) {
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = "#a855f7";
        const chargeSize = Math.min(p.purpleChargeTimer / 3, 20);
        ctx.fillRect(p.x - chargeSize / 2, drawY - chargeSize / 2, p.width + chargeSize, drawHeight + chargeSize);
        ctx.globalAlpha = 1;
      }

      if (p.speedBoostTimer > 0) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#e879f9";
        ctx.fillRect(p.x - 10, drawY - 10, p.width + 20, drawHeight + 20);
        ctx.globalAlpha = 1;
      }

      if (p.reflecting) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#facc15";
        const shieldX = p.facing > 0 ? p.x + p.width + 4 : p.x - 14;
        ctx.fillRect(shieldX, drawY + 4, 10, drawHeight - 8);
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

        const dmg = 8 + Math.floor(p.chargeFrames / 15);
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

ctx.strokeStyle = "#000000";
ctx.lineWidth = 4;
ctx.strokeRect(p.x - 1, drawY - 1, p.width + 2, drawHeight + 2);

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

      const paused = pausedRef.current && mode !== "online";
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

      const isOnlineMatch = mode === "online" && !!onlineMatchRef.current?.matchId;
      const isOnlineHost = isOnlineMatch && (onlineMatchRef.current?.host === true || onlineMatchRef.current?.side === "left");
      const shouldSimulate = !isOnlineMatch || isOnlineHost;

      if (shouldSimulate && !paused && !gameOver && roundPhaseRef.current === "countdown") {
        if (!countdownEndsAtRef.current) countdownEndsAtRef.current = Date.now() + 4000;
        const countdownRemaining = Math.max(0, countdownEndsAtRef.current - Date.now());

        if (countdownRemaining <= 0) {
          setRoundPhase("fight");
          roundPhaseRef.current = "fight";
          setCountdownValue(3);
          countdownRef.current = 3;
          roundMsRemainingRef.current = ROUND_TIME_SECONDS * 1000;
          roundEndsAtRef.current = Date.now() + ROUND_TIME_SECONDS * 1000;
          lastShownSecondRef.current = ROUND_TIME_SECONDS;
          setRoundTime(ROUND_TIME_SECONDS);
        } else if (countdownRemaining <= 1000) {
          setCountdownValue("GO");
          countdownRef.current = 0;
        } else if (countdownRemaining <= 2000) {
          setCountdownValue(1);
          countdownRef.current = 1;
        } else if (countdownRemaining <= 3000) {
          setCountdownValue(2);
          countdownRef.current = 2;
        } else {
          setCountdownValue(3);
          countdownRef.current = 3;
        }
      }

      let secondsLeft = lastShownSecondRef.current ?? ROUND_TIME_SECONDS;
      if (shouldSimulate && !paused && !gameOver && roundPhaseRef.current === "fight") {
        if (!roundEndsAtRef.current) {
          roundEndsAtRef.current = Date.now() + ROUND_TIME_SECONDS * 1000;
          roundMsRemainingRef.current = ROUND_TIME_SECONDS * 1000;
          lastShownSecondRef.current = ROUND_TIME_SECONDS;
          setRoundTime(ROUND_TIME_SECONDS);
        }

        roundMsRemainingRef.current = Math.max(0, roundEndsAtRef.current - Date.now());
        secondsLeft = Math.ceil(roundMsRemainingRef.current / 1000);
        if (secondsLeft !== lastShownSecondRef.current) {
          lastShownSecondRef.current = secondsLeft;
          setRoundTime(secondsLeft);
        }

        if (roundMsRemainingRef.current <= 0) {
          endRoundByTimer();
        }
      }

      const canAct = shouldSimulate && !paused && !gameOver && roundPhaseRef.current === "fight";

      if (isOnlineMatch && roundPhaseRef.current === "fight") {
        sendOnlineInputs();
      }

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
          proj.y += proj.vy || 0;

          let handledProjectile = false;
          for (const target of fighters) {
            if (!target.alive) continue;
            if (target.team === proj.team) continue;

            if (proj.attackHeight === "high" && target.ducking) continue;

            const dx = target.x + target.width / 2 - proj.x;
            const dy = target.y + target.height / 2 - proj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < target.width / 2 + proj.radius) {
              if (target.reflecting) {
                if (proj.type === "yellowspear" && proj.owner) proj.owner.spearLocked = false;

                const oldVx = proj.vx || 0;
                const newDir = oldVx === 0 ? (target.facing || 1) : -Math.sign(oldVx);

                proj.owner = target;
                proj.team = target.team;
                proj.x = target.x + (newDir > 0 ? target.width + proj.radius + 4 : -proj.radius - 4);
                proj.y = target.y + target.height / 2;
                proj.vx = newDir * Math.max(8, Math.abs(oldVx) || 8);
                proj.vy = 0;

                handledProjectile = true;
                break;
              }

              if (proj.type === "chargeball") {
                breakSpearStunIfNeeded(target);
                breakFreezeIfNeeded(target);

                const blocked = canBlockAttack(proj.owner, target, "chargeball", proj.attackHeight);
                let actualDamage = target.damageAmpTimer > 0 ? proj.damage * 2 : proj.damage;
                let knockback = Math.min(24, 6 + Math.floor((proj.damage || 1) / 2));

                if (blocked) {
                  actualDamage = Math.floor(actualDamage * 0.25);
                  knockback = Math.floor(knockback * 0.3);
                  playSfx("block");
                } else if (actualDamage > 0) {
                  playSfx("hit");
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
              } else if (proj.type === "yellowspear") {
                const blocked = canBlockAttack(proj.owner, target, "yellowspear", proj.attackHeight);
                applyDamage(proj.owner, target, "yellowspear", {
                  attackHeight: proj.attackHeight,
                  knockbackDir: 0,
                });
                if (proj.owner) proj.owner.spearLocked = false;
                if (!blocked && proj.owner) {
                  const dir = proj.owner.facing || 1;
                  target.x = Math.max(0, Math.min(WORLD_W - target.width, dir > 0 ? proj.owner.x + proj.owner.width + 14 : proj.owner.x - target.width - 14));
                  target.y = Math.min(target.y, groundLevel - target.height);
                  target.vx = 0;
                  target.vy = 0;
                  target.grounded = true;
                  target.spearStunned = true;
                  target.spearStunTimer = 180;
                  target.frozen = false;
                  target.frozenTimer = 0;
                  target.hitstun = false;
                  target.hitstunTimer = 0;
                }
              } else {
                applyDamage(proj.owner, target, proj.type, {
                  attackHeight: proj.attackHeight,
                  knockbackDir: proj.knockbackDir ?? (Math.sign(proj.vx) || 1),
                });
              }

              markKOIfNeeded(target);

              projectiles.current.splice(i, 1);
              handledProjectile = true;
              break;
            }
          }
          if (handledProjectile) continue;

          if (proj.x < -50 || proj.x > WORLD_W + 50 || proj.y < -90 || proj.y > WORLD_H + 90) {
            if (proj.type === "yellowspear" && proj.owner) proj.owner.spearLocked = false;
            projectiles.current.splice(i, 1);
          }
        }

        checkRoundEndByHP();
      }

      if (shouldSimulate && isOnlineMatch && isOnlineHost) {
        sendOnlineStateSnapshot();
      }

      projectiles.current.forEach(drawProjectile);
      fighters.forEach(drawFighter);

      if (!is2v2) {
        const f1 = fighters.find((f) => f.team === 1);
        const f2 = fighters.find((f) => f.team === 2);
        const f1Tag = mode === "online" ? f1.playerName || "Player 1" : "You";
        const f2Tag = mode === "online" ? f2.playerName || "Player 2" : f2.isHuman ? "P2" : gameConfig.practiceDummy ? "Dummy" : "AI";
        drawHealthBarSmall(`${f1.name} (${f1Tag})`, f1.alive ? f1.health : 0, 30, 20, f1.color, team1Rounds, false);
        drawHealthBarSmall(`${f2.name} (${f2Tag})`, f2.alive ? f2.health : 0, WORLD_W - 220, 20, f2.color, team2Rounds, true);
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
  if (mode === "online" && !onlineIsHostRef.current) return;
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

useEffect(() => {
  const match = onlineMatchRef.current;
  const socket = socketRef.current;
  const isOnlineMatch = mode === "online" && menuStep === "playing" && match?.matchId;
  const isHost = match?.host === true || match?.side === "left";
  if (!isOnlineMatch || !isHost || !socket || !gameOver || !matchWinnerText) return;
  if (onlineMatchEndSentRef.current) return;

  const p1Rounds = matchWinnerText === "Team 1" ? Math.max(team1Rounds, 2) : team1Rounds;
  const p2Rounds = matchWinnerText === "Team 2" ? Math.max(team2Rounds, 2) : team2Rounds;
  const winnerId = matchWinnerText === "Team 1" ? match.p1UserId : matchWinnerText === "Team 2" ? match.p2UserId : null;

  onlineMatchEndSentRef.current = true;
  socket.emit("match:end", {
    matchId: match.matchId,
    p1Rounds,
    p2Rounds,
    winnerId,
  });
}, [gameOver, matchWinnerText, team1Rounds, team2Rounds, mode, menuStep]);

  if (!tailwindLoaded) return <div style={{ padding: 20, textAlign: "center" }}>Loading…</div>;

  const CharSelectModal = () => {
    if (!charSelect) return null;
    const matchId = charSelect.matchId || (matched && matched.matchId) || (onlineMatchRef.current && onlineMatchRef.current.matchId);
    return (
      <div className="fixed inset-0 bg-black/10 backdrop-blur-[2px] z-50 flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-6 max-w-4xl w-full mx-4 shadow-2xl">
          <h3 className="text-xl mb-3">Character Select — {Math.ceil((charSelect.timeLeft || 20000) / 1000)}s</h3>
          <div className="grid grid-cols-4 gap-3">
            {FIGHTER_COLORS.map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={charSelect.me === c}
                onClick={() => {
                  if (!socketRef.current) return;
                  // set local selection and notify server
                  setCharSelect((prev) => prev ? { ...prev, me: c } : prev);
                  try {
                    const side = matched?.side || (onlineMatchRef.current && onlineMatchRef.current.side) || 'left';
                    if (side === 'left') setP1Color(c); else setP2Color(c);
                  } catch (e) {}
                  socketRef.current.emit('char:selected', { matchId, character: c });
                }}
              />
            ))}
          </div>
          <div className="mt-4 text-sm text-gray-600">Opponent: {matched?.opponent?.username} {charSelect.opponent ? `(selected: ${charSelect.opponent})` : ''}</div>
        </div>
      </div>
    );
  };

  const OpponentDisconnectedBanner = () => {
    if (!opponentDisconnected) return null;
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-300 text-yellow-900 rounded-xl px-4 py-3">
        <div className="flex items-center gap-4">
          <div>Opponent disconnected. Auto-forfeit in {Math.ceil(forfeitRemaining/1000)}s</div>
        </div>
      </div>
    );
  };

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

    const Row = ({ title, player, action, currentKey }) => {
      const active =
        listeningFor?.player === player && listeningFor?.action === action;

      return (
        <div
          className={`flex items-center justify-between gap-3 p-4 rounded-2xl border transition ${
            active
              ? "border-gray-900 bg-gray-100"
              : "border-gray-100 bg-white"
          }`}
        >
          <div>
            <div className="text-sm text-gray-900 font-light">{title}</div>
            <div className="text-xs text-gray-500 font-light mt-1">
              Current:{" "}
              <span className="font-medium text-gray-700">
                {prettyKey(currentKey) || "Unbound"}
              </span>
            </div>
          </div>

          <button
            type="button"
            className={`rounded-2xl px-4 py-2 border transition text-sm font-light ${
              active
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-200 hover:bg-gray-50 text-gray-800"
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              keysPressed.current = {};

              if (active) {
                listeningForRef.current = null;
                setListeningFor(null);
              } else {
                const next = { player, action };
                listeningForRef.current = next;
                setListeningFor(next);
              }
            }}
          >
            {active ? "Listening..." : "Change"}
          </button>
        </div>
      );
    };

    const renderPlayerRows = (player, binds) => (
      <>
        <Row title="Move Left" player={player} action="moveLeft" currentKey={binds.moveLeft} />
        <Row title="Move Right" player={player} action="moveRight" currentKey={binds.moveRight} />
        <Row title="Jump" player={player} action="jump" currentKey={binds.jump} />
        <Row title="Duck" player={player} action="duck" currentKey={binds.duck} />
        <Row title="Block" player={player} action="block" currentKey={binds.block} />
        <Row title="Punch" player={player} action="punch" currentKey={binds.punch} />
        <Row title="Kick" player={player} action="kick" currentKey={binds.kick} />
        <Row title="Special Move 1" player={player} action="special1" currentKey={binds.special1} />
        <Row title="Special Move 2" player={player} action="special2" currentKey={binds.special2} />
      </>
    );

    const listeningLabel = listeningFor
      ? `${listeningFor.player === "p1" ? "Player 1" : "Player 2"} ${
          ACTION_LABELS[listeningFor.action] || listeningFor.action
        }`
      : "";

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/30"
          onClick={() => {
            listeningForRef.current = null;
            setListeningFor(null);
            setSettingsOpen(false);
            keysPressed.current = {};
          }}
        />

        <div className="relative bg-white rounded-3xl w-[920px] max-w-[94vw] max-h-[90vh] overflow-y-auto p-8 border border-gray-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-light text-gray-900">Settings</div>
              <div className="text-sm text-gray-500 font-light mt-1">
                Audio + keybinds
              </div>
            </div>

            <button
              type="button"
              className="rounded-2xl px-4 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light"
              onClick={() => {
                listeningForRef.current = null;
                setListeningFor(null);
                setSettingsOpen(false);
                keysPressed.current = {};
              }}
            >
              Close
            </button>
          </div>

          {listeningFor && (
            <div className="mt-4 rounded-2xl border border-gray-900 bg-gray-50 p-4 text-sm font-light text-gray-800">
              Press a key for{" "}
              <span className="font-medium text-gray-900">{listeningLabel}</span>.
              <span className="text-gray-500"> Esc cancels.</span>
            </div>
          )}

          <div className="mt-6 rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-light text-gray-700">Music</div>
                <div className="text-xs text-gray-500 font-light mt-1">Music volume</div>
              </div>
              <div className="text-sm font-medium text-gray-800 w-10 text-right">{musicVolume}</div>
            </div>

            <div className="px-[10px]">
              <input
                type="range"
                min="0"
                max="100"
                step="10"
                value={musicVolume}
                onInput={(e) => {
                  const next = Math.max(0, Math.min(100, Math.round(Number(e.target.value) / 10) * 10));
                  setMusicVolume(next);
                }}
                onChange={(e) => {
                  const next = Math.max(0, Math.min(100, Math.round(Number(e.target.value) / 10) * 10));
                  setMusicVolume(next);
                }}
                className="audio-step-slider mt-4 w-full cursor-pointer"
                style={{ "--fill": `${musicVolume}%` }}
              />
            </div>

            <div className="mt-6 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-light text-gray-700">SFX</div>
                <div className="text-xs text-gray-500 font-light mt-1">Sound effects volume</div>
              </div>
              <div className="text-sm font-medium text-gray-800 w-10 text-right">{sfxVolume}</div>
            </div>

            <div className="px-[10px]">
              <input
                type="range"
                min="0"
                max="100"
                step="10"
                value={sfxVolume}
                onInput={(e) => {
                  const next = Math.max(0, Math.min(100, Math.round(Number(e.target.value) / 10) * 10));
                  setSfxVolume(next);
                }}
                onChange={(e) => {
                  const next = Math.max(0, Math.min(100, Math.round(Number(e.target.value) / 10) * 10));
                  setSfxVolume(next);
                }}
                className="audio-step-slider mt-4 w-full cursor-pointer"
                style={{ "--fill": `${sfxVolume}%` }}
              />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm font-light text-gray-700">Player 1</div>
              {renderPlayerRows("p1", p1Binds)}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-light text-gray-700">Player 2</div>
              {renderPlayerRows("p2", p2Binds)}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              className="rounded-2xl px-4 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light"
              onClick={() => {
                listeningForRef.current = null;
                setListeningFor(null);
                keysPressed.current = {};
                setP1Binds(DEFAULT_P1);
                setP2Binds(DEFAULT_P2);
                setMusicVolume(50);
                setSfxVolume(50);
              }}
            >
              Reset Defaults
            </button>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={toggleFullscreen}
                className="bg-white/80 backdrop-blur border border-gray-200 rounded-2xl px-5 py-3 hover:bg-white transition"
              >
                <span className="text-sm text-gray-800 font-light">
                  {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </span>
              </button>

              <button
                type="button"
                className="rounded-2xl px-4 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light"
                onClick={() => {
                  listeningForRef.current = null;
                  setListeningFor(null);
                  setSettingsOpen(false);
                  keysPressed.current = {};
                  goHome();
                }}
              >
                Return to Home
              </button>
            </div>
          </div>

          <div className="mt-4 text-xs text-gray-500 font-light">
            Tip: Click Change, press one key, and it will automatically save. Duplicate keys are removed from the other player so controls do not overlap.
          </div>
        </div>
      </div>
    );
  };

  const Layout = ({ children }) => (
    <div
      className="min-h-screen flex items-center justify-center p-12 relative overflow-hidden"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.35), rgba(2, 6, 23, 0.45)), url(${homepageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#020617",
      }}
    >
      <GlobalSettingsButton />
      <OpponentDisconnectedBanner />
      <SettingsModal />
      {children}
    </div>
  );

  const ColorCard = ({ color, selected, onClick, note }) => {
    const glow =
      color === "red"
        ? "rgba(239, 68, 68, 0.2)"
        : color === "blue"
        ? "rgba(59, 130, 246, 0.2)"
        : color === "green"
        ? "rgba(34, 197, 94, 0.2)"
        : color === "white"
        ? "rgba(17, 24, 39, 0.12)"
        : color === "purple"
        ? "rgba(168, 85, 247, 0.22)"
        : color === "yellow"
        ? "rgba(250, 204, 21, 0.24)"
        : color === "orange"
        ? "rgba(249, 115, 22, 0.22)"
        : "rgba(31, 41, 55, 0.2)";

    const border =
      color === "red"
        ? "#ef4444"
        : color === "blue"
        ? "#3b82f6"
        : color === "green"
        ? "#22c55e"
        : color === "white"
        ? "#111827"
        : color === "purple"
        ? "#a855f7"
        : color === "yellow"
        ? "#ca8a04"
        : color === "orange"
        ? "#f97316"
        : "#1f2937";

    const bodyClass =
      color === "red"
        ? "bg-red-500 border-red-600"
        : color === "blue"
        ? "bg-blue-500 border-blue-600"
        : color === "green"
        ? "bg-green-500 border-green-600"
        : color === "white"
        ? "bg-white border-gray-900"
        : color === "purple"
        ? "bg-purple-500 border-purple-700"
        : color === "yellow"
        ? "bg-yellow-300 border-yellow-600"
        : color === "orange"
        ? "bg-orange-500 border-orange-700"
        : "bg-gray-800 border-black";

    return (
      <button
        onClick={onClick}
        className="group relative bg-white border rounded-3xl p-10 hover:scale-[0.98] active:scale-95 transition-all duration-150"
        style={{
          boxShadow: selected ? `0 15px 40px ${glow}` : "0 10px 30px rgba(0, 0, 0, 0.05)",
          borderColor: selected ? border : "#f3f4f6",
        }}
      >
        <div className="mb-6">
          <div className={`w-24 h-32 rounded-2xl mx-auto border-4 ${bodyClass}`} />
        </div>
        <h2 className="text-2xl font-light text-gray-900 mb-2 capitalize">{color}</h2>
        <p className="text-xs font-light text-gray-500">{note}</p>
      </button>
    );
  };

  if (mode === "home") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-12 text-center max-w-7xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">RGB Fighters</h1>
          <p className="text-4xl font-light text-gray-500 mb-12">Choose a Mode</p>

          <div className="grid grid-cols-3 gap-6">
            {[
              { key: "practice", title: "Practice", desc: "100-HP dummy (KO disappears) + Refresh button" },
              { key: "single", title: "Single Player", desc: "Fight an AI (best of 3)" },
              { key: "coop", title: "Multi Player", desc: "2v2: P1+P2 vs AI team (pick both enemies)" },
              { key: "ladder", title: "Ladder", desc: "Face all the colors, and the last fight is a mirror match." },
              { key: "offline", title: "1v1 Offline", desc: "Local PvP (P1 vs P2)" },
              { key: "online", title: "1v1 Online", desc: "Play against real players online" },
            ].map((m) => {
              const disabled = false;
              return (
                <button
                  key={m.key}
                  onClick={() => startModeFlow(m.key)}
                  className={`text-left rounded-3xl p-8 border transition ${
                    "bg-white border-gray-100 hover:scale-[0.99] active:scale-95"
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

  if (mode === "online" && menuStep !== "playing") {
    return (
      <Layout>
        <CharSelectModal />
        <div className="bg-white rounded-3xl p-8 text-center max-w-4xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">Online 1v1</h1>

          {!user ? (
            <div className="space-y-6">
              <p className="text-lg font-light text-gray-500">You must be logged in to play online.</p>
              <Login onLogin={(u, t) => { setUser(u); setToken(t); }} />
              <div className="pt-4">
                <button onClick={goHome} className="bg-gray-200 text-gray-900 rounded-2xl px-6 py-3 hover:opacity-90 transition">Return Home</button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-lg font-light text-gray-500">Logged in as <strong>{user.username}</strong> — ELO: {user.elo} — Record: {user.wins}W - {user.losses}L</p>
              <div className="flex flex-col items-center gap-4">
                {matched && (
                  <div className="p-4 border rounded-md w-full max-w-md">
                    <div className="text-sm text-gray-600 mb-2">Match Found</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">You ({user.username})</div>
                        <div className="text-xs">ELO: {user.elo} — {user.wins}W - {user.losses}L</div>
                        <div className="text-xs">Side: {matched.side === 'left' ? 'Left' : 'Right'}</div>
                      </div>
                      <div>
                        <div className="font-medium">Opponent: {matched.opponent?.username}</div>
                        <div className="text-xs">ELO: {matched.opponent?.elo} — {matched.opponent?.wins}W</div>
                      </div>
                    </div>
                  </div>
                )}
                {!(queueing || charSelect || matched || onlineMatchRef.current?.matchId) ? (
                <button
                  onClick={() => {
                    setOnlineError("");
                    if (socketRef.current) socketRef.current.disconnect();
                    const sockToken = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('rgb_token') : null);
                    const s = createSocket(sockToken);
                    try {
                      s.on('connect_error', (err) => {
                        console.error('[SOCKET] connect_error', err);
                        setQueueing(false);
                        setOnlineError("Could not connect to matchmaking. Restart npm run dev and try again.");
                      });
                    } catch (e) {}
                    socketRef.current = s;
                    setQueueing(true);

                    s.on('connect', () => {
                      setOnlineError("");
                      s.emit('queue:join', { side: 'left' });
                    });

                    s.on('queue:matched', (d) => {
                      setMatched(d);
                      setQueueing(false);
                      setOnlineError("");
                    });

                    s.on('char:selectStart', (d) => {
                      if (d?.matchId) {
                        setMatched((prev) => {
                          if (prev && prev.matchId === d.matchId) return prev;
                          return { ...(prev || {}), matchId: d.matchId, side: d.side || prev?.side };
                        });
                      }
                      setCharSelect({ timeLeft: d.timeLimit || 20000, matchId: d.matchId || (matched && matched.matchId) || (d && d.matchId), me: null, opponent: null });
                    });

                    s.on('opponent:charSelected', (payload) => {
                      const c = payload?.character;
                      setCharSelect((prev) => {
                        if (!prev) return prev;
                        return { ...prev, opponent: c || prev.opponent };
                      });

                      const side = payload?.side || matched?.side || (onlineMatchRef.current && onlineMatchRef.current.side) || 'right';
                      if (side === 'left') {
                        setP2Color((prev) => c || prev);
                      } else {
                        setP1Color((prev) => c || prev);
                      }
                    });

    s.on('char:forfeit', () => {
      refreshOnlineUser();
      clearOnlineSession({ disconnectSocket: true, keepLobby: false });
      setMode("home");
      setMenuStep("idle");
      resetAll();
    });

                      s.on('opponent:disconnected', (d) => {
                        const grace = (d && d.grace) || 10000;
                        setOpponentDisconnected(true);
                        setForfeitRemaining(grace);
                        if (forfeitIntervalRef.current) clearInterval(forfeitIntervalRef.current);
                        forfeitIntervalRef.current = setInterval(() => {
                          setForfeitRemaining((prev) => {
                            const next = Math.max(0, prev - 250);
                            if (next <= 0) {
                              clearInterval(forfeitIntervalRef.current);
                              forfeitIntervalRef.current = null;
                              if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
                              onlineMatchRef.current = null;
                              onlineRemoteInputsRef.current = {};
                              setMatched(null);
                              setQueueing(false);
                              setMenuStep('idle');
                            }
                            return next;
                          });
                        }, 250);
                      });
                    
    s.on('opponent:reconnected', () => {
      if (forfeitIntervalRef.current) {
        clearInterval(forfeitIntervalRef.current);
        forfeitIntervalRef.current = null;
      }
      setOpponentDisconnected(false);
      setForfeitRemaining(0);
    });

                    s.on('match:start', (d) => {
                      resetAll();
                      if (d?.matchId) {
                        setMatched((prev) => (prev && prev.matchId === d.matchId ? prev : { ...(prev || {}), matchId: d.matchId, side: d.side }));
                      }
                      const isHost = d.host === true || d.side === 'left';
                      onlineMatchRef.current = {
                        matchId: d.matchId || (matched && matched.matchId),
                        side: d.side,
                        host: isHost,
                        p1UserId: d.p1UserId,
                        p2UserId: d.p2UserId,
                        p1Username: d.p1Username,
                        p2Username: d.p2Username,
                      };
                      onlineIsHostRef.current = isHost;
                      onlineMatchEndSentRef.current = false;
                      onlineSyncSeqRef.current = 0;
                      onlineLastSyncSeqRef.current = 0;
                      onlineSyncMatchIdRef.current = d.matchId || (matched && matched.matchId) || null;
                      onlineLastStatePostAtRef.current = 0;
                      setOnlinePlayerNames({
                        p1: d.p1Username || "Player 1",
                        p2: d.p2Username || "Player 2",
                      });
                      setP1Color(d.p1Char || p1Color);
                      setP2Color(d.p2Char || p2Color);
                      setStage(d.stage || "default");
                      setCharSelect(null);
                      setMode('online');
                      onlineRemoteInputsRef.current = {};
                      setMenuStep('playing');
                      setTimeout(() => {
                        const fullscreenTarget = document.documentElement;
                        if (fullscreenTarget && !document.fullscreenElement && fullscreenTarget.requestFullscreen) {
                          fullscreenTarget.requestFullscreen().catch(() => {});
                        }
                      }, 0);

                      s.on('input:opponent', (payload) => {
                        const m = onlineMatchRef.current;
                        if (!m) return;
                        const inputs = payload?.inputs ?? payload;
                        window.__lastRemoteInputs = inputs;
                        onlineRemoteInputsRef.current = { ...(inputs || {}) };
                      });

                      s.on('state:sync', (payload) => {
                        const m = onlineMatchRef.current;
                        if (!m || m.host || m.side === "left") return;
                        if (payload?.matchId && payload.matchId !== m.matchId) return;
                        const incomingState = payload?.state || payload;
                        applyOnlineState({ ...incomingState, matchId: payload?.matchId || incomingState?.matchId || m.matchId });
                      });
                    });

    s.on('match:result', (d) => {
      setUser((prev) => prev && d ? {
        ...prev,
        elo: typeof d.newElo !== "undefined" ? d.newElo : prev.elo,
        wins: typeof d.wins !== "undefined" ? d.wins : prev.wins,
        losses: typeof d.losses !== "undefined" ? d.losses : prev.losses,
      } : prev);
      refreshOnlineUser();
      clearOnlineSession({ disconnectSocket: true, keepLobby: false });
      setSettingsOpen(false);
      setMode("home");
      setMenuStep("idle");
      resetAll();
    });

    s.on('match:ended', () => {
      refreshOnlineUser();
      clearOnlineSession({ disconnectSocket: true, keepLobby: false });
      setSettingsOpen(false);
      setMode("home");
      setMenuStep("idle");
      resetAll();
    });

                  }}
                  className="bg-green-600 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition"
                >
                  Search For Opponent
                </button>
                ) : (
                  <button onClick={() => {
                    if (socketRef.current) {
                      socketRef.current.emit('queue:cancel');
                      socketRef.current.disconnect();
                      socketRef.current = null;
                    }
                    setQueueing(false);
                    setMatched(null);
                    setOnlineError("");
                  }} className="bg-yellow-600 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition">Cancel Search</button>
                )}
                {onlineError && <div className="text-red-500 text-sm max-w-md">{onlineError}</div>}
                <button onClick={() => { goHome(); localStorage.removeItem('rgb_token'); setToken(null); setUser(null); }} className="bg-red-600 text-white rounded-2xl px-6 py-3">Logout</button>
                <button onClick={() => setMenuStep('leaderboard')} className="bg-gray-900 text-white rounded-2xl px-6 py-3">Leaderboard</button>
                <button onClick={goHome} className="bg-gray-200 text-gray-900 rounded-2xl px-6 py-3">Return Home</button>
              </div>

              {menuStep === 'leaderboard' && <div className="mt-6"><Leaderboard /></div>}
            </div>
          )}

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
            {FIGHTER_COLORS.map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={p1Color === c}
                onClick={() => {
                  playSfx("menu_select");
                  setP1Color(c);

                  if (mode === "ladder") {
                    const others = FIGHTER_COLORS.filter((x) => x !== c);
                    setLadderOppOrder(shuffle(others));
                  }

                  setManagedTimeout(() => proceedAfterP1(), 0);
                }}
                note={fighterNote(c)}
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
            {FIGHTER_COLORS.map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={opp1Color === c}
                onClick={() => {
                  playSfx("menu_select");
                  setOpp1Color(c);
                  setManagedTimeout(() => proceedAfterOpp1(), 0);
                }}
                note={fighterNote(c)}
              />
            ))}
          </div>

          <button
            onClick={() => {
              playSfx("menu_back");
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
            {FIGHTER_COLORS.map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={opp2Color === c}
                onClick={() => {
                  playSfx("menu_select");
                  setOpp2Color(c);
                  setManagedTimeout(() => proceedAfterOpp2(), 0);
                }}
                note={fighterNote(c)}
              />
            ))}
          </div>

          <button
            onClick={() => {
              playSfx("menu_back");
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
            {FIGHTER_COLORS.map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={p2Color === c}
                onClick={() => {
                  playSfx("menu_select");
                  setP2Color(c);
                  setManagedTimeout(() => proceedAfterP2(), 0);
                }}
                note={fighterNote(c)}
              />
            ))}
          </div>

          <button
            onClick={() => {
              playSfx("menu_back");
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
                  playSfx("menu_select");
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
              playSfx("menu_back");
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
      { key: "sky", title: "Fly High City", desc: "Asymmetric floating platforms" },
      { key: "hourglass", title: "Hourglass", desc: "Narrow center bridge with high ledges" },
      { key: "bottom", title: "Bottom Feeder", desc: "Abyssal staggered platforms" },
    ];

    return (
      <Layout>
        <div className="bg-white rounded-3xl p-10 text-center max-w-7xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">Select Stage</h1>
          <p className="text-lg font-light text-gray-500 mb-12 mt-12">Choose your battlefield.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-6">
            {stageChoices.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  playSfx("menu_select");
  setStage(s.key);

  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  setManagedTimeout(() => proceedAfterStage(), 0);
}}
                className="p-10 bg-white border border-gray-100 rounded-2xl hover:scale-[0.98] active:scale-95 transition-all duration-150"
                style={{ boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)" }}
              >
                <div
                  className={`mb-6 h-40 rounded-2xl flex items-center justify-center ${
                    s.key === "recursion"
                      ? "bg-gradient-to-b from-gray-700 to-gray-900"
                      : s.key === "sky"
                      ? "bg-gradient-to-b from-sky-100 to-blue-200"
                      : s.key === "hourglass"
                      ? "bg-gradient-to-b from-amber-100 to-purple-200"
                      : s.key === "bottom"
                      ? "bg-gradient-to-b from-cyan-950 to-blue-700"
                      : "bg-gradient-to-b from-gray-100 to-gray-200"
                  }`}
                >
                  <div className="text-6xl">
                    {s.key === "recursion" ? "🔺" : s.key === "sky" ? "☁️" : s.key === "hourglass" ? "⌛" : s.key === "bottom" ? "🌊" : "🏛️"}
                  </div>
                </div>
                <h2 className="text-2xl font-light text-gray-900 mb-2">{s.title}</h2>
                <p className="text-sm font-light text-gray-500">{s.desc}</p>
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              playSfx("menu_back");
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
    const ladderLabel = mode === "ladder" ? `Ladder Match ${ladderIndex + 1} / ${FIGHTER_COLORS.length}` : null;

    const onExit = () => {
      goHome();
    };

    const onNextMatchLadder = () => {
      if (!matchWinnerText) return;

      if (matchWinnerText === "Team 1") {
        const next = ladderIndex + 1;
        if (next >= FIGHTER_COLORS.length) {
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
                ) : mode === "online" ? (
                  <button onClick={goHome} className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition">
                    Home
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
