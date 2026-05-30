import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001/api";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";

function FighterGame() {
  const [tailwindLoaded, setTailwindLoaded] = useState(false);
  const socketRef = useRef(null);

  const [currentUser, setCurrentUser] = useState(null);
  const [mode, setMode] = useState("home");
  const [menuStep, setMenuStep] = useState("idle");
  const [leaderboardElo, setLeaderboardElo] = useState([]);
  const [leaderboardWins, setLeaderboardWins] = useState([]);

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

  const [onlineMatchId, setOnlineMatchId] = useState(null);
  const [onlineOpponent, setOnlineOpponent] = useState(null);
  const [onlineSide, setOnlineSide] = useState(null);
  const [charSelectTimer, setCharSelectTimer] = useState(null);

  const canvasRef = useRef(null);
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

  useEffect(() => {
    const loadUser = async () => {
      const token = localStorage.getItem("auth_token");
      if (token) {
        try {
          const res = await fetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const user = await res.json();
            setCurrentUser({ ...user, token });
          } else {
            localStorage.removeItem("auth_token");
          }
        } catch (err) {
          console.error("Failed to load user:", err);
          localStorage.removeItem("auth_token");
        }
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    const fetchLeaderboards = async () => {
      try {
        const [eloRes, winsRes] = await Promise.all([
          fetch(`${API_BASE}/leaderboard/top-elo`),
          fetch(`${API_BASE}/leaderboard/top-wins`),
        ]);
        if (eloRes.ok) setLeaderboardElo(await eloRes.json());
        if (winsRes.ok) setLeaderboardWins(await winsRes.json());
      } catch (err) {
        console.error("Failed to fetch leaderboards:", err);
      }
    };
    fetchLeaderboards();
  }, []);

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
      online: false,
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

    if (mode === "online") {
      return {
        ...base,
        online: true,
        humans: [
          { slot: "p1", team: 1, color: p1Color },
          { slot: "p2", team: 2, color: p2Color },
        ],
        ai: [],
        difficulty: null,
        stage: "default",
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

    setOnlineMatchId(null);
    setOnlineOpponent(null);
    setOnlineSide(null);
    setCharSelectTimer(null);

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
      setMenuStep("online_queue");
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

  const handleLogin = async (email, password) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const { token, user } = await res.json();
        localStorage.setItem("auth_token", token);
        setCurrentUser({ ...user, token });
        setMode("home");
        setMenuStep("idle");
      } else {
        const err = await res.json();
        alert(err.error || "Login failed");
      }
    } catch (err) {
      alert("Login error: " + err.message);
    }
  };

  const handleRegister = async (email, username, password) => {
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });
      if (res.ok) {
        const { token, user } = await res.json();
        localStorage.setItem("auth_token", token);
        setCurrentUser({ ...user, token });
        setMode("home");
        setMenuStep("idle");
      } else {
        const err = await res.json();
        alert(err.error || "Registration failed");
      }
    } catch (err) {
      alert("Registration error: " + err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    setCurrentUser(null);
    goHome();
  };

  if (!tailwindLoaded) return <div style={{ padding: 20, textAlign: "center" }}>Loading…</div>;

  if (!currentUser) {
    return menuStep === "login" ? (
      <LoginScreen onLogin={handleLogin} onSwitchToRegister={() => setMenuStep("register")} />
    ) : (
      <RegisterScreen onRegister={handleRegister} onSwitchToLogin={() => setMenuStep("login")} />
    );
  }

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
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-6xl font-light text-gray-900 mb-2">RGB Fighters</h1>
              <p className="text-lg font-light text-gray-500">Welcome, {currentUser.username}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-2xl px-6 py-2 border border-gray-200 hover:bg-gray-50 transition text-sm font-light text-gray-600"
            >
              Logout
            </button>
          </div>

          <div className="flex items-center gap-6 mb-8 text-sm text-gray-600 font-light">
            <div>ELO: <span className="font-semibold text-gray-900">{currentUser.elo}</span></div>
            <div>Wins: <span className="font-semibold text-gray-900">{currentUser.wins}</span></div>
            <div>Losses: <span className="font-semibold text-gray-900">{currentUser.losses}</span></div>
          </div>

          <p className="text-xl font-light text-gray-500 mb-12">Choose a Mode</p>

          <div className="grid grid-cols-3 gap-6 mb-12">
            {[
              { key: "practice", title: "Practice", desc: "100-HP dummy (KO disappears) + Refresh button" },
              { key: "single", title: "Single Player", desc: "Fight an AI (best of 3)" },
              { key: "coop", title: "Multi Player", desc: "2v2: P1+P2 vs AI team (pick both enemies)" },
              { key: "ladder", title: "Ladder", desc: "4 fights, all colors once, last is mirror. Random stage only." },
              { key: "offline", title: "1v1 Offline", desc: "Local PvP (P1 vs P2)" },
              { key: "online", title: "1v1 Online", desc: "Real multiplayer with matchmaking & ELO" },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => startModeFlow(m.key)}
                className="text-left rounded-3xl p-8 border transition bg-white border-gray-100 hover:scale-[0.99] active:scale-95"
                style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.06)" }}
              >
                <div className="text-2xl font-light text-gray-900">{m.title}</div>
                <div className="text-sm font-light text-gray-500 mt-2">{m.desc}</div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="bg-gray-50 rounded-2xl p-6">
              <h3 className="text-lg font-light text-gray-900 mb-4">Top 10 by ELO</h3>
              <div className="space-y-2 text-sm font-light text-gray-700">
                {leaderboardElo.map((u, i) => (
                  <div key={i} className="flex justify-between">
                    <span>#{i + 1} {u.username}</span>
                    <span className="font-semibold">{u.elo}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-50 rounded-2xl p-6">
              <h3 className="text-lg font-light text-gray-900 mb-4">Top 10 by Wins</h3>
              <div className="space-y-2 text-sm font-light text-gray-700">
                {leaderboardWins.map((u, i) => (
                  <div key={i} className="flex justify-between">
                    <span>#{i + 1} {u.username}</span>
                    <span className="font-semibold">{u.wins}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (menuStep === "login") {
    return <LoginScreen onLogin={handleLogin} onSwitchToRegister={() => setMenuStep("register")} />;
  }

  if (menuStep === "register") {
    return <RegisterScreen onRegister={handleRegister} onSwitchToLogin={() => setMenuStep("login")} />;
  }

  if (menuStep === "online_queue") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-3xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-6">Matchmaking Queue</h1>
          <p className="text-lg font-light text-gray-500 mb-10">Choose your side</p>

          <div className="space-y-4 mb-8">
            {["left", "right", "random"].map((side) => (
              <button
                key={side}
                onClick={() => {
                  setOnlineSide(side);
                  if (!socketRef.current) {
                    socketRef.current = io(SOCKET_URL);
                  }
                  socketRef.current.emit("queue:join", {
                    userId: currentUser.id,
                    username: currentUser.username,
                    token: currentUser.token,
                    side,
                  });
                  setMenuStep("online_queue_wait");
                }}
                className="w-full py-6 bg-white border border-gray-100 rounded-2xl hover:scale-[0.98] active:scale-95 transition-all duration-150"
                style={{ boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)" }}
              >
                <h2 className="text-2xl font-light capitalize mb-1">{side === "random" ? "Random Side" : `Left Side`}</h2>
                <p className="text-sm text-gray-500 font-light">{side === "random" ? "Server chooses for you" : "You play on the left"}</p>
              </button>
            ))}
          </div>

          <button onClick={goHome} className="mt-8 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors">
            {"←"} Back to Home
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "online_queue_wait") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-3xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-6">Finding opponent...</h1>
          <div className="flex justify-center gap-2 mb-8">
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <button onClick={goHome} className="mt-8 text-sm text-gray-400 hover:text-gray-600 font-light transition-colors">
            {"←"} Cancel
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "online_char_select") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-6xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">Choose Your Fighter</h1>
          <div className="text-xl font-light text-gray-500 mb-4">vs {onlineOpponent?.username} (ELO: {onlineOpponent?.elo})</div>
          <div className="text-2xl font-light text-red-600 mb-10">{charSelectTimer}s</div>

          <div className="grid grid-cols-4 gap-6">
            {["red", "blue", "green", "black"].map((c) => (
              <ColorCard
                key={c}
                color={c}
                selected={p1Color === c}
                onClick={() => {
                  setP1Color(c);
                  socketRef.current.emit("char:selected", {
                    matchId: onlineMatchId,
                    character: c,
                  });
                  setMenuStep("online_opponent_select");
                }}
                note={c === "red" ? "Fire & Dash" : c === "blue" ? "Ice Control" : c === "green" ? "Poison & Heal" : "Void & Charge"}
              />
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (menuStep === "online_opponent_select") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-3xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-6">Waiting for opponent...</h1>
          <div className="flex justify-center gap-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
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
              ? "Practice — pick your fighter"
              : mode === "single"
              ? "Single Player — pick your fighter"
              : mode === "offline"
              ? "Offline 1v1 — pick P1 fighter"
              : mode === "coop"
              ? "2v2 — pick P1 fighter"
              : "Ladder — pick your fighter"}
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
            {"←"} Back to Home
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "opp1") {
    const title = mode === "practice" ? "Choose Dummy Color" : mode === "coop" ? "Choose Enemy 1" : "Choose Opponent";
    const subtitle =
      mode === "practice" ? "Dummy doesn't fight back. 100 HP, takes knockback/launch, disappears on KO (use Refresh to bring it back)." : "Mirror matches allowed.";

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
            {"←"} Back
          </button>
        </div>
      </Layout>
    );
  }

  if (menuStep === "opp2") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-16 text-center max-w-6xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-6xl font-light text-gray-900 mb-4">Choose Enemy 2</h1>
          <p className="text-xl font-light text-gray-500 mb-10">Pick the second AI opponent.</p>

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
            {"←"} Back
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
          <p className="text-xl font-light text-gray-500 mb-10">{mode === "offline" ? "Offline 1v1 — P2 is your opponent (local PvP)" : "2v2 — P2 is your teammate (local co-op)"}</p>

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
            {"←"} Back
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
          <p className="text-lg font-light text-gray-500 mb-12">{mode === "ladder" ? "Ladder scales automatically; this sets your base AI." : "Choose AI Challenge Level"}</p>

          <div className="space-y-4">
            {[
              { name: "easy", desc: "Slow reactions, basic tactics" },
              { name: "medium", desc: "Aggressive, adapts to your HP" },
              { name: "hard", desc: "Expert AI, relentless pressure" },
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
            {"←"} Back
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
          <p className="text-lg font-light text-gray-500 mb-12">Choose your battlefield.</p>

          <div className="grid grid-cols-2 gap-6">
            {stageChoices.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  setStage(s.key);
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
            {"←"} Back
          </button>
        </div>
      </Layout>
    );
  }

  return <GameScreen {...{ canvasRef, gameConfig, menuStep, mode, settingsOpen, listeningFor, gameOver, roundWinnerText, matchWinnerText, roundTime, countdownValue, team1Rounds, team2Rounds, ladderIndex, ladderWin, ladderLoss, onlineSide, onlineMatchId, setGameOver, setRoundWinnerText, setMatchWinnerText, setTeam1Rounds, setTeam2Rounds, setLadderIndex, setLadderWin, setLadderLoss, setMenuStep, goHome, startModeFlow, practiceRefreshRef, primeNewRound, keysPressed, projectiles, clearAllTimeouts, roundPhaseRef, countdownRef, roundMsRemainingRef, lastShownSecondRef, pausedRef, p1BindsRef, p2BindsRef, socketRef, onlineOpponent, charSelectTimer }} />;
}

function LoginScreen({ onLogin, onSwitchToRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (email && password) {
      onLogin(email, password);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#F9E4BC" }}>
      <div className="bg-white rounded-3xl p-12 text-center max-w-md border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
        <h1 className="text-5xl font-light text-gray-900 mb-2">RGB Fighters</h1>
        <p className="text-gray-500 font-light mb-8">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:border-gray-400 font-light"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:border-gray-400 font-light"
          />
          <button type="submit" className="w-full bg-gray-900 text-white rounded-2xl py-3 hover:opacity-90 transition font-light">
            Login
          </button>
        </form>

        <button
          onClick={onSwitchToRegister}
          className="mt-6 text-sm text-gray-500 hover:text-gray-700 font-light transition-colors"
        >
          Don't have an account? <span className="font-semibold">Register</span>
        </button>
      </div>
    </div>
  );
}

function RegisterScreen({ onRegister, onSwitchToLogin }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (email && username && password) {
      onRegister(email, username, password);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#F9E4BC" }}>
      <div className="bg-white rounded-3xl p-12 text-center max-w-md border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
        <h1 className="text-5xl font-light text-gray-900 mb-2">RGB Fighters</h1>
        <p className="text-gray-500 font-light mb-8">Create your account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:border-gray-400 font-light"
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:border-gray-400 font-light"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:border-gray-400 font-light"
          />
          <button type="submit" className="w-full bg-gray-900 text-white rounded-2xl py-3 hover:opacity-90 transition font-light">
            Register
          </button>
        </form>

        <button
          onClick={onSwitchToLogin}
          className="mt-6 text-sm text-gray-500 hover:text-gray-700 font-light transition-colors"
        >
          Already have an account? <span className="font-semibold">Login</span>
        </button>
      </div>
    </div>
  );
}

function GameScreen(props) {
  const { canvasRef, gameConfig, menuStep } = props;

  // Game loop and rendering logic will continue in next section
  // For now, return placeholder
  if (menuStep !== "playing") {
    return null;
  }

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}>
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute top-6 left-6 z-40 flex items-center gap-3">
        <button onClick={props.goHome} className="bg-white/80 backdrop-blur border border-gray-200 rounded-2xl px-5 py-3 hover:bg-white transition">
          <span className="text-sm text-gray-800 font-light">Exit</span>
        </button>
      </div>
    </div>
  );
}

export default FighterGame;
