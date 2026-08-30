import background1Url from "./assets/Background1.png";
import background2Url from "./assets/Background2.png";
import background3Url from "./assets/Background3.png";
import background4Url from "./assets/Background4.png";
import background5Url from "./assets/Background5.png";
import homepageUrl from "./assets/homepage.png";
import rgbLogoUrl from "./assets/RGBlogo.png";
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

const ONLINE_STAGE_CHOICES = [
  { key: "default", name: "Classic" },
  { key: "recursion", name: "Recursion" },
  { key: "sky", name: "Sky" },
  { key: "hourglass", name: "Hourglass" },
  { key: "bottom", name: "Bottom" },
];

function FighterGame() {
  const [tailwindLoaded, setTailwindLoaded] = useState(false);

  const [mode, setMode] = useState("home");

  const [menuStep, setMenuStep] = useState("idle");
  const menuStepRef = useRef(menuStep);

  const [user, setUser] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [userRank, setUserRank] = useState(null);
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem('rgb_token');
    } catch {
      return null;
    }
  });
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [friendsData, setFriendsData] = useState({
    incoming: [],
    outgoing: [],
    friends: [],
    private1v1Requests: [],
    private2v2Requests: [],
    online2v2Requests: [],
    acceptedInvites: [],
  });
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsMessage, setFriendsMessage] = useState("");

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

  useEffect(() => {
    if (!token) {
      setAchievements([]);
      return;
    }
    let mounted = true;
    api.getAchievements(token).then((data) => {
      if (!mounted) return;
      setAchievements(Array.isArray(data?.achievements) ? data.achievements : []);
    }).catch(() => {
      if (mounted) setAchievements([]);
    });
    return () => (mounted = false);
  }, [token]);

  const refreshAchievements = () => {
    const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("rgb_token") : null);
    if (!authToken) return;
    api.getAchievements(authToken).then((data) => {
      setAchievements(Array.isArray(data?.achievements) ? data.achievements : []);
    }).catch(() => {});
  };

  const refreshOnlineUser = () => {
    const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("rgb_token") : null);
    if (!authToken) return;
    api.me(authToken).then((updatedUser) => {
      setUser(updatedUser);
    }).catch(() => {});
  };

  useEffect(() => {
    if (!user?.username) {
      setUserRank(null);
      return;
    }
    let mounted = true;
    api.getRank(user.username).then((rank) => {
      if (mounted) setUserRank(rank);
    }).catch(() => {
      if (mounted) setUserRank(null);
    });
    return () => (mounted = false);
  }, [user?.username, user?.wins, user?.losses]);

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
  const pendingPrivateInviteRef = useRef(null);
  const pendingTeamInviteRef = useRef(null);

  const sendOnlineMapVote = (stageKey, { playSound = true } = {}) => {
    const matchId = charSelect?.matchId || (matched && matched.matchId) || (onlineMatchRef.current && onlineMatchRef.current.matchId);
    if (!socketRef.current || !matchId || !ONLINE_STAGE_CHOICES.some((stageChoice) => stageChoice.key === stageKey)) return;
    if (playSound) playSfx("menu_select");
    setCharSelect((prev) => prev ? { ...prev, map: stageKey } : prev);
    socketRef.current.emit('map:selected', { matchId, stage: stageKey });
  };

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
    if (!charSelect.me) {
      clearOnlineSession({ disconnectSocket: false, keepLobby: false });
      setMode("home");
      setMenuStep("idle");
      return;
    }
    if (!charSelect.map) {
      const randomStage = ONLINE_STAGE_CHOICES[Math.floor(Math.random() * ONLINE_STAGE_CHOICES.length)].key;
      sendOnlineMapVote(randomStage, { playSound: false });
    }
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
  const ladderAchievementSentRef = useRef("");
  const [ladderExitConfirmOpen, setLadderExitConfirmOpen] = useState(false);

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
  const onlineReturnScheduledRef = useRef(false);
  const pausedRef = useRef(false);

  const practiceRefreshRef = useRef(null);
  const musicAudioRef = useRef({});
  const sfxAudioPoolRef = useRef({});
  const sfxAudioIndexRef = useRef({});
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
  const gameOverRef = useRef(gameOver);
  const matchWinnerTextRef = useRef(matchWinnerText);

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
    special3: ";",
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
    special3: "",
  };
  const DEFAULT_P1_CONTROLLER = {
    moveLeft: "xbox:dpad-left",
    moveRight: "xbox:dpad-right",
    jump: "xbox:dpad-up",
    duck: "xbox:dpad-down",
    block: "xbox:rt",
    punch: "xbox:x",
    kick: "xbox:y",
    special1: "xbox:a",
    special2: "xbox:b",
    special3: "xbox:rb",
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
        special3: (parsed.special3 ?? fallback.special3 ?? "").toLowerCase(),
      };
    } catch {
      return fallback;
    }
  };

  const [p1Binds, setP1Binds] = useState(() => loadBinds("rgb_fighters_keybinds_p1_v4", DEFAULT_P1));
  const [p2Binds, setP2Binds] = useState(() => loadBinds("rgb_fighters_keybinds_p2_v4", DEFAULT_P2));
  const [p1ControllerBinds, setP1ControllerBinds] = useState(() => loadBinds("rgb_fighters_controller_binds_p1_v2", DEFAULT_P1_CONTROLLER));
  const p1BindsRef = useRef(p1Binds);
  const p2BindsRef = useRef(p2Binds);
  const p1ControllerBindsRef = useRef(p1ControllerBinds);
  const previousGamepadPressedRef = useRef({});
  const previousGamepadActionsRef = useRef({});
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
    special3: "__remote_special3",
  });

  useEffect(() => {
    p1BindsRef.current = p1Binds;
    try {
      localStorage.setItem("rgb_fighters_keybinds_p1_v4", JSON.stringify(p1Binds));
    } catch {}
  }, [p1Binds]);

  useEffect(() => {
    p1ControllerBindsRef.current = p1ControllerBinds;
    try {
      localStorage.setItem("rgb_fighters_controller_binds_p1_v2", JSON.stringify(p1ControllerBinds));
    } catch {}
  }, [p1ControllerBinds]);

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
      localStorage.setItem("rgb_fighters_keybinds_p2_v4", JSON.stringify(p2Binds));
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
    for (const audio of Object.values(sfxAudioPoolRef.current).flat()) {
      audio.volume = 0.65 * (sfxVolume / 100);
    }
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

    const musicSoundNames = new Set(Object.values(musicNames));
    const sfxPools = {};
    for (const [name, url] of Object.entries(RGB_SOUND_URLS)) {
      if (musicSoundNames.has(name)) continue;
      sfxPools[name] = Array.from({ length: 6 }, () => {
        const audio = new Audio(url);
        audio.preload = "auto";
        audio.volume = 0.65 * (sfxVolumeRef.current / 100);
        return audio;
      });
      sfxAudioIndexRef.current[name] = 0;
    }
    sfxAudioPoolRef.current = sfxPools;

    setMusicReady(true);

    return () => {
      Object.values(tracks).forEach((audio) => audio.pause());
      Object.values(sfxPools).flat().forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      musicAudioRef.current = {};
      sfxAudioPoolRef.current = {};
      sfxAudioIndexRef.current = {};
      currentMusicRef.current = "";
    };
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("keyboard");
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
    special3: "Special Move 3",
  };

  useEffect(() => {
    listeningForRef.current = listeningFor;
  }, [listeningFor]);

  useEffect(() => {
    pausedRef.current = settingsOpen && mode !== "online";

    if (settingsOpen && mode !== "online" && mode !== "online2v2") {
      keysPressed.current = {};
    }

    if (!settingsOpen) {
      listeningForRef.current = null;
      setListeningFor(null);
    }
  }, [settingsOpen, mode]);

  useEffect(() => {
    const handleBlur = () => {
      if ((mode === "online" || mode === "online2v2") && onlineMatchRef.current?.matchId) {
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
      const pool = sfxAudioPoolRef.current[name];
      let audio = null;
      if (pool?.length) {
        const startIndex = sfxAudioIndexRef.current[name] || 0;
        audio = pool.find((item) => item.paused || item.ended);
        if (!audio && pool.length < 12) {
          audio = new Audio(url);
          audio.preload = "auto";
          pool.push(audio);
        }
        if (!audio) audio = pool[startIndex % pool.length];
        sfxAudioIndexRef.current[name] = (startIndex + 1) % pool.length;
      } else {
        audio = new Audio(url);
      }
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0.65 * (sfxVolumeRef.current / 100);
      audio.play().catch(() => {});
    } catch {}
  };

  const getAuthToken = () => token || (typeof localStorage !== "undefined" ? localStorage.getItem("rgb_token") : null);

  const refreshFriends = () => {
    const authToken = getAuthToken();
    if (!authToken) return;
    setFriendsLoading(true);
    api.getFriends(authToken).then((data) => {
      setFriendsData({
        incoming: Array.isArray(data?.incoming) ? data.incoming : [],
        outgoing: Array.isArray(data?.outgoing) ? data.outgoing : [],
        friends: Array.isArray(data?.friends) ? data.friends : [],
        private1v1Requests: Array.isArray(data?.private1v1Requests) ? data.private1v1Requests : [],
        private2v2Requests: Array.isArray(data?.private2v2Requests) ? data.private2v2Requests : [],
        online2v2Requests: Array.isArray(data?.online2v2Requests) ? data.online2v2Requests : [],
        acceptedInvites: Array.isArray(data?.acceptedInvites) ? data.acceptedInvites : [],
      });
      setFriendsMessage("");
    }).catch((err) => {
      setFriendsMessage(err?.error || "Could not load friends.");
    }).finally(() => setFriendsLoading(false));
  };

  const respondToFriendRequest = (requestId, action) => {
    playSfx(action === "accept" ? "menu_select" : "menu_back");
    const authToken = getAuthToken();
    if (!authToken) return;
    api.respondFriendRequest(authToken, requestId, action).then(() => {
      setFriendsMessage(action === "accept" ? "Friend request accepted." : "Friend request declined.");
      refreshFriends();
    }).catch((err) => {
      setFriendsMessage(err?.error || "Could not update friend request.");
    });
  };

  const unfriendUser = (friendId, username) => {
    playSfx("menu_back");
    const authToken = getAuthToken();
    if (!authToken) return;
    api.unfriend(authToken, friendId).then(() => {
      setFriendsMessage(`Removed ${username} from your friends.`);
      refreshFriends();
    }).catch((err) => {
      setFriendsMessage(err?.error || "Could not unadd friend.");
    });
  };

  const sendInviteToFriend = (friendId, username, inviteType) => {
    playSfx("menu_select");
    const authToken = getAuthToken();
    if (!authToken) return;
    api.sendGameInvite(authToken, friendId, inviteType).then(() => {
      const label = inviteType === "private1v1" ? "Private 1v1" : inviteType === "private2v2" ? "Private 2v2" : "2v2 Online";
      setFriendsMessage(`${label} request sent to ${username}.`);
      refreshFriends();
    }).catch((err) => {
      setFriendsMessage(err?.error || "Could not send invite.");
    });
  };

  const respondToGameInvite = (inviteId, action) => {
    playSfx(action === "accept" ? "menu_select" : "menu_back");
    const authToken = getAuthToken();
    if (!authToken) return;
    api.respondGameInvite(authToken, inviteId, action).then((data) => {
      const label = data?.inviteType === "private1v1" ? "Private 1v1" : data?.inviteType === "private2v2" ? "Private 2v2" : "2v2 Online";
      if (action === "accept" && data?.inviteType === "private1v1") {
        pendingPrivateInviteRef.current = { inviteId: data.inviteId, inviteType: data.inviteType };
        setFriendsMessage(`${label} accepted. Open Online 1v1 and press Join Private Match.`);
        setMode("online");
        setMenuStep("comingsoon");
      } else if (action === "accept" && (data?.inviteType === "private2v2" || data?.inviteType === "online2v2")) {
        pendingTeamInviteRef.current = { inviteId: data.inviteId, inviteType: data.inviteType };
        setFriendsMessage(`${label} accepted. Open 2v2 Online and press Join Team Queue.`);
        setMode("online2v2");
        setMenuStep("online2v2");
      } else {
        setFriendsMessage(action === "accept" ? `${label} accepted. Match setup is next.` : `${label} declined.`);
      }
      refreshFriends();
    }).catch((err) => {
      setFriendsMessage(err?.error || "Could not update invite.");
    });
  };

  useEffect(() => {
    if (mode !== "friends" || menuStep !== "friends") return;
    refreshFriends();
    const interval = window.setInterval(refreshFriends, 5000);
    return () => window.clearInterval(interval);
  }, [mode, menuStep, token]);

  useEffect(() => {
    const privateInvite = friendsData.acceptedInvites.find((invite) => invite.invite_type === "private1v1");
    if (!privateInvite || pendingPrivateInviteRef.current?.inviteId === privateInvite.id) return;
    pendingPrivateInviteRef.current = { inviteId: privateInvite.id, inviteType: privateInvite.invite_type };
    setFriendsMessage(`Private 1v1 accepted by ${privateInvite.username}. Open Online 1v1 and press Join Private Match.`);
  }, [friendsData.acceptedInvites]);

  useEffect(() => {
    const teamInvite = friendsData.acceptedInvites.find((invite) => invite.invite_type === "private2v2" || invite.invite_type === "online2v2");
    if (!teamInvite || pendingTeamInviteRef.current?.inviteId === teamInvite.id) return;
    pendingTeamInviteRef.current = { inviteId: teamInvite.id, inviteType: teamInvite.invite_type };
    const label = teamInvite.invite_type === "private2v2" ? "Private 2v2" : "2v2 Online";
    setFriendsMessage(`${label} accepted by ${teamInvite.username}. Open 2v2 Online and press Join Team Queue.`);
  }, [friendsData.acceptedInvites]);

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

  const isEditableEventTarget = (target) => {
    const tag = String(target?.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!target?.isContentEditable;
  };

  const XBOX_INPUT_LABELS = {
    "xbox:a": "A",
    "xbox:b": "B",
    "xbox:x": "X",
    "xbox:y": "Y",
    "xbox:lb": "LB",
    "xbox:rb": "RB",
    "xbox:lt": "LT",
    "xbox:rt": "RT",
    "xbox:view": "View",
    "xbox:menu": "Menu",
    "xbox:left-stick": "Left Stick Press",
    "xbox:right-stick": "Right Stick Press",
    "xbox:dpad-up": "D-Pad Up",
    "xbox:dpad-down": "D-Pad Down",
    "xbox:dpad-left": "D-Pad Left",
    "xbox:dpad-right": "D-Pad Right",
    "xbox:left-stick-left": "Left Stick Left",
    "xbox:left-stick-right": "Left Stick Right",
    "xbox:left-stick-up": "Left Stick Up",
    "xbox:left-stick-down": "Left Stick Down",
    "xbox:right-stick-left": "Right Stick Left",
    "xbox:right-stick-right": "Right Stick Right",
    "xbox:right-stick-up": "Right Stick Up",
    "xbox:right-stick-down": "Right Stick Down",
  };

  const prettyControllerInput = (input) => XBOX_INPUT_LABELS[input] || "Unbound";

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

  const clearControllerInputFromBindSet = (bindSet, inputToRemove) => {
    const next = { ...bindSet };

    for (const action of Object.keys(next)) {
      if (next[action] === inputToRemove) {
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

  const applyNewControllerBinding = (action, input) => {
    if (!input) return;

    keysPressed.current = {};
    setP1ControllerBinds((prev) => {
      const next = clearControllerInputFromBindSet(prev, input);
      next[action] = input;
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!settingsOpen) return;

      const target = listeningForRef.current;
      if (!target) return;
      if (target.type === "controller") return;

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
    const buttonTokens = [
      "xbox:a",
      "xbox:b",
      "xbox:x",
      "xbox:y",
      "xbox:lb",
      "xbox:rb",
      "xbox:lt",
      "xbox:rt",
      "xbox:view",
      "xbox:menu",
      "xbox:left-stick",
      "xbox:right-stick",
      "xbox:dpad-up",
      "xbox:dpad-down",
      "xbox:dpad-left",
      "xbox:dpad-right",
    ];
    const axisTokens = [
      "xbox:left-stick-left",
      "xbox:left-stick-right",
      "xbox:left-stick-up",
      "xbox:left-stick-down",
      "xbox:right-stick-left",
      "xbox:right-stick-right",
      "xbox:right-stick-up",
      "xbox:right-stick-down",
    ];
    const allTokens = [...buttonTokens, ...axisTokens];
    const buttonMap = {
      0: "xbox:a",
      1: "xbox:b",
      2: "xbox:x",
      3: "xbox:y",
      4: "xbox:lb",
      5: "xbox:rb",
      6: "xbox:lt",
      7: "xbox:rt",
      8: "xbox:view",
      9: "xbox:menu",
      10: "xbox:left-stick",
      11: "xbox:right-stick",
      12: "xbox:dpad-up",
      13: "xbox:dpad-down",
      14: "xbox:dpad-left",
      15: "xbox:dpad-right",
    };

    const readPressed = () => {
      const gamepads = typeof navigator !== "undefined" && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const gamepad = gamepads.find(Boolean);
      const pressed = {};
      if (!gamepad) return pressed;

      for (const [index, token] of Object.entries(buttonMap)) {
        const button = gamepad.buttons[Number(index)];
        if (button?.pressed || button?.value > 0.5) pressed[token] = true;
      }

      const leftX = gamepad.axes[0] || 0;
      const leftY = gamepad.axes[1] || 0;
      const rightX = gamepad.axes[2] || 0;
      const rightY = gamepad.axes[3] || 0;
      const deadzone = 0.5;

      if (leftX < -deadzone) pressed["xbox:left-stick-left"] = true;
      if (leftX > deadzone) pressed["xbox:left-stick-right"] = true;
      if (leftY < -deadzone) pressed["xbox:left-stick-up"] = true;
      if (leftY > deadzone) pressed["xbox:left-stick-down"] = true;
      if (rightX < -deadzone) pressed["xbox:right-stick-left"] = true;
      if (rightX > deadzone) pressed["xbox:right-stick-right"] = true;
      if (rightY < -deadzone) pressed["xbox:right-stick-up"] = true;
      if (rightY > deadzone) pressed["xbox:right-stick-down"] = true;

      return pressed;
    };

    let frameId = 0;
    const tick = () => {
      const pressed = readPressed();
      const previousPressed = previousGamepadPressedRef.current;

      for (const token of allTokens) {
        keysPressed.current[token] = !!pressed[token];
      }

      const target = listeningForRef.current;
      if (target?.type === "controller") {
        const newlyPressed = allTokens.find((token) => pressed[token] && !previousPressed[token]);
        if (newlyPressed) {
          applyNewControllerBinding(target.action, newlyPressed);
          listeningForRef.current = null;
          setListeningFor(null);
          keysPressed.current = {};
        }
      } else if (
        menuStep === "playing" &&
        mode !== "online" &&
        mode !== "online2v2" &&
        pressed["xbox:menu"] &&
        !previousPressed["xbox:menu"]
      ) {
        setSettingsOpen((open) => !open);
      }

      if ((mode === "online" || mode === "online2v2") && menuStep === "playing" && onlineMatchRef.current?.matchId) {
        const actions = {};
        const binds = p1ControllerBindsRef.current || {};
        for (const action of Object.keys(ACTION_LABELS)) {
          const token = binds[action];
          actions[action] = !!(token && pressed[token]);
        }

        const previousActions = previousGamepadActionsRef.current;
        const changed = Object.keys(ACTION_LABELS).some((action) => actions[action] !== previousActions[action]);
        if (changed) {
          previousGamepadActionsRef.current = actions;
          sendOnlineInputs();
        }
      }

      previousGamepadPressedRef.current = pressed;
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [mode, menuStep]);

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
    menuStepRef.current = menuStep;
  }, [menuStep]);
  useEffect(() => {
    gameOverRef.current = gameOver;
  }, [gameOver]);
  useEffect(() => {
    matchWinnerTextRef.current = matchWinnerText;
  }, [matchWinnerText]);
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
  const FIGHTER_COLORS = ["red", "blue", "green", "black", "white", "purple", "yellow", "orange", "gray"];
  const SECRET_FIGHTER_COLORS = ["brown", "pink"];
  const ONLINE_FIGHTER_COLORS = [...FIGHTER_COLORS, ...SECRET_FIGHTER_COLORS];
  const RAINBOW_SUMMON_COLORS = [...FIGHTER_COLORS, ...SECRET_FIGHTER_COLORS];
  const LADDER_POOL_COLORS = [...FIGHTER_COLORS, ...SECRET_FIGHTER_COLORS];
  const RAINBOW_COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#f8fafc"];
  const MONOCHROME_COLORS = ["#020617", "#4b5563", "#9ca3af", "#f8fafc"];
  const TRANSPARENT_COLORS = ["#f8fafc", "#e5e7eb", "#d1d5db", "#cbd5e1"];
  const LADDER_TOTAL_MATCHES = 10;
  const LADDER_SUBBOSS_INDEX = 8;
  const LADDER_BOSS_INDEX = 9;
  const randColor = () => randPick(FIGHTER_COLORS);
  const randRainbowSummonColor = () => randPick(RAINBOW_SUMMON_COLORS);
  const isRainbowUser = (name) => String(name || "") === "Rainbow";
  const isMonochromeUser = (name) => String(name || "") === "Monochrome";
  const isTransparentUser = (name) => String(name || "") === "Transparent";
  const getLockedSecretColor = (name) => isRainbowUser(name) ? "rainbow" : isMonochromeUser(name) ? "monochrome" : isTransparentUser(name) ? "transparent" : null;
  const OFFLINE_ACHIEVEMENT_KEYS = FIGHTER_COLORS.map((color) => `ladder:${color}:hard`);
  const hasAchievementKey = (key) => achievements.includes(key);
  const hasAllOfflineAchievements = OFFLINE_ACHIEVEMENT_KEYS.every(hasAchievementKey);
  const hasBrownUnlocked = !!user && hasAllOfflineAchievements;
  const hasPinkUnlocked = !!user && hasAllOfflineAchievements && (Number(user?.wins) || 0) >= 50;
  const canUseColor = (color) => color !== "brown" && color !== "pink" ? true : color === "brown" ? hasBrownUnlocked : hasPinkUnlocked;
  const lockTextForColor = (color) => color === "brown"
    ? "Complete Every Ladder Achievement To Unlock"
    : color === "pink"
    ? "Complete Every Achievement Except Rainbow Slayer To Unlock"
    : "";
  const selectableColorsForCurrentMode = () => ONLINE_FIGHTER_COLORS;
  const formatWlrValue = (wins, losses, fallback) => {
    const ratio = typeof fallback !== "undefined" ? Number(fallback) : (Number(wins) || 0) / Math.max(1, Number(losses) || 0);
    return Number.isFinite(ratio) ? ratio.toFixed(2) : "0.00";
  };
  const currentRecord = `${Number(user?.wins) || 0}W - ${Number(user?.losses) || 0}L`;
  const currentWlr = formatWlrValue(user?.wins, user?.losses, userRank?.wlr);

  useEffect(() => {
    if (mode !== "ladder" || !gameOver || matchWinnerText !== "Team 1" || ladderIndex !== LADDER_BOSS_INDEX) return;
    const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("rgb_token") : null);
    if (!authToken || !p1Color || difficulty !== "hard") return;

    const achievementKey = `ladder:${p1Color}:${difficulty}`;
    if (ladderAchievementSentRef.current === achievementKey) return;
    ladderAchievementSentRef.current = achievementKey;

    api.unlockLadderAchievement(authToken, p1Color, difficulty)
      .then(refreshAchievements)
      .catch(() => {});
  }, [mode, gameOver, matchWinnerText, ladderIndex, p1Color, difficulty, token]);

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

    if (mode === "online2v2") {
      const match = onlineMatchRef.current || {};
      return {
        ...base,
        humans: [
          { slot: "p1", team: 1, color: match.p1Char || p1Color || "red", username: match.p1Username || onlinePlayerNames.p1 || "P1" },
          { slot: "p2", team: 1, color: match.p2Char || p2Color || "blue", username: match.p2Username || onlinePlayerNames.p2 || "P2" },
        ],
        ai: [
          { slot: "ai1", team: 2, color: match.e1Char || opp1Color || "green", dummy: false, aiDifficulty: "medium", username: match.e1Username || "Bot E1" },
          { slot: "ai2", team: 2, color: match.e2Char || opp2Color || "orange", dummy: false, aiDifficulty: "medium", username: match.e2Username || "Bot E2" },
        ],
        difficulty: "medium",
        stage: stage || "default",
      };
    }

    // Online match: construct humans from online-selected colors so the playing canvas initializes
    if (mode === "online") {
      // if p1/p2 colors are set from char-select or match:start, use them; otherwise pick defaults
      const c1 = p1Color || "red";
      const c2 = p2Color || "blue";
      const botMatch = !!onlineMatchRef.current?.bot;
      return {
        ...base,
        humans: [
          { slot: "p1", team: 1, color: c1, username: onlinePlayerNames.p1 },
          ...(botMatch ? [] : [{ slot: "p2", team: 2, color: c2, username: onlinePlayerNames.p2 }]),
        ],
        ai: botMatch ? [{ slot: "ai1", team: 2, color: c2, dummy: false, aiDifficulty: onlineMatchRef.current?.botDifficulty || "medium" }] : [],
        difficulty: onlineMatchRef.current?.botDifficulty || null,
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
      const isSubBoss = idx === LADDER_SUBBOSS_INDEX;
      const isLast = idx === LADDER_BOSS_INDEX;

      const oppColor = isLast ? "monochrome" : isSubBoss ? "transparent" : ladderOppOrder[idx] || randPick(LADDER_POOL_COLORS);
      const diffByStep = idx <= 0 ? "easy" : idx <= 3 ? "medium" : "hard";

      return {
        ...base,
        ladder: true,
        humans: [{ slot: "p1", team: 1, color: p1Color }],
        ai: [{ slot: "ai1", team: 2, color: oppColor, dummy: false }],
        difficulty: isLast ? "hard" : difficulty || diffByStep,
        stage: stage || "default",
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
    const controllerBinds = p1ControllerBindsRef.current || {};
    const actions = {};
    for (const action of Object.keys(ACTION_LABELS)) {
      const key = binds[action];
      const controllerInput = controllerBinds[action];
      actions[action] = !!keysPressed.current[key] || !!keysPressed.current[controllerInput];
    }

    socket.emit('input:send', { matchId, inputs: actions });
  };

  const sendOnlineStateSnapshot = () => {
    const matchId = onlineMatchRef.current?.matchId;
    const socket = socketRef.current;
    const isHost = onlineMatchRef.current?.host === true;
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
    onlineReturnScheduledRef.current = false;
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
      setMode(mode === "online2v2" ? "online2v2" : "online");
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
        maxHealth: p.maxHealth,
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
        poisonSlowTimer: p.poisonSlowTimer,
        poisoned: p.poisoned,
        poisonTicksLeft: p.poisonTicksLeft,
        poisonTickTimer: p.poisonTickTimer,
        healing: p.healing,
        healTickTimer: p.healTickTimer,
        canProjectile: p.canProjectile,
        canSpecial2: p.canSpecial2,
        canSpecial3: p.canSpecial3,
        dashTimer: p.dashTimer,
        dashHasHit: p.dashHasHit,
        charging: p.charging,
        chargeFrames: p.chargeFrames,
        purpleCharging: p.purpleCharging,
        purpleChargeTimer: p.purpleChargeTimer,
        orangeCharging: p.orangeCharging,
        orangeChargeTimer: p.orangeChargeTimer,
        blackCharging: p.blackCharging,
        blackChargeTimer: p.blackChargeTimer,
        rainbowTurretTimer: p.rainbowTurretTimer,
        rainbowTurretShotTimer: p.rainbowTurretShotTimer,
        rainbowSummonId: p.rainbowSummonId,
        isSummon: p.isSummon,
        speedBoostTimer: p.speedBoostTimer,
        cooldownBoostTimer: p.cooldownBoostTimer,
        damageAmpTimer: p.damageAmpTimer,
        snowflakeExpiries: p.snowflakeExpiries,
        damageReducedTimer: p.damageReducedTimer,
        special3VisualTimer: p.special3VisualTimer,
        special3RollTimer: p.special3RollTimer,
        special3HasHit: p.special3HasHit,
        yellowWaveChargeTimer: p.yellowWaveChargeTimer,
        yellowWaveTargetX: p.yellowWaveTargetX,
        shotgunVisualTimer: p.shotgunVisualTimer,
        shotgunVisualDownward: p.shotgunVisualDownward,
        harpoonTargetId: p.harpoonTargetId,
        harpoonPullTimer: p.harpoonPullTimer,
        grayPeakId: p.grayPeakId,
        brownMorphHealth: p.brownMorphHealth,
        brownOriginalForm: p.brownOriginalForm,
        pinkTeleportMarker: p.pinkTeleportMarker,
        pinkTeleportArmTimer: p.pinkTeleportArmTimer,
        pinkTeleportExplosionTimer: p.pinkTeleportExplosionTimer,
        thrownById: p.thrownById,
        thrownLandingPending: p.thrownLandingPending,
        thrownDirection: p.thrownDirection,
        spearLocked: p.spearLocked,
        spearStunned: p.spearStunned,
        spearStunTimer: p.spearStunTimer,
        monochromeStunned: p.monochromeStunned,
        monochromeStunTimer: p.monochromeStunTimer,
        transparentStunned: p.transparentStunned,
        transparentStunTimer: p.transparentStunTimer,
        transparentBurrowing: p.transparentBurrowing,
        transparentBurrowTimer: p.transparentBurrowTimer,
        transparentStrikeTimer: p.transparentStrikeTimer,
        transparentPoundChargeTimer: p.transparentPoundChargeTimer,
        transparentPoundActiveTimer: p.transparentPoundActiveTimer,
        grayHammerTimer: p.grayHammerTimer,
        grayHammerRotation: p.grayHammerRotation,
        pinkParrying: p.pinkParrying,
        pinkParryTimer: p.pinkParryTimer,
        pinkParryDucking: p.pinkParryDucking,
        brownPhasing: p.brownPhasing,
        brownStunned: p.brownStunned,
        brownStunTimer: p.brownStunTimer,
        brownCharging: p.brownCharging,
        brownChargeTimer: p.brownChargeTimer,
        brownInvulnTimer: p.brownInvulnTimer,
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
        damage: proj.damage,
        homing: proj.homing,
        speed: proj.speed,
        reflected: proj.reflected,
        trackXOnly: proj.trackXOnly,
        gravity: proj.gravity,
        passesPlatforms: proj.passesPlatforms,
        additiveKnockback: proj.additiveKnockback,
        lifeFrames: proj.lifeFrames,
        bounceCount: proj.bounceCount,
        width: proj.width,
        height: proj.height,
        health: proj.health,
        id: proj.id,
        phaseOwnerId: proj.phaseOwner?.id || proj.phaseOwnerId,
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
      let fighter = fighters.find((p) => p.id === data.id);
      if (!fighter) {
        fighter = {
          ...data,
          bindsRef: null,
          hitbox: data.hitbox || { x: 0, y: 0, width: 0, height: 0 },
          hurtbox: data.hurtbox || { x: 0, y: 0, width: 40, height: 60 },
        };
        fighters.push(fighter);
      }
      Object.assign(fighter, data);
      fighter.hitbox = data.hitbox || fighter.hitbox || { x: 0, y: 0, width: 0, height: 0 };
      fighter.hurtbox = data.hurtbox || fighter.hurtbox || { x: 0, y: 0, width: 40, height: 60 };
    }

    projectiles.current = (snapshot.projectiles || []).map((proj) => ({
      ...proj,
      owner: null,
      phaseOwner: proj.phaseOwnerId ? (fightersRef.current || []).find((p) => p.id === proj.phaseOwnerId) || null : null,
    }));
  };

  useEffect(() => {
    const match = onlineMatchRef.current;
    const isViewer = (mode === "online" || mode === "online2v2") && menuStep === "playing" && match?.matchId && !match.host;
    if (!isViewer) return;

    let cancelled = false;

    const pollOnlineState = async () => {
      const activeMatch = onlineMatchRef.current;
      if (!activeMatch?.matchId || activeMatch.host) return;

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

  const isAnyOnlineMode = (mode === "online" || mode === "online2v2") && onlineMatchRef.current?.matchId;
  const onlineLocalTeam = isAnyOnlineMode
    ? onlineMatchRef.current.side === "left"
      ? 1
      : 2
    : null;
  const onlineLocalSlot = isAnyOnlineMode ? (onlineMatchRef.current.slot || (onlineMatchRef.current.side === "left" ? "p1" : "p2")) : null;

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
    setLadderExitConfirmOpen(false);
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
    ladderAchievementSentRef.current = "";

    resetAll();
  };

  const startModeFlow = (m) => {
    playSfx("menu_select");
    setLadderExitConfirmOpen(false);
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
    ladderAchievementSentRef.current = "";

    resetAll();

    if (m === "login") {
      setMenuStep("login");
      return;
    }

    if (m === "online") {
      setMenuStep("comingsoon");
      return;
    }

    if (m === "online2v2") {
      if (!user && !getAuthToken()) {
        setMode("login");
        setMenuStep("login");
        return;
      }
      setMenuStep("comingsoon");
      return;
    }

    if (m === "friends") {
      if (!user && !getAuthToken()) {
        setMode("login");
        setMenuStep("login");
        return;
      }
      refreshFriends();
      setMenuStep("friends");
      return;
    }

    if (m === "achievements") {
      refreshAchievements();
      setMenuStep("achievements");
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
      setStage(randStage());
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

    const DARK_VARIANT = { red: "#b91c1c", blue: "#1d4ed8", green: "#15803d", black: "#111827", white: "#cbd5e1", purple: "#7e22ce", yellow: "#ca8a04", orange: "#c2410c", gray: "#d1d5db", brown: "#451a03", pink: "#be185d" };

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
          case "gray":
            return { hex: "#6b7280", name: "Gray", type: "gray" };
          case "rainbow":
            return { hex: "#ec4899", name: "Rainbow", type: "rainbow" };
          case "monochrome":
            return { hex: "#6b7280", name: "Monochrome", type: "monochrome" };
          case "transparent":
            return { hex: "#e5e7eb", name: "Transparent", type: "transparent" };
          case "brown":
            return { hex: "#92400e", name: "Brown", type: "brown" };
          case "pink":
            return { hex: "#ec4899", name: "Pink", type: "pink" };
          default:
            return { hex: "#ef4444", name: "Red", type: "fire" };
        }
      })();
      const hex = variant === "dark" ? DARK_VARIANT[color] || base.hex : base.hex;
      return { ...base, hex, light: toRGBA(hex, 0.75) };
    };

    const difficultySettings = {
      easy: {
        reactionTime: 20,
        observationJitter: 10,
        defenseReaction: 9,
        attackChance: 0.78,
        blockChance: 0.46,
        projectileBlockChance: 0.66,
        specialChance: 0.46,
        punishChance: 0.56,
        antiAirChance: 0.5,
        jumpChance: 0.22,
        accuracy: 0.74,
        aggression: 1,
        neutralPressureChance: 0.64,
        mistakeChance: 0.16,
        spacing: 96,
        meleeRange: 96,
        retreatRange: 49,
        projectileRange: 190,
        projectileReactRange: 275,
        healHealth: 62,
        healSafeDistance: 265,
        chargeMinFrames: 42,
        chargeMaxFrames: 108,
        stuckFrames: 96,
        escapeChance: 0.68,
        adaptRate: 0.58,
        counterplay: 0.68,
        campingFrames: 165,
        inputReadChance: 0.3,
        projectileAdvanceChance: 0.42,
        targetLag: 0.105,
        aimError: 38,
        verticalError: 19,
        offenseBias: 0.92,
        defenseBias: 0.8,
        maxDefenseHold: 24,
        maxLockFrames: 138,
        attackCooldown: 14,
        specialCooldown: 60,
        blockCooldown: 34,
        jumpCooldown: 58,
        movementCommit: 26,
        maxRepeat: 3,
      },
      medium: {
        reactionTime: 10,
        observationJitter: 6,
        defenseReaction: 5,
        attackChance: 0.92,
        blockChance: 0.67,
        projectileBlockChance: 0.82,
        specialChance: 0.64,
        punishChance: 0.82,
        antiAirChance: 0.76,
        jumpChance: 0.34,
        accuracy: 0.89,
        aggression: 1.18,
        neutralPressureChance: 0.8,
        mistakeChance: 0.06,
        spacing: 82,
        meleeRange: 102,
        retreatRange: 43,
        projectileRange: 145,
        projectileReactRange: 350,
        healHealth: 74,
        healSafeDistance: 215,
        chargeMinFrames: 50,
        chargeMaxFrames: 120,
        stuckFrames: 66,
        escapeChance: 0.9,
        adaptRate: 0.9,
        counterplay: 0.94,
        campingFrames: 112,
        inputReadChance: 0.52,
        projectileAdvanceChance: 0.66,
        targetLag: 0.18,
        aimError: 20,
        verticalError: 11,
        offenseBias: 1.02,
        defenseBias: 0.93,
        maxDefenseHold: 20,
        maxLockFrames: 118,
        attackCooldown: 8,
        specialCooldown: 42,
        blockCooldown: 23,
        jumpCooldown: 43,
        movementCommit: 18,
        maxRepeat: 3,
      },
      hard: {
        reactionTime: 6,
        observationJitter: 4,
        defenseReaction: 3,
        attackChance: 0.98,
        blockChance: 0.78,
        projectileBlockChance: 0.9,
        specialChance: 0.82,
        punishChance: 0.93,
        antiAirChance: 0.9,
        jumpChance: 0.46,
        accuracy: 0.95,
        aggression: 1.34,
        neutralPressureChance: 0.94,
        mistakeChance: 0.025,
        spacing: 72,
        meleeRange: 108,
        retreatRange: 38,
        projectileRange: 120,
        projectileReactRange: 410,
        healHealth: 82,
        healSafeDistance: 180,
        chargeMinFrames: 56,
        chargeMaxFrames: 130,
        stuckFrames: 48,
        escapeChance: 0.97,
        adaptRate: 1.08,
        counterplay: 1,
        campingFrames: 78,
        inputReadChance: 0.75,
        projectileAdvanceChance: 0.84,
        targetLag: 0.24,
        aimError: 11,
        verticalError: 6,
        offenseBias: 1.07,
        defenseBias: 0.97,
        maxDefenseHold: 16,
        maxLockFrames: 104,
        attackCooldown: 5,
        specialCooldown: 30,
        blockCooldown: 17,
        jumpCooldown: 34,
        movementCommit: 12,
        maxRepeat: 3,
      },
    };

    const aiSettings = difficultySettings[gameConfig.difficulty || "easy"];
    const getAiSettings = (ai) => ai?.aiDifficulty ? difficultySettings[ai.aiDifficulty] || aiSettings : aiSettings;

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
        remoteSlot: opts.remoteSlot || null,
        bindsRef,
        dummy: !!dummy,
        alive: true,
        x,
        y,
        width: 40,
        height: 60,
        vx: 0,
        vy: 0,
        maxHealth: opts.maxHealth || (data.type === "rainbow" ? 150 : data.type === "monochrome" ? 120 : 100),
        health: opts.health || (data.type === "rainbow" ? 150 : data.type === "monochrome" ? 120 : 100),
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
        poisonSlowTimer: 0,
        poisoned: false,
        poisonTicksLeft: 0,
        poisonTickTimer: 0,
        poisonOwnerId: null,
        healing: false,
        healTickTimer: 0,
        canProjectile: true,
        canSpecial2: true,
        canSpecial3: true,
        dashTimer: 0,
        dashHasHit: false,
        charging: false,
        chargeFrames: 0,
        purpleCharging: false,
        purpleChargeTimer: 0,
        orangeCharging: false,
        orangeChargeTimer: 0,
        blackCharging: false,
        blackChargeTimer: 0,
        rainbowTurretTimer: 0,
        rainbowTurretShotTimer: 0,
        rainbowSummonId: null,
        isSummon: !!opts.isSummon,
        speedBoostTimer: 0,
        airJumpsUsed: 0,
        jumpWasHeld: false,
        special2WasHeld: false,
        special3WasHeld: false,
        cooldownBoostTimer: 0,
        damageAmpTimer: 0,
        snowflakeExpiries: [],
        damageReducedTimer: 0,
        special3VisualTimer: 0,
        special3RollTimer: 0,
        special3HasHit: false,
        yellowWaveChargeTimer: 0,
        yellowWaveTargetX: 0,
        shotgunVisualTimer: 0,
        shotgunVisualDownward: false,
        harpoonTargetId: null,
        harpoonPullTimer: 0,
        harpoonCooldownPending: false,
        grayPeakId: null,
        brownMorphHealth: 0,
        brownOriginalForm: null,
        pinkTeleportMarker: null,
        pinkTeleportArmTimer: 0,
        pinkTeleportExplosionTimer: 0,
        thrownById: null,
        thrownLandingPending: false,
        thrownDirection: 0,
        spearLocked: false,
        spearStunned: false,
        spearStunTimer: 0,
        monochromeStunned: false,
        monochromeStunTimer: 0,
        transparentStunned: false,
        transparentStunTimer: 0,
        transparentBurrowing: false,
        transparentBurrowTimer: 0,
        transparentStrikeTimer: 0,
        transparentPoundChargeTimer: 0,
        transparentPoundActiveTimer: 0,
        transparentPoundHitIds: {},
        grayHammerTimer: 0,
        grayHammerRotation: 0,
        grayHammerHitIds: {},
        pinkParrying: false,
        pinkParryTimer: 0,
        pinkParryDucking: false,
        brownPhasing: false,
        brownStunned: false,
        brownStunTimer: 0,
        brownCharging: false,
        brownChargeTimer: 0,
        brownInvulnTimer: 0,
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
        inputIntentRevision: 0,
        inputIntentAction: "",
        inputIntentAt: 0,
        aiTimer: 0,
        aiDifficulty: opts.aiDifficulty || null,
        aiAction: "idle",
        aiActionTimer: 0,
        aiPressureTimer: 0,
        aiPressureHits: 0,
        aiBlockHoldTimer: 0,
        aiGuardPressure: 0,
        aiCornerEscapeCooldown: 0,
        aiHeadStackTimer: 0,
        aiStackEscapeCooldown: 0,
        aiComboTimer: 0,
        aiComboHits: 0,
        aiObservedTargetId: null,
        aiObservedTargetX: null,
        aiObservedTargetY: null,
        aiPerceivedTargetX: x,
        aiPerceivedTargetY: y,
        aiAimOffsetX: 0,
        aiAimOffsetY: 0,
        aiAimDriftTimer: 0,
        aiObservationTimer: 0,
        aiObservationRevision: 0,
        aiLastReadRevision: -1,
        aiLastInputTargetId: null,
        aiLastInputRevision: 0,
        aiReadInputAction: "",
        aiObservedState: null,
        aiIncomingProjectile: null,
        aiIncomingProjectileFrames: 0,
        aiEmergencyProjectile: null,
        aiProjectileMisses: 0,
        aiLastReadProjectile: null,
        aiAttackReactionTimer: 0,
        aiDefenseRollRevision: -1,
        aiDefendedProjectile: null,
        aiTargetStillTimer: 0,
        aiLevelPathTimer: 0,
        aiDropDir: 0,
        aiDropCommitTimer: 0,
        aiClimbTargetKey: "",
        aiClimbTargetX: 0,
        aiClimbLandingX: 0,
        aiLastX: x,
        aiLastY: y,
        aiStuckTimer: 0,
        aiEscapeTimer: 0,
        aiEscapeDir: 0,
        aiRecoveryDir: 0,
        aiRecoveryTimer: 0,
        aiLastMoveDirection: 0,
        aiDirectionChangeCount: 0,
        aiDirectionChangeTimer: 0,
        aiOscillationLockTimer: 0,
        aiOscillationDir: 0,
        aiLastAbilityTimer: 0,
        aiActionCooldowns: {
          attack: 0,
          special: 0,
          block: 0,
        },
        aiActionHistory: [],
        aiRepeatAction: "",
        aiRepeatCount: 0,
        aiLockTimer: 0,
        aiDefenseTimer: 0,
        aiDefenseCooldown: 0,
        aiBlockHeight: "mid",
        aiOffenseTimer: 0,
        aiJumpCooldown: 0,
        aiJumpLoopCooldown: 0,
        aiLastJumpAction: "",
        aiSameJumpCount: 0,
        aiGroundedStableTimer: 0,
        aiFailedClimbCooldown: 0,
        aiJumpStartPlatformKey: "",
        aiJumpTargetPlatformKey: "",
        aiFailedJumpCount: 0,
        aiAvoidPlatformKey: "",
        aiAvoidPlatformTimer: 0,
        aiPlatformHistory: [],
        aiLastPlatformKey: "",
        aiPlatformLoopLockTimer: 0,
        aiVerticalRouteCooldown: 0,
        aiLastVerticalAction: "",
        aiVerticalHold: false,
        aiRead: {
          rush: 0,
          turtle: 0,
          airborne: 0,
          projectile: 0,
          low: 0,
          retreat: 0,
          camping: 0,
        },
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
              aiDifficulty: o.aiDifficulty || gameConfig.difficulty || null,
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

      const online2v2Active = mode === "online2v2" && !!onlineMatchRef.current?.matchId;
      fighters.push(makeFighter({
        id: "p1",
        team: 1,
        isHuman: true,
        bindsRef: p1BindsRef,
        data: p1Data,
        x: 120,
        y: groundLevel - 60,
        facing: 1,
        label: "P1",
        playerName: p1.username,
        remoteSlot: online2v2Active && onlineLocalSlot !== "p1" ? "p1" : null,
      }));
      fighters.push(makeFighter({
        id: "p2",
        team: 1,
        isHuman: true,
        bindsRef: online2v2Active ? p1BindsRef : p2BindsRef,
        data: p2Data,
        x: 220,
        y: groundLevel - 60,
        facing: 1,
        label: "P2",
        playerName: p2.username,
        remoteSlot: online2v2Active && onlineLocalSlot !== "p2" ? "p2" : null,
      }));

      fighters.push(makeFighter({ id: "ai1", team: 2, isHuman: false, bindsRef: null, data: e1Data, x: 650, y: groundLevel - 60, facing: -1, label: "E1", playerName: e1.username, aiDifficulty: e1.aiDifficulty || gameConfig.difficulty || null }));
      fighters.push(makeFighter({ id: "ai2", team: 2, isHuman: false, bindsRef: null, data: e2Data, x: 760, y: groundLevel - 60, facing: -1, label: "E2", playerName: e2.username, aiDifficulty: e2.aiDifficulty || gameConfig.difficulty || null }));
    };

    spawn();
    fightersRef.current = fighters;

    const removeSummons = () => {
      for (let i = fighters.length - 1; i >= 0; i--) {
        if (fighters[i].isSummon) fighters.splice(i, 1);
      }
    };

    const resetAiNavigationState = () => {
      for (const p of fighters) {
        if (p.isHuman || p.dummy) continue;
        Object.assign(p, {
          grounded: true,
          aiHeadStackTimer: 0,
          aiStackEscapeCooldown: 0,
          aiEscapeTimer: 0,
          aiEscapeDir: 0,
          aiRecoveryDir: 0,
          aiRecoveryTimer: 0,
          aiLastMoveDirection: 0,
          aiDirectionChangeCount: 0,
          aiDirectionChangeTimer: 0,
          aiOscillationLockTimer: 0,
          aiOscillationDir: 0,
          aiJumpLoopCooldown: 0,
          aiLastJumpAction: "",
          aiSameJumpCount: 0,
          aiGroundedStableTimer: 0,
          aiFailedJumpCount: 0,
          aiFailedClimbCooldown: 0,
          aiAvoidPlatformKey: "",
          aiAvoidPlatformTimer: 0,
          aiPlatformHistory: [],
          aiLastPlatformKey: "",
          aiPlatformLoopLockTimer: 0,
          aiVerticalRouteCooldown: 0,
          aiLastVerticalAction: "",
          aiVerticalHold: false,
          aiClimbTargetKey: "",
          aiClimbTargetX: 0,
          aiClimbLandingX: 0,
          aiDropCommitTimer: 0,
          aiDropDir: 0,
          aiLevelPathTimer: 0,
        });
      }
    };

    const resetPositions = () => {
      removeSummons();
      if (!is2v2) {
        const f1 = fighters.find((f) => f.team === 1);
        const f2 = fighters.find((f) => f.team === 2);
        if (f1) Object.assign(f1, { x: 150, y: groundLevel - 60, vx: 0, vy: 0, facing: 1 });
        if (f2) Object.assign(f2, { x: 700, y: groundLevel - 60, vx: 0, vy: 0, facing: -1 });
        resetAiNavigationState();
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

      resetAiNavigationState();
      projectiles.current = [];
      keysPressed.current = {};
    };

    const refreshPractice = () => {
      if (mode !== "practice") return;

      for (const p of fighters) {
        if (p.team === 2 && p.dummy) {
          p.alive = true;
          p.health = p.maxHealth || 100;

          p.frozen = false;
          p.frozenTimer = 0;

          p.poisoned = false;
          p.poisonTicksLeft = 0;
          p.poisonTickTimer = 0;
          p.poisonOwnerId = null;

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
          p.poisonSlowTimer = 0;

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
          p.canSpecial3 = true;
          p.special2WasHeld = false;
          p.special3WasHeld = false;
          p.blackCharging = false;
          p.blackChargeTimer = 0;
          p.snowflakeExpiries = [];
          p.damageReducedTimer = 0;
          p.special3VisualTimer = 0;
          p.special3RollTimer = 0;
          p.special3HasHit = false;
          p.yellowWaveChargeTimer = 0;
          p.yellowWaveTargetX = 0;
          p.shotgunVisualTimer = 0;
          p.shotgunVisualDownward = false;
          p.harpoonTargetId = null;
          p.harpoonPullTimer = 0;
          p.grayPeakId = null;
          if (p.brownOriginalForm) Object.assign(p, p.brownOriginalForm);
          p.brownOriginalForm = null;
          p.brownMorphHealth = 0;
          p.pinkTeleportMarker = null;
          p.pinkTeleportArmTimer = 0;
          p.pinkTeleportExplosionTimer = 0;
          p.thrownById = null;
          p.thrownLandingPending = false;
          p.thrownDirection = 0;

          p.purpleCharging = false;
          p.purpleChargeTimer = 0;
          p.orangeCharging = false;
          p.orangeChargeTimer = 0;
          p.rainbowTurretTimer = 0;
          p.rainbowTurretShotTimer = 0;
          p.rainbowSummonId = null;
          p.speedBoostTimer = 0;
          p.airJumpsUsed = 0;
          p.jumpWasHeld = false;
          p.cooldownBoostTimer = 0;
          p.damageAmpTimer = 0;
          p.spearLocked = false;
          p.spearStunned = false;
          p.spearStunTimer = 0;
          p.monochromeStunned = false;
          p.monochromeStunTimer = 0;
          p.transparentStunned = false;
          p.transparentStunTimer = 0;
          p.transparentBurrowing = false;
          p.transparentBurrowTimer = 0;
          p.transparentStrikeTimer = 0;
          p.transparentPoundChargeTimer = 0;
          p.transparentPoundActiveTimer = 0;
          p.transparentPoundHitIds = {};
          p.grayHammerTimer = 0;
          p.grayHammerRotation = 0;
          p.grayHammerHitIds = {};
          p.pinkParrying = false;
          p.pinkParryTimer = 0;
          p.pinkParryDucking = false;
          p.brownPhasing = false;
          p.brownStunned = false;
          p.brownStunTimer = 0;
          p.brownCharging = false;
          p.brownChargeTimer = 0;
          p.brownInvulnTimer = 0;
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
      if (isEditableEventTarget(e.target)) return;
      if ((pausedRef.current && mode !== "online" && mode !== "online2v2") || listeningForRef.current) return;

      const k = normalizeBindKey(e.key);
      if (!k) return;

      keysPressed.current[k] = true;
      if ((mode === "online" || mode === "online2v2") && onlineMatchRef.current?.matchId && menuStep === "playing") {
        sendOnlineInputs();
      }
    };

    const handleKeyUp = (e) => {
      if (isEditableEventTarget(e.target)) return;
      const k = normalizeBindKey(e.key);
      if (!k) return;

      keysPressed.current[k] = false;
      if ((mode === "online" || mode === "online2v2") && onlineMatchRef.current?.matchId && menuStep === "playing") {
        sendOnlineInputs();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const breakFreezeIfNeeded = (def) => {
      if (def.frozen) {
        def.frozen = false;
        def.frozenTimer = 0;
        def.monochromeStunned = false;
        def.monochromeStunTimer = 0;
        def.transparentStunned = false;
        def.transparentStunTimer = 0;
        def.transparentBurrowing = false;
        def.transparentBurrowTimer = 0;
        def.transparentStrikeTimer = 0;
        def.transparentPoundChargeTimer = 0;
        def.transparentPoundActiveTimer = 0;
        def.transparentPoundHitIds = {};
        def.grayHammerTimer = 0;
        def.grayHammerRotation = 0;
        def.grayHammerHitIds = {};
        def.brownStunned = false;
        def.brownStunTimer = 0;
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
          case "purpleroll":
            hitboxWidth = 50;
            hitboxHeight = drawHeight;
            break;
          case "monochromegrab":
            hitboxWidth = 112;
            hitboxHeight = drawHeight * 0.48;
            hitboxY = drawY + drawHeight * 0.22;
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
        const feetCenterX = p.x + p.width / 2;
        if (feetCenterX >= plat.x && feetCenterX <= plat.x + plat.width && p.y + p.height >= plat.y && p.y + p.height <= plat.y + 20) {
          p.y = plat.y - p.height;
          p.vy = 0;
          p.grounded = true;
          p.airJumpsUsed = 0;
          if (!p.isHuman) {
            const landedKey = platformKey(plat);
            if (p.aiLastPlatformKey !== landedKey) {
              p.aiPlatformHistory = [...(p.aiPlatformHistory || []), landedKey].slice(-6);
              p.aiLastPlatformKey = landedKey;
              const history = p.aiPlatformHistory;
              const length = history.length;
              const isTwoPlatformLoop =
                length >= 4 &&
                history[length - 1] === history[length - 3] &&
                history[length - 2] === history[length - 4] &&
                history[length - 1] !== history[length - 2];

              if (isTwoPlatformLoop) {
                p.aiPlatformLoopLockTimer = 240;
                p.aiFailedClimbCooldown = Math.max(p.aiFailedClimbCooldown || 0, 180);
                p.aiClimbTargetKey = "";
                p.aiClimbTargetX = 0;
                p.aiClimbLandingX = 0;
                p.aiDropCommitTimer = 0;
                p.aiDropDir = 0;
                p.aiLevelPathTimer = 0;
                p.aiAction = "hold";
                p.aiActionTimer = 30;
              }
            }
            if (p.aiJumpStartPlatformKey && p.aiJumpTargetPlatformKey) {
              if (landedKey === p.aiJumpTargetPlatformKey) {
                p.aiFailedJumpCount = 0;
                if (p.aiAvoidPlatformKey === landedKey) {
                  p.aiAvoidPlatformKey = "";
                  p.aiAvoidPlatformTimer = 0;
                }
                p.aiLastJumpAction = "";
                p.aiSameJumpCount = 0;
              } else if (landedKey === p.aiJumpStartPlatformKey) {
                p.aiFailedJumpCount = (p.aiFailedJumpCount || 0) + 1;
                if (p.aiFailedJumpCount >= 2) {
                  p.aiAvoidPlatformKey = p.aiJumpTargetPlatformKey;
                  p.aiAvoidPlatformTimer = 240;
                  p.aiFailedClimbCooldown = 90;
                  p.aiClimbTargetKey = "";
                  p.aiClimbTargetX = 0;
                  p.aiClimbLandingX = 0;
                  p.aiLevelPathTimer = 0;
                  p.aiEscapeTimer = 24;
                  p.aiEscapeDir = p.facing || 1;
                }
              }
            }
            p.aiJumpStartPlatformKey = "";
            p.aiJumpTargetPlatformKey = "";
            if (p.aiClimbTargetKey && p.aiClimbTargetKey === landedKey) {
              p.aiClimbTargetKey = "";
              p.aiClimbTargetX = 0;
              p.aiClimbLandingX = 0;
              p.aiLevelPathTimer = 0;
            }
          }
          return;
        }
      }
    };

    const isSolidFighter = (p) => p?.alive && !p.brownPhasing && !p.transparentBurrowing;
    const solidTop = (p) => p.y + (p.ducking ? p.height * 0.4 : 0);
    const solidHeight = (p) => p.height - (p.ducking ? p.height * 0.4 : 0);

    const resolveSolidFighterCollisions = () => {
      const solidFighters = fighters.filter(isSolidFighter);

      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < solidFighters.length; i++) {
          for (let j = i + 1; j < solidFighters.length; j++) {
            const a = solidFighters[i];
            const b = solidFighters[j];
            const aTop = solidTop(a);
            const bTop = solidTop(b);
            const aHeight = solidHeight(a);
            const bHeight = solidHeight(b);
            const aBottom = aTop + aHeight;
            const bBottom = bTop + bHeight;
            const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);

            if (overlapX <= 0) continue;

            const aCenterY = aTop + aHeight / 2;
            const bCenterY = bTop + bHeight / 2;
            const upper = aCenterY <= bCenterY ? a : b;
            const lower = upper === a ? b : a;
            const lowerTop = lower === a ? aTop : bTop;
            const upperBottom = upper.y + upper.height;
            const headOverlap = upperBottom - lowerTop;
            const headGap = lowerTop - upperBottom;
            const canStandOnHead = upper.y < lower.y && upper.vy >= 0 && headGap <= 4 && headOverlap <= 24 && overlapX >= upper.width * 0.25;

            if (canStandOnHead) {
              upper.y = lowerTop - upper.height;
              upper.vy = 0;
              upper.grounded = true;
              upper.airJumpsUsed = 0;
              if (!lower.isHuman && !lower.dummy && upper.team !== lower.team) {
                lower.aiHeadStackTimer = 12;
              }
              continue;
            }

            if (overlapY <= 0) continue;

            const aCenterX = a.x + a.width / 2;
            const bCenterX = b.x + b.width / 2;
            const direction = aCenterX <= bCenterX ? -1 : 1;
            const push = overlapX / 2 + 0.01;
            a.x = Math.max(0, Math.min(WORLD_W - a.width, a.x + direction * push));
            b.x = Math.max(0, Math.min(WORLD_W - b.width, b.x - direction * push));
            if (direction < 0) {
              if (a.vx > 0) a.vx = 0;
              if (b.vx < 0) b.vx = 0;
            } else {
              if (a.vx < 0) a.vx = 0;
              if (b.vx > 0) b.vx = 0;
            }
          }
        }
      }

      const peaks = projectiles.current.filter((proj) => proj.type === "graypeak" && proj.lifeFrames > 0);
      for (const fighter of solidFighters) {
        for (const peak of peaks) {
          const overlapX = Math.min(fighter.x + fighter.width, peak.x + peak.width) - Math.max(fighter.x, peak.x);
          const overlapY = Math.min(fighter.y + fighter.height, peak.y + peak.height) - Math.max(fighter.y, peak.y);
          if (overlapX <= 0 || overlapY <= 0) continue;
          if (centerX(fighter) < peak.x + peak.width / 2) fighter.x -= overlapX;
          else fighter.x += overlapX;
          fighter.x = Math.max(0, Math.min(WORLD_W - fighter.width, fighter.x));
          fighter.vx = 0;
        }
      }

      solidFighters.forEach(updateHitboxes);
    };

    const canBlockAttack = (attacker, defender, attackType, attackHeightOverride = null) => {
      if (!defender.blocking || defender.blockDisabled) return false;
      if (attackType === "dash") return false;
      if (attackType === "poisonorb") return false;

      const h = attackHeightOverride ?? attacker?.attackHeight;

      if (h === "unblockable") return false;
      if (h === "low") return defender.ducking;
      if (h === "overhead") return !defender.ducking;
      if (h === "mid") return true;
      if (h === "high") return !defender.ducking;
      return false;
    };

    const restoreBrownForm = (fighter) => {
      if (!fighter?.brownOriginalForm) return;
      Object.assign(fighter, fighter.brownOriginalForm);
      fighter.brownOriginalForm = null;
      fighter.brownMorphHealth = 0;
    };

    const applyDamage = (attacker, defender, attackType, extra = {}) => {
      if (!defender.alive) return 0;
      if (defender.brownPhasing) return 0;
      if (defender.brownInvulnTimer > 0) return 0;
      if (defender.transparentBurrowing) return 0;
      if (defender.type === "rainbow" && defender.rainbowTurretTimer > 0 && !extra.ignoreRainbowInvulnerable) return 0;
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
      let specialDisableFrames = 600;
      let slowFrames = 0;
      let applyPoisonTicks = 0;
      let applyJumpDisable = 0;
      let applyPoisonSlowFrames = 0;

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
        case "fireanti":
          damage = 4;
          knockback = 4;
          launchUp = true;
          hitstunFrames = 16;
          break;
        case "snowflake":
          damage = 3;
          knockback = 3;
          hitstunFrames = 8;
          break;
        case "greenburst":
          damage = 4;
          knockback = 6;
          hitstunFrames = 12;
          break;
        case "greenresidue":
          damage = 2;
          knockback = 0;
          hitstunFrames = 0;
          break;
        case "shotgunpellet":
          damage = 4;
          knockback = 15;
          hitstunFrames = 8;
          break;
        case "harpoon":
          damage = 2;
          knockback = 0;
          hitstunFrames = 6;
          break;
        case "tripleball":
          damage = 5;
          knockback = 6;
          hitstunFrames = 10;
          break;
        case "purpleroll":
          damage = 6;
          knockback = 8;
          launchUp = true;
          hitstunFrames = 18;
          break;
        case "yellowwave":
          damage = 5;
          knockback = 10;
          launchUp = true;
          hitstunFrames = 14;
          break;
        case "graypeak":
          damage = 6;
          knockback = 2;
          hitstunFrames = 60;
          break;
        case "browncolorball":
          damage = 2;
          knockback = 4;
          hitstunFrames = 8;
          break;
        case "pinkteleport":
          damage = 4;
          knockback = 4;
          launchUp = true;
          hitstunFrames = 16;
          break;
        case "transparentdebuff":
          damage = 7;
          knockback = 8;
          hitstunFrames = 12;
          break;
        case "monochromethrow":
          damage = 13;
          knockback = 0;
          hitstunFrames = 20;
          break;
        case "rainbowgrenade":
          damage = 18;
          knockback = 8;
          launchUp = true;
          hitstunFrames = 22;
          break;
        case "fireball":
          damage = 5;
          knockback = 15;
          hitstunFrames = 12;
          break;
        case "purpleball":
          damage = 4;
          knockback = 15;
          hitstunFrames = 12;
          break;
        case "orangeball":
          damage = 5;
          knockback = 6;
          hitstunFrames = 10;
          break;
        case "orangeorb":
          damage = 10;
          knockback = 5;
          hitstunFrames = 14;
          slowFrames = 480;
          break;
        case "rainbowball":
          damage = 3;
          knockback = 4;
          hitstunFrames = 8;
          break;
        case "monochromeball":
          damage = 3;
          knockback = 10;
          launchUp = true;
          hitstunFrames = 18;
          break;
        case "monochromewave":
          damage = 12;
          knockback = 3;
          hitstunFrames = 10;
          freezeFrames = 180;
          break;
        case "pinkplus":
          damage = 4;
          knockback = 7;
          hitstunFrames = 10;
          break;
        case "graywind":
          damage = 8;
          knockback = 34;
          hitstunFrames = 16;
          break;
        case "grayhammer":
          damage = 4;
          knockback = 20;
          hitstunFrames = 14;
          break;
        case "transparentrise":
          damage = 12;
          knockback = 10;
          launchUp = true;
          hitstunFrames = 18;
          break;
        case "transparentpound":
          damage = 9;
          knockback = 0;
          hitstunFrames = 8;
          freezeFrames = 180;
          break;
        case "brownshift":
          damage = 5;
          knockback = 4;
          hitstunFrames = 10;
          freezeFrames = 180;
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
          damage = 8;
          knockback = 8;
          launchUp = true;
          hitstunFrames = 18;
          break;
        case "iceball":
          damage = 4;
          knockback = 4;
          hitstunFrames = 10;
          freezeFrames = 180;
          break;
        case "sloworb":
          damage = 9;
          knockback = 5;
          hitstunFrames = 14;
          applyJumpDisable = 900;
          launchUp = true;
          break;
        case "poisonorb":
          damage = 0;
          knockback = 0;
          applyPoisonSlowFrames = 480;
          applyPoisonTicks = 5;
          break;
        case "blackball":
          damage = 7;
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

      if (attacker?.type === "monochrome") {
        if (attackType === "punch") damage = 5;
        if (attackType === "kick") damage = 8;
        if (attackType === "uppercut") damage = 15;
        if (attackType === "sweep") damage = 11;
      }

      if (attacker?.type === "rainbow" && ["punch", "kick", "uppercut", "sweep"].includes(attackType)) {
        damage *= 2;
      }

      if (attacker?.damageReducedTimer > 0) {
        damage = Math.ceil(damage * 0.5);
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

      if (defender.orangeCharging) {
        defender.orangeCharging = false;
        defender.orangeChargeTimer = 0;
        hitstunFrames += 30;
      }

      if (defender.brownCharging) {
        defender.brownCharging = false;
        defender.brownChargeTimer = 0;
        hitstunFrames += 30;
      }

      if (defender.reflecting) {
        defender.reflecting = false;
        defender.reflectTimer = 0;
        hitstunFrames += 30;
      }

      if (defender.spearLocked) {
        defender.spearLocked = false;
      }

      const attackHeight = extra.attackHeight ?? attacker.attackHeight ?? "";
      const pinkParryWorks =
        defender.type === "pink" &&
        defender.pinkParrying &&
        defender.pinkParryTimer > 0 &&
        !extra.isProjectile &&
        attackType !== "grayhammer" &&
        attackType !== "transparentrise" &&
        attackType !== "transparentpound" &&
        (
          defender.pinkParryDucking
            ? ["unblockable", "low", "mid"].includes(attackHeight)
            : ["unblockable", "overhead", "high", "mid"].includes(attackHeight)
        );

      if (pinkParryWorks) {
        defender.pinkParrying = false;
        defender.pinkParryTimer = 0;
        if (attacker.brownInvulnTimer > 0) {
          playSfx("block");
          return 0;
        }
        attacker.health -= 7;
        attacker.vx = (attacker.x < defender.x ? -1 : 1) * 8;
        attacker.vy = -25;
        attacker.grounded = false;
        attacker.hitstun = true;
        attacker.hitstunTimer = 18;
        attacker.attacking = false;
        attacker.attackTimer = 0;
        attacker.attackType = "";
        attacker.attackHeight = "";
        attacker.hitFlashTimer = 14;
        attacker.hitFlashColor = "#ec4899";
        playSfx("block");
        markKOIfNeeded(attacker);
        return 0;
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
        applyPoisonSlowFrames = 0;
        playSfx("block");
      } else if (damage > 0) {
        playSfx("hit");
      }

      if (!blocked) {
        if (freezeFrames > 0) {
          defender.frozen = true;
          defender.frozenTimer = freezeFrames;
          defender.monochromeStunned = attackType === "monochromewave";
          defender.monochromeStunTimer = attackType === "monochromewave" ? freezeFrames : 0;
          defender.transparentStunned = attackType === "transparentpound";
          defender.transparentStunTimer = attackType === "transparentpound" ? freezeFrames : 0;
          defender.brownStunned = attackType === "brownshift";
          defender.brownStunTimer = attackType === "brownshift" ? freezeFrames : 0;
        }
        if (disableBlock) {
          defender.blockDisabled = true;
          defender.blockDisabledTimer = 600;
        }
        if (disableSpecial) {
          defender.specialDisabled = true;
          defender.specialDisabledTimer = specialDisableFrames;
        }
        if (slowFrames > 0) {
          defender.slowedTimer = slowFrames;
        }
        if (applyPoisonSlowFrames > 0) {
          defender.poisonSlowTimer = applyPoisonSlowFrames;
        }
        if (applyPoisonTicks > 0) {
          defender.poisoned = true;
          defender.poisonTicksLeft = applyPoisonTicks;
          defender.poisonTickTimer = 60;
          defender.poisonOwnerId = attacker?.id || null;
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
        if (attackType === "snowflake") {
          const now = Date.now();
          defender.snowflakeExpiries = [...(defender.snowflakeExpiries || []).filter((expiry) => expiry > now), now + 3000];
        }
        if (attackType === "transparentdebuff") {
          defender.damageReducedTimer = 300;
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

      const dealtDamage = damage;
      if (defender.brownOriginalForm && damage > 0) {
        defender.brownMorphHealth -= damage;
        if (defender.brownMorphHealth <= 0) restoreBrownForm(defender);
      } else {
        defender.health -= damage;
      }
      if (!defender.isHuman && !defender.dummy && damage > 0) {
        defender.aiGuardPressure = Math.min(
          100,
          (defender.aiGuardPressure || 0) + (blocked ? 14 : 26)
        );
      }
      if (!blocked && damage > 0) {
  defender.hitFlashTimer = 14;
  defender.hitFlashColor = attacker?.lightColor || attacker?.color || "rgba(255,255,255,0.9)";

  if (attacker && !attacker.isHuman && !attacker.dummy) {
    attacker.aiComboTimer = 34;
    attacker.aiComboHits = Math.min(3, (attacker.aiComboHits || 0) + 1);
  }

  if (!defender.isHuman && !defender.dummy) {
    defender.aiPressureTimer = 100;
    defender.aiPressureHits = Math.min(5, (defender.aiPressureHits || 0) + 1);
    defender.aiBlockHoldTimer = Math.min(90, 25 + defender.aiPressureHits * 15);
  }
}

      const dir = extra.knockbackDir ?? attacker?.facing ?? 1;
      if (extra.additiveKnockback) defender.vx += dir * knockback;
      else defender.vx = dir * knockback;

      if (launchUp && !blocked) {
        defender.vy = -25;
        defender.grounded = false;
      }

      return dealtDamage;
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

const cooldownMultiplier = (fighter) => {
  const now = Date.now();
  fighter.snowflakeExpiries = (fighter.snowflakeExpiries || []).filter((expiry) => expiry > now);
  return 1 + fighter.snowflakeExpiries.length * 0.5;
};

const abilityCooldown = (fighter, baseCooldown) => Math.ceil(
  (fighter.cooldownBoostTimer > 0 ? baseCooldown * 0.5 : baseCooldown) * cooldownMultiplier(fighter)
);

const meleeCooldown = (fighter, baseCooldown) => abilityCooldown(fighter, baseCooldown);

const rainbowShotColor = () => RAINBOW_COLORS[Math.floor(Date.now() / 80) % RAINBOW_COLORS.length];

const fireRainbowShot = (owner) => {
  const realTarget = getNearestEnemy(owner);
  const target = !owner.isHuman && realTarget ? getAiPerceivedTarget(owner, realTarget) : realTarget;
  if (!target) return;
  const startX = owner.x + owner.width / 2;
  const startY = owner.y + owner.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const speed = 12;

  projectiles.current.push({
    x: startX,
    y: startY,
    vx: (dx / distance) * speed,
    vy: (dy / distance) * speed,
    owner,
    team: owner.team,
    type: "rainbowball",
    attackHeight: "high",
    color: rainbowShotColor(),
    radius: 7,
    damage: 3,
    homing: true,
    speed,
  });
};

const beginRainbowTurret = (fighter) => {
  if (!fighter.canProjectile || fighter.specialDisabled || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.rainbowTurretTimer > 0) return false;

  stopDefense(fighter);
  fighter.rainbowTurretTimer = 180;
  fighter.rainbowTurretShotTimer = 0;
  fighter.canProjectile = false;
  fireRainbowShot(fighter);
  playSfx("fireball");

  setManagedTimeout(() => {
    fighter.canProjectile = true;
  }, abilityCooldown(fighter, 10000));

  return true;
};

const getActiveRainbowSummon = (owner) => fighters.find((p) => p.isSummon && p.team === owner.team && p.alive);

const beginRainbowSummon = (fighter) => {
  if (!fighter.canSpecial2 || fighter.specialDisabled || fighter.frozen || fighter.hitstun || fighter.spearStunned || getActiveRainbowSummon(fighter)) return false;

  const color = randRainbowSummonColor();
  const data = getColorData(color, "normal");
  const x = Math.max(30, Math.min(WORLD_W - 70, fighter.x + (fighter.facing > 0 ? fighter.width + 24 : -64)));
  const summon = makeFighter({
    id: `rainbow_summon_${Date.now()}`,
    team: fighter.team,
    isHuman: false,
    bindsRef: null,
    data,
    x,
    y: groundLevel - 60,
    facing: fighter.facing,
    label: "Summon",
    health: 15,
    maxHealth: 15,
    isSummon: true,
  });
  summon.aiDifficulty = fighter.aiDifficulty || gameConfig.difficulty || "medium";
  fighters.push(summon);
  fighter.rainbowSummonId = summon.id;
  fighter.canSpecial2 = false;
  playSfx("purple_boost");

  setManagedTimeout(() => {
    fighter.canSpecial2 = true;
  }, abilityCooldown(fighter, 20000));

  return true;
};

const monochromeShotColor = () => MONOCHROME_COLORS[Math.floor(Date.now() / 100) % MONOCHROME_COLORS.length];

const beginMonochromeMissile = (fighter) => {
  if (!fighter.canProjectile || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging) return false;
  const realTarget = getNearestEnemy(fighter);
  const target = !fighter.isHuman && realTarget ? getAiPerceivedTarget(fighter, realTarget) : realTarget;
  if (!target) return false;

  stopDefense(fighter);
  const startX = fighter.x + fighter.width / 2;
  const startY = fighter.y + fighter.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const speed = 8.5;

  projectiles.current.push({
    x: startX,
    y: startY,
    vx: (dx / distance) * speed,
    vy: (dy / distance) * speed,
    owner: fighter,
    team: fighter.team,
    type: "monochromeball",
    attackHeight: "overhead",
    color: monochromeShotColor(),
    radius: 12,
    homing: true,
    speed,
  });

  fighter.canProjectile = false;
  playSfx("fireball");
  setManagedTimeout(() => {
    fighter.canProjectile = true;
  }, abilityCooldown(fighter, 1000));
  return true;
};

const beginMonochromeWave = (fighter) => {
  if (!fighter.canSpecial2 || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging) return false;

  stopDefense(fighter);
  const startX = fighter.x + (fighter.facing > 0 ? fighter.width + 14 : -14);
  const startY = fighter.y + fighter.height / 2;
  projectiles.current.push({
    x: startX,
    y: startY,
    vx: fighter.facing * 7.5,
    vy: 0,
    owner: fighter,
    team: fighter.team,
    type: "monochromewave",
    attackHeight: "unblockable",
    color: "#f8fafc",
    radius: 16,
  });

  fighter.canSpecial2 = false;
  playSfx("white_drop");
  setManagedTimeout(() => {
    fighter.canSpecial2 = true;
  }, abilityCooldown(fighter, 8000));
  return true;
};

const beginPinkPlus = (fighter) => {
  if (!fighter.canProjectile || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging) return false;

  stopDefense(fighter);
  const cx = fighter.x + fighter.width / 2;
  const cy = fighter.y + fighter.height / 2;
  const speed = 8.5;
  const diagonalSpeed = speed / Math.sqrt(2);
  [
    { vx: speed, vy: 0, attackHeight: "high" },
    { vx: diagonalSpeed, vy: -diagonalSpeed, attackHeight: "low" },
    { vx: 0, vy: -speed, attackHeight: "low" },
    { vx: -diagonalSpeed, vy: -diagonalSpeed, attackHeight: "low" },
    { vx: -speed, vy: 0, attackHeight: "high" },
    { vx: -diagonalSpeed, vy: diagonalSpeed, attackHeight: "overhead" },
    { vx: 0, vy: speed, attackHeight: "overhead" },
    { vx: diagonalSpeed, vy: diagonalSpeed, attackHeight: "overhead" },
  ].forEach((shot) => {
    projectiles.current.push({
      x: cx,
      y: cy,
      vx: shot.vx,
      vy: shot.vy,
      owner: fighter,
      team: fighter.team,
      type: "pinkplus",
      attackHeight: shot.attackHeight,
      color: "#ec4899",
      radius: 9,
    });
  });

  fighter.canProjectile = false;
  playSfx("purple_damage");
  setManagedTimeout(() => {
    fighter.canProjectile = true;
  }, abilityCooldown(fighter, 2000));
  return true;
};

const beginPinkParry = (fighter) => {
  if (!fighter.canSpecial2 || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging) return false;

  fighter.vx = 0;
  fighter.blocking = false;
  fighter.attacking = false;
  fighter.attackTimer = 0;
  fighter.attackType = "";
  fighter.attackHeight = "";
  fighter.pinkParrying = true;
  fighter.pinkParryTimer = 30;
  fighter.pinkParryDucking = !!fighter.ducking;
  fighter.canSpecial2 = false;
  playSfx("block");
  setManagedTimeout(() => {
    fighter.canSpecial2 = true;
  }, abilityCooldown(fighter, 1000));
  return true;
};

const landBrownShift = (fighter, x) => {
  if (!fighter) return;
  fighter.brownPhasing = false;
  fighter.x = Math.max(0, Math.min(WORLD_W - fighter.width, x));
  fighter.y = Math.min(fighter.y, groundLevel - fighter.height);
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.grounded = true;
  fighter.airJumpsUsed = 0;
};

const popBrownShiftOffPeak = (fighter, peak, proj) => {
  if (!fighter) return;
  const dir = Math.sign(proj?.vx || fighter.facing || 1);
  fighter.brownPhasing = false;
  fighter.x = Math.max(0, Math.min(WORLD_W - fighter.width, dir > 0 ? peak.x - fighter.width - 2 : peak.x + peak.width + 2));
  fighter.y = Math.max(0, peak.y - fighter.height - 2);
  fighter.vx = -dir * 3;
  fighter.vy = -15;
  fighter.grounded = false;
  fighter.airJumpsUsed = 0;
  fighter.hitstun = false;
  fighter.hitstunTimer = 0;
};

const destroyGrayPeakAt = (index) => {
  if (index < 0) return;
  const peak = projectiles.current[index];
  if (!peak || peak.type !== "graypeak") return;
  if (peak.owner) peak.owner.grayPeakId = null;
  projectiles.current.splice(index, 1);
  playSfx("block");
};

const beginBrownShift = (fighter) => {
  if (!fighter.canProjectile || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging) return false;

  stopDefense(fighter);
  fighter.brownPhasing = true;
  fighter.vx = 0;
  fighter.vy = 0;
  projectiles.current.push({
    x: fighter.x + fighter.width / 2,
    y: fighter.y + fighter.height / 2,
    vx: fighter.facing * 12,
    vy: 0,
    owner: fighter,
    phaseOwner: fighter,
    phaseOwnerId: fighter.id,
    team: fighter.team,
    type: "brownshift",
    attackHeight: "mid",
    color: "#92400e",
    radius: 10,
  });

  fighter.canProjectile = false;
  playSfx("poisonball");
  setManagedTimeout(() => {
    fighter.canProjectile = true;
  }, abilityCooldown(fighter, 5000));
  return true;
};

const beginBrownArmorCharge = (fighter) => {
  if (!fighter.canSpecial2 || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging || fighter.brownInvulnTimer > 0) return false;

  stopDefense(fighter);
  fighter.vx = 0;
  fighter.brownCharging = true;
  fighter.brownChargeTimer = 0;
  fighter.canSpecial2 = false;
  playSfx("charge_start");
  setManagedTimeout(() => {
    fighter.canSpecial2 = true;
  }, abilityCooldown(fighter, 15000));
  return true;
};

const beginGrayWind = (fighter) => {
  if (!fighter.canProjectile || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging || fighter.transparentBurrowing) return false;

  stopDefense(fighter);
  projectiles.current.push({
    x: fighter.x + (fighter.facing > 0 ? fighter.width : 0),
    y: fighter.y + 25,
    vx: fighter.facing * 12,
    vy: 0,
    owner: fighter,
    team: fighter.team,
    type: "graywind",
    attackHeight: "mid",
    color: "#9ca3af",
    radius: 13,
  });

  fighter.canProjectile = false;
  playSfx("sloworb");
  setManagedTimeout(() => {
    fighter.canProjectile = true;
  }, abilityCooldown(fighter, 3000));
  return true;
};

const beginGrayHammer = (fighter) => {
  if (!fighter.canSpecial2 || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging || fighter.transparentBurrowing || fighter.grayHammerTimer > 0) return false;

  stopDefense(fighter);
  fighter.vx = 0;
  fighter.grayHammerTimer = 120;
  fighter.grayHammerRotation = 0;
  fighter.grayHammerHitIds = {};
  fighter.canSpecial2 = false;
  playSfx("uppercut");
  setManagedTimeout(() => {
    fighter.canSpecial2 = true;
  }, abilityCooldown(fighter, 4000));
  return true;
};

const beginTransparentBurrow = (fighter) => {
  if (!fighter.canProjectile || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging || fighter.transparentBurrowing || fighter.transparentPoundChargeTimer > 0) return false;

  stopDefense(fighter);
  fighter.transparentBurrowing = true;
  fighter.transparentBurrowTimer = 180;
  fighter.transparentStrikeTimer = 0;
  fighter.vx = fighter.facing * 7;
  fighter.vy = 0;
  fighter.canProjectile = false;
  playSfx("dash");
  setManagedTimeout(() => {
    fighter.canProjectile = true;
  }, abilityCooldown(fighter, 8000));
  return true;
};

const surfaceTransparent = (fighter) => {
  if (!fighter?.transparentBurrowing) return false;
  fighter.transparentBurrowing = false;
  fighter.transparentBurrowTimer = 0;
  fighter.transparentStrikeTimer = 24;
  fighter.vx = 0;
  fighter.vy = -18;
  fighter.grounded = false;
  playSfx("uppercut");
  fighters
    .filter((target) => target.alive && target.team !== fighter.team)
    .forEach((target) => {
      if (Math.abs(centerX(target) - centerX(fighter)) <= 48) {
        applyDamage(fighter, target, "transparentrise", {
          attackHeight: "unblockable",
          knockbackDir: target.x < fighter.x ? -1 : 1,
        });
      }
    });
  return true;
};

const beginTransparentPound = (fighter) => {
  if (!fighter.canSpecial2 || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging || fighter.transparentBurrowing || fighter.transparentPoundChargeTimer > 0 || fighter.transparentPoundActiveTimer > 0) return false;

  stopDefense(fighter);
  fighter.vx = 0;
  fighter.transparentPoundChargeTimer = 60;
  fighter.transparentPoundActiveTimer = 0;
  fighter.transparentPoundHitIds = {};
  fighter.canSpecial2 = false;
  playSfx("charge_start");
  setManagedTimeout(() => {
    fighter.canSpecial2 = true;
  }, abilityCooldown(fighter, 6000));
  return true;
};

const startSpecial3Cooldown = (fighter, milliseconds) => {
  fighter.canSpecial3 = false;
  setManagedTimeout(() => {
    fighter.canSpecial3 = true;
  }, abilityCooldown(fighter, milliseconds));
};

const fireShotgun = (fighter, downward = false) => {
  const originX = fighter.x + fighter.width / 2 + (downward ? 0 : fighter.facing * 22);
  const originY = fighter.y + fighter.height / 2 + (downward ? fighter.height / 2 : 0);
  const spreads = [-0.22, -0.07, 0.07, 0.22];
  spreads.forEach((spread) => {
    projectiles.current.push({
      x: originX,
      y: originY,
      vx: downward ? spread * 16 : fighter.facing * 13,
      vy: downward ? 12 : spread * 13,
      owner: fighter,
      team: fighter.team,
      type: "shotgunpellet",
      attackHeight: downward ? "overhead" : "mid",
      color: "#fb923c",
      radius: 5,
      passesPlatforms: downward,
      additiveKnockback: true,
    });
  });
  fighter.shotgunVisualTimer = 18;
  fighter.shotgunVisualDownward = downward;
  playSfx("orange_triple");
};

const beginOrangeDownShotgun = (fighter) => {
  if (!fighter.canSpecial2 || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.blackCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging || fighter.transparentBurrowing) return false;
  stopDefense(fighter);
  fireShotgun(fighter, true);
  fighter.vy = fighter.jumpPower;
  fighter.grounded = false;
  fighter.canSpecial2 = false;
  setManagedTimeout(() => {
    fighter.canSpecial2 = true;
  }, abilityCooldown(fighter, 2000));
  return true;
};

const explodeGreenArc = (proj, impactX, impactY, directTarget = null) => {
  fighters.filter((target) => target.alive && target.team !== proj.team).forEach((target) => {
    const dx = centerX(target) - impactX;
    const dy = centerY(target) - impactY;
    if (target !== directTarget && Math.sqrt(dx * dx + dy * dy) > 48) return;
    applyDamage(proj.owner, target, "greenburst", {
      attackHeight: "unblockable",
      isProjectile: true,
      knockbackDir: dx < 0 ? -1 : 1,
      ignoreRainbowInvulnerable: !!proj.reflected,
    });
    markKOIfNeeded(target);
  });
  projectiles.current.push({
    x: Math.max(20, Math.min(WORLD_W - 20, impactX)),
    y: impactY,
    vx: 0,
    vy: 0,
    owner: proj.owner,
    team: proj.team,
    type: "greenresidue",
    attackHeight: "unblockable",
    color: "rgba(34,197,94,0.72)",
    radius: 60,
    lifeFrames: 180,
    residueTickFrames: {},
  });
  playSfx("poisonball");
};

const morphBrownInto = (brown, target) => {
  if (!brown?.alive || !target?.alive) return;
  if (target.type === "brown") {
    brown.health = Math.min(brown.maxHealth || 100, brown.health + 5);
    return;
  }
  if (!brown.brownOriginalForm) {
    brown.brownOriginalForm = {
      type: "brown",
      color: brown.color,
      lightColor: brown.lightColor,
      name: brown.name,
      maxHealth: brown.maxHealth,
    };
  }
  brown.type = target.type;
  brown.color = target.color;
  brown.lightColor = target.lightColor;
  brown.name = target.name;
  brown.brownMorphHealth = 5;
  playSfx("purple_boost");
};

const explodeRainbowGrenade = (proj, directTarget = null) => {
  const targets = fighters.filter((target) => target.alive && target.team !== proj.team);
  targets.forEach((target) => {
    const close = Math.abs(centerX(target) - proj.x) <= 42 && Math.abs(centerY(target) - proj.y) <= 52;
    if (target === directTarget || close) {
      applyDamage(proj.owner, target, "rainbowgrenade", {
        attackHeight: "unblockable",
        isProjectile: true,
        knockbackDir: centerX(target) < proj.x ? -1 : 1,
      });
      markKOIfNeeded(target);
    }
  });
  projectiles.current.push({
    x: proj.x,
    y: proj.y,
    vx: 0,
    vy: 0,
    owner: proj.owner,
    team: proj.team,
    type: "rainbowblast",
    color: "#f8fafc",
    radius: 42,
    lifeFrames: 12,
  });
  playSfx("chargeball");
};

const beginSpecial3 = (fighter, targetOverride = null) => {
  const target = targetOverride || getNearestEnemy(fighter);
  if (!fighter.alive || fighter.specialDisabled || fighter.frozen || fighter.hitstun || fighter.spearStunned || fighter.spearLocked || fighter.reflecting || fighter.purpleCharging || fighter.orangeCharging || fighter.blackCharging || fighter.pinkParrying || fighter.brownPhasing || fighter.brownCharging || fighter.transparentBurrowing) return false;

  if (fighter.type === "pink" && fighter.pinkTeleportMarker) {
    if (fighter.pinkTeleportArmTimer > 0) return false;
    const marker = fighter.pinkTeleportMarker;
    fighter.x = Math.max(0, Math.min(WORLD_W - fighter.width, marker.x));
    fighter.y = Math.max(0, Math.min(groundLevel - fighter.height, marker.y));
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.grounded = fighter.y + fighter.height >= groundLevel;
    fighter.pinkTeleportExplosionTimer = 18;
    fighters.filter((other) => other.alive && other.team !== fighter.team).forEach((other) => {
      const dx = centerX(other) - centerX(fighter);
      const dy = centerY(other) - centerY(fighter);
      if (Math.sqrt(dx * dx + dy * dy) <= 72) {
        applyDamage(fighter, other, "pinkteleport", {
          attackHeight: "unblockable",
          isProjectile: true,
          knockbackDir: dx < 0 ? -1 : 1,
        });
        markKOIfNeeded(other);
      }
    });
    fighter.pinkTeleportMarker = null;
    startSpecial3Cooldown(fighter, 5000);
    playSfx("white_drop");
    return true;
  }

  if (fighter.type === "explosion" && fighter.harpoonTargetId) return beginOrangeHarpoon(fighter);

  if (!fighter.canSpecial3 || !target) return false;
  stopDefense(fighter);

  if (fighter.type === "fire") {
    const targets = fighters.filter((other) => other.alive && other.team !== fighter.team);
    fighter.special3VisualTimer = 16;
    targets.forEach((other) => {
      const arcX = centerX(fighter);
      const arcY = fighter.y + 4;
      const samples = [
        [other.x + other.width * 0.5, other.y + other.height * 0.5],
        [other.x + other.width * 0.25, other.y + other.height * 0.3],
        [other.x + other.width * 0.75, other.y + other.height * 0.3],
        [other.x + other.width * 0.5, other.y + other.height * 0.1],
      ];
      const arcHit = samples.some(([x, y]) => {
        const dx = x - arcX;
        const dy = y - arcY;
        const angle = Math.atan2(dy, dx);
        const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return normalized >= Math.PI * 1.08 && normalized <= Math.PI * 1.92 && distance >= 54 && distance <= 96;
      });
      if (arcHit) {
        applyDamage(fighter, other, "fireanti", {
          attackHeight: "unblockable",
          knockbackDir: centerX(other) < centerX(fighter) ? -1 : 1,
        });
        markKOIfNeeded(other);
      }
    });
    startSpecial3Cooldown(fighter, 1000);
    playSfx("uppercut");
    return true;
  }

  if (fighter.type === "ice") {
    projectiles.current.push({ x: centerX(fighter), y: centerY(fighter), vx: fighter.facing * 10, vy: 0, owner: fighter, team: fighter.team, type: "snowflake", attackHeight: "high", color: "#dbeafe", radius: 15 });
    startSpecial3Cooldown(fighter, 500);
    playSfx("iceball");
    return true;
  }

  if (fighter.type === "poison") {
    const frames = 42;
    const gravity = 0.48;
    const dx = centerX(target) - centerX(fighter);
    const dy = centerY(target) - centerY(fighter);
    projectiles.current.push({
      x: centerX(fighter),
      y: centerY(fighter),
      vx: dx / frames,
      vy: (dy - 0.5 * gravity * frames * frames) / frames,
      gravity,
      owner: fighter,
      team: fighter.team,
      type: "greenarc",
      attackHeight: "unblockable",
      color: "#16a34a",
      radius: 9,
    });
    startSpecial3Cooldown(fighter, 1500);
    playSfx("poisonball");
    return true;
  }

  if (fighter.type === "void") {
    fighter.blackCharging = true;
    fighter.blackChargeTimer = 0;
    fighter.vx = 0;
    startSpecial3Cooldown(fighter, 10000);
    playSfx("charge_start");
    return true;
  }

  if (fighter.type === "light") {
    [-28, 0, 28].forEach((offset) => {
      projectiles.current.push({ x: centerX(fighter) + fighter.facing * offset, y: centerY(fighter), vx: fighter.facing * 11, vy: 0, owner: fighter, team: fighter.team, type: "tripleball", attackHeight: "high", color: "#f8fafc", radius: 8 });
    });
    startSpecial3Cooldown(fighter, 2000);
    playSfx("orange_triple");
    return true;
  }

  if (fighter.type === "psychic") {
    fighter.attacking = true;
    fighter.attackType = "purpleroll";
    fighter.attackHeight = "low";
    fighter.attackTimer = 120;
    fighter.special3RollTimer = 120;
    fighter.special3HasHit = false;
    fighter.ducking = true;
    fighter.vx = fighter.facing * 10;
    startSpecial3Cooldown(fighter, 2000);
    playSfx("dash");
    return true;
  }

  if (fighter.type === "electric") {
    fighter.yellowWaveChargeTimer = 30;
    fighter.yellowWaveTargetX = centerX(target);
    startSpecial3Cooldown(fighter, 1500);
    playSfx("charge_start");
    return true;
  }

  if (fighter.type === "explosion") {
    return beginOrangeHarpoon(fighter);
  }

  if (fighter.type === "gray") {
    const existing = projectiles.current.find((proj) => proj.type === "graypeak" && proj.owner === fighter && proj.lifeFrames > 0);
    if (existing) return false;
    const x = Math.max(0, Math.min(WORLD_W - fighter.width, fighter.facing > 0 ? fighter.x + fighter.width * 1.5 : fighter.x - fighter.width * 1.5));
    const surfaceY = fighter.grounded ? fighter.y + fighter.height : groundLevel;
    const peak = { id: `gray_peak_${fighter.id}_${Date.now()}`, x, y: surfaceY - fighter.height, vx: 0, vy: 0, owner: fighter, team: fighter.team, type: "graypeak", attackHeight: "low", color: "#6b7280", radius: 20, width: fighter.width, height: fighter.height, health: 1, lifeFrames: 120 };
    projectiles.current.push(peak);
    fighter.grayPeakId = peak.id;
    const victim = fighters.find((other) => other.alive && other.team !== fighter.team && other.x < x + peak.width && other.x + other.width > x && other.y < peak.y + peak.height && other.y + other.height > peak.y);
    if (victim) {
      applyDamage(fighter, victim, "graypeak", { attackHeight: "low", knockbackDir: fighter.facing });
      markKOIfNeeded(victim);
      peak.lifeFrames = 0;
      fighter.grayPeakId = null;
    }
    startSpecial3Cooldown(fighter, 1500);
    playSfx("uppercut");
    return true;
  }

  if (fighter.type === "brown") {
    projectiles.current.push({ x: centerX(fighter), y: centerY(fighter), vx: fighter.facing * 8, vy: 0, owner: fighter, team: fighter.team, type: "browncolorball", attackHeight: "high", color: "#92400e", radius: 10 });
    startSpecial3Cooldown(fighter, 1000);
    playSfx("fireball");
    return true;
  }

  if (fighter.type === "pink") {
    fighter.pinkTeleportMarker = { x: fighter.x, y: fighter.y };
    fighter.pinkTeleportArmTimer = 180;
    playSfx("purple_boost");
    return true;
  }

  if (fighter.type === "transparent") {
    projectiles.current.push({ x: centerX(fighter), y: centerY(fighter), vx: fighter.facing * 12, vy: 0, owner: fighter, team: fighter.team, type: "transparentdebuff", attackHeight: "mid", color: "rgba(226,232,240,0.48)", radius: 10 });
    startSpecial3Cooldown(fighter, 3000);
    playSfx("sloworb");
    return true;
  }

  if (fighter.type === "monochrome") {
    const inFront = fighter.facing > 0 ? centerX(target) >= centerX(fighter) : centerX(target) <= centerX(fighter);
    if (!inFront || Math.abs(centerX(target) - centerX(fighter)) > 105 || Math.abs(centerY(target) - centerY(fighter)) > 55) return false;
    const wasHitstunned = fighter.hitstun;
    fighter.attacking = true;
    fighter.attackType = "monochromegrab";
    fighter.attackHeight = "unblockable";
    fighter.attackTimer = 10;
    applyDamage(fighter, target, "monochromegrab", { attackHeight: "unblockable", knockbackDir: fighter.facing });
    if (!wasHitstunned && !fighter.hitstun) {
      target.thrownById = fighter.id;
      target.thrownLandingPending = true;
      target.thrownDirection = fighter.facing;
      target.vx = fighter.facing * 18;
      target.vy = -15;
      target.grounded = false;
      target.hitstun = true;
      target.hitstunTimer = 180;
      playSfx("sweep");
    }
    startSpecial3Cooldown(fighter, 4000);
    return true;
  }

  if (fighter.type === "rainbow") {
    projectiles.current.push({ x: centerX(fighter), y: centerY(fighter), vx: fighter.facing * 6.6, vy: -11.5, gravity: 0.62, owner: fighter, team: fighter.team, type: "rainbowgrenade", attackHeight: "unblockable", color: "#ec4899", radius: 20, bounceCount: 0 });
    startSpecial3Cooldown(fighter, 5000);
    playSfx("chargeball");
    return true;
  }

  return false;
};

const beginOrangeHarpoon = (fighter) => {
  if (fighter.harpoonTargetId) {
    const target = fighters.find((other) => other.id === fighter.harpoonTargetId && other.alive);
    if (!target) {
      fighter.harpoonTargetId = null;
      return false;
    }
    fighter.harpoonPullTimer = 90;
    playSfx("yellow_spear");
    return true;
  }
  if (!fighter.canSpecial3 || fighter.specialDisabled || fighter.attacking || fighter.frozen || fighter.hitstun || fighter.spearStunned) return false;
  projectiles.current.push({
    x: fighter.x + (fighter.facing > 0 ? fighter.width : 0),
    y: centerY(fighter),
    vx: fighter.facing * 14,
    vy: 0,
    owner: fighter,
    team: fighter.team,
    type: "orangeharpoon",
    attackHeight: "mid",
    color: "#f97316",
    radius: 7,
  });
  fighter.canSpecial3 = false;
  setManagedTimeout(() => {
    fighter.canSpecial3 = true;
  }, abilityCooldown(fighter, 3000));
  playSfx("yellow_spear");
  return true;
};

  const beginMelee = (ai, attackType) => {
    if (ai.attacking || ai.hitstun || ai.frozen || ai.pinkParrying || ai.brownPhasing || ai.brownCharging) return false;
    if ((ai.aiActionCooldowns?.attack || 0) > 0 || !canAiRepeatAction(ai, attackType)) return false;

    stopDefense(ai);
    ai.vx = 0;
    ai.healing = false;
    const commitAttack = () => {
      rememberAiAction(ai, attackType);
      ai.aiActionCooldowns.attack = getAiSettings(ai).attackCooldown;
    };

    if (attackType === "punch" && ai.punchCooldown === 0) {
      ai.attacking = true;
      ai.attackType = "punch";
      ai.attackHeight = "mid";
      ai.attackTimer = 15;
      ai.punchCooldown = meleeCooldown(ai, 20);
      playSfx("punch");
      commitAttack();
      return true;
    }

    if (attackType === "kick" && ai.kickCooldown === 0) {
      ai.attacking = true;
      ai.attackType = "kick";
      ai.attackHeight = "overhead";
      ai.attackTimer = 15;
      ai.kickCooldown = meleeCooldown(ai, 40);
      playSfx("kick");
      commitAttack();
      return true;
    }

    if (attackType === "sweep" && ai.sweepCooldown === 0) {
      ai.attacking = true;
    ai.attackType = "sweep";
      ai.attackHeight = "low";
      ai.attackTimer = 15;
      ai.sweepCooldown = meleeCooldown(ai, 50);
      ai.ducking = true;
      playSfx("sweep");
      commitAttack();
      return true;
    }

    if (attackType === "uppercut" && ai.upperCooldown === 0) {
      ai.attacking = true;
      ai.attackType = "uppercut";
      ai.attackHeight = "high";
      ai.attackTimer = 15;
      ai.upperCooldown = meleeCooldown(ai, 60);
      playSfx("uppercut");
      commitAttack();
      return true;
    }

  return false;
};

const beginProjectile = (ai) => {
  if (ai.type === "rainbow") return beginRainbowTurret(ai);
  if (ai.type === "monochrome") return beginMonochromeMissile(ai);
  if (ai.type === "transparent") return beginTransparentBurrow(ai);
  if (ai.type === "pink") return beginPinkPlus(ai);
  if (ai.type === "brown") return beginBrownShift(ai);
  if (ai.type === "gray") return beginGrayWind(ai);
  if (!ai.canProjectile || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging || ai.pinkParrying || ai.brownPhasing || ai.brownCharging) return false;

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
      vx: ai.facing * 12,
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
      fireShotgun(ai, false);
      cooldown = 2000;
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
      cooldown = 1000;
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
  }, abilityCooldown(ai, cooldown));

  return true;
};

const beginRedDash = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging) return false;

  stopDefense(ai);
  ai.ducking = false;
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
  }, abilityCooldown(ai, 2000));

  return true;
};

const beginIceSlowOrb = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging) return false;

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
  }, abilityCooldown(ai, 4000));

  return true;
};

const beginWhiteDrop = (ai, target) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging || !target) return false;

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
  }, abilityCooldown(ai, 3000));

  return true;
};

const beginPurplePowerUp = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging || ai.speedBoostTimer > 0) return false;

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
  }, abilityCooldown(ai, 13000));

  return true;
};

const beginYellowReflect = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging) return false;

  stopDefense(ai);
  ai.vx = 0;
  ai.reflecting = true;
  ai.reflectTimer = 60;
  playSfx("reflect");

  return true;
};

const beginPoisonHeal = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging || ai.health >= 100) return false;

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
  }, abilityCooldown(ai, 3500));

  return true;
};

const beginVoidCharge = (ai) => {
  if (!ai.canSpecial2 || ai.specialDisabled || ai.attacking || ai.frozen || ai.hitstun || ai.spearStunned || ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging) return false;

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

  const chargeDamage = 8 + Math.floor(ai.chargeFrames / 15);

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
  }, abilityCooldown(ai, 3200));

  return true;
};

const tryAiReadProjectileInput = (ai, opp) => {
  if (!opp?.isHuman) return false;
  if (ai.aiLastInputTargetId !== opp.id) {
    ai.aiLastInputTargetId = opp.id;
    ai.aiLastInputRevision = 0;
  }

  const revision = opp.inputIntentRevision || 0;
  if (revision <= (ai.aiLastInputRevision || 0)) return false;
  ai.aiLastInputRevision = revision;

  if (!["special1", "special2", "special3"].includes(opp.inputIntentAction) || Date.now() - (opp.inputIntentAt || 0) > 100) return false;
  const readInput = rand() < getAiSettings(ai).inputReadChance;
  ai.aiReadInputAction = readInput ? "special1" : "";
  return readInput;
};

const getIncomingProjectile = (ai, anticipatedOwner = null) => {
  const aiCenter = centerX(ai);
  const settings = getAiSettings(ai);

  const threat = projectiles.current.find((proj) => {
    if (proj.team === ai.team) return false;

    const xDist = Math.abs(proj.x - aiCenter);
    const yDist = Math.abs(proj.y - centerY(ai));

    const horizontalThreat =
      ((proj.vx > 0 && proj.x < aiCenter) ||
        (proj.vx < 0 && proj.x > aiCenter)) &&
      xDist < settings.projectileReactRange &&
      yDist < 70;

    const verticalThreat =
      (((proj.vy || 0) > 0 && proj.y < centerY(ai)) || ((proj.vy || 0) < 0 && proj.y > centerY(ai))) &&
      xDist < 55 &&
      yDist < settings.projectileReactRange;

    return horizontalThreat || verticalThreat;
  });


  if (ai.aiIncomingProjectile !== threat) {
    ai.aiIncomingProjectile = threat || null;
    ai.aiIncomingProjectileFrames = threat ? 1 : 0;
  } else if (threat) {
    ai.aiIncomingProjectileFrames = (ai.aiIncomingProjectileFrames || 0) + 1;
  }

  if (!threat) return null;

  const xDist = Math.abs(threat.x - aiCenter);
  const requiredFrames = Math.max(2, Math.floor(settings.reactionTime * 0.4));
  const anticipatedThreat = anticipatedOwner && threat.owner?.id === anticipatedOwner.id;
  if (!anticipatedThreat && ai.aiIncomingProjectileFrames < requiredFrames && xDist > 95) return null;
  return threat;
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
  if (ai.ducking) {
    ai.vx = 0;
    return;
  }
  const cappedSpeedMult = Math.max(0, Math.min(1, speedMult));
  const dx = faceTarget(ai, target);
  ai.vx = dx > 0 ? ai.speed * cappedSpeedMult : -ai.speed * cappedSpeedMult;
};

const moveAway = (ai, target, speedMult = 1) => {
  if (ai.ducking) {
    ai.vx = 0;
    return;
  }
  const cappedSpeedMult = Math.max(0, Math.min(1, speedMult));
  const dx = faceTarget(ai, target);
  ai.vx = dx > 0 ? -ai.speed * cappedSpeedMult : ai.speed * cappedSpeedMult;
};

const canAiRepeatAction = (ai, action) => {
  const settings = getAiSettings(ai);
  return ai.aiRepeatAction !== action || (ai.aiRepeatCount || 0) < settings.maxRepeat;
};

const rememberAiAction = (ai, action) => {
  if (!action) return;
  if (ai.aiRepeatAction === action) {
    ai.aiRepeatCount = (ai.aiRepeatCount || 0) + 1;
  } else {
    ai.aiRepeatAction = action;
    ai.aiRepeatCount = 1;
  }
  ai.aiActionHistory = [...(ai.aiActionHistory || []), action].slice(-6);
};

const setAiMovementIntent = (ai, action, frames = getAiSettings(ai).movementCommit) => {
  if (ai.aiAction !== action) rememberAiAction(ai, action);
  ai.aiAction = action;
  ai.aiActionTimer = Math.max(8, frames);
};

const followAiMovementIntent = (ai, opp, tactic) => {
  if ((ai.aiActionTimer || 0) <= 0) return false;
  const distance = Math.abs(centerX(opp) - centerX(ai));

  if (ai.aiAction === "approach" || ai.aiAction === "pressure") {
    if (distance <= Math.max(58, tactic.spacing - 24)) {
      ai.vx *= 0.6;
      return true;
    }
    moveToward(ai, opp, ai.aiAction === "pressure" ? tactic.aggression : Math.min(0.82, tactic.aggression));
    return true;
  }

  if (ai.aiAction === "retreat") {
    const cornered = ai.x < 50 || ai.x + ai.width > WORLD_W - 50;
    if (cornered) moveToward(ai, opp, 0.72);
    else if (distance > tactic.spacing + 55) ai.vx *= 0.6;
    else moveAway(ai, opp, 0.76);
    return true;
  }

  if (ai.aiAction === "hold") {
    ai.vx *= 0.65;
    return true;
  }

  return false;
};

const startAiBlock = (ai, attackHeight = "mid", holdFrames = 0) => {
  const settings = getAiSettings(ai);
  if (
    ai.blockDisabled ||
    (ai.aiActionCooldowns?.block || 0) > 0 ||
    !canAiRepeatAction(ai, attackHeight === "low" ? "lowBlock" : "block")
  ) {
    return false;
  }

  const action = attackHeight === "low" ? "lowBlock" : "block";
  if (!smartBlock(ai, attackHeight)) return false;
  rememberAiAction(ai, action);
  ai.aiAction = action;
  ai.aiBlockHeight = attackHeight === "low" ? "low" : "mid";
  ai.aiActionTimer = Math.max(8, holdFrames || Math.round(settings.maxDefenseHold * (0.45 + rand() * 0.35)));
  return true;
};

const finishAiBlock = (ai) => {
  const settings = getAiSettings(ai);
  stopDefense(ai);
  ai.aiDefenseTimer = 0;
  ai.aiActionTimer = 0;
  ai.aiActionCooldowns.block = settings.blockCooldown;
};

const chooseCloseAttack = (ai, opp) => {
  const settings = getAiSettings(ai);
  if ((ai.aiActionCooldowns?.attack || 0) > 0) return false;

  const distance = Math.abs(centerX(opp) - centerX(ai));
  const ranges = { punch: 74, kick: 98, sweep: 102, uppercut: 78 };
  let choices;

  if (!opp.grounded) {
    choices = ["uppercut", "kick", "punch"];
  } else if (opp.frozen || opp.hitstun || opp.spearStunned) {
    choices = ["uppercut", "kick", "sweep", "punch"];
  } else if (opp.blocking) {
    choices = opp.ducking
      ? ["kick", "punch", "uppercut", "sweep"]
      : ["sweep", "punch", "kick", "uppercut"];
  } else if (opp.ducking) {
    choices = ["kick", "sweep", "punch", "uppercut"];
  } else {
    choices = rand() < 0.5
      ? ["punch", "kick", "sweep", "uppercut"]
      : ["kick", "sweep", "punch", "uppercut"];
  }


  if (rand() > settings.accuracy) {
    choices = [...choices].sort(() => rand() - 0.5);
  }

  for (const attack of choices) {
    const allowedRange = ranges[attack] + (1 - settings.accuracy) * 12;
    if (distance > allowedRange || !canAiRepeatAction(ai, attack)) continue;
    if (beginMelee(ai, attack)) return true;
  }

  return false;
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

const platformKey = (plat) => `${plat.x}:${plat.y}:${plat.width}`;
const platformGap = (a, b) => {
  if (!a || !b) return Infinity;
  if (a.x + a.width < b.x) return b.x - (a.x + a.width);
  if (b.x + b.width < a.x) return a.x - (b.x + b.width);
  return 0;
};

const clampToPlatform = (plat, x, margin = 24) => {
  const min = plat.x + margin;
  const max = plat.x + plat.width - margin;
  if (max <= min) return plat.x + plat.width / 2;
  return Math.max(min, Math.min(max, x));
};

const getTargetPlatformForFighter = (p) => {
  const standing = getPlatformFighterIsOn(p);
  if (standing) return standing;

  const feetY = p.y + p.height;
  const fighterCenter = centerX(p);
  return platforms
    .filter((plat) => feetY <= plat.y + 10 && fighterCenter >= plat.x - 45 && fighterCenter <= plat.x + plat.width + 45)
    .sort((a, b) => Math.abs(feetY - a.y) - Math.abs(feetY - b.y))[0] || null;
};

const canTravelPlatform = (from, to) => {
  if (!from || !to || from === to) return false;
  const vertical = from.y - to.y;
  const gap = platformGap(from, to);
  if (vertical > 8) return vertical <= 175 && gap <= 140;
  if (vertical < -8) return true;
  return gap <= 90;
};

const getPlatformRoute = (from, to) => {
  if (!from || !to) return [];
  if (from === to || platformKey(from) === platformKey(to)) return [from];

  const queue = [[from]];
  const visited = new Set([platformKey(from)]);

  while (queue.length) {
    const route = queue.shift();
    const last = route[route.length - 1];
    const nextPlatforms = platforms
      .filter((plat) => !visited.has(platformKey(plat)) && canTravelPlatform(last, plat))
      .sort((a, b) => {
        const aGoal = Math.abs(a.y - to.y) + Math.abs((a.x + a.width / 2) - (to.x + to.width / 2)) * 0.35;
        const bGoal = Math.abs(b.y - to.y) + Math.abs((b.x + b.width / 2) - (to.x + to.width / 2)) * 0.35;
        return aGoal - bGoal;
      });

    for (const next of nextPlatforms) {
      const nextRoute = [...route, next];
      if (platformKey(next) === platformKey(to)) return nextRoute;
      visited.add(platformKey(next));
      queue.push(nextRoute);
    }
  }

  return [];
};

const getOpenPlatformLandingX = (ai, opp, platform, preferredX) => {
  if (!platform) return preferredX;
  const margin = ai.width / 2 + 10;
  const minX = platform.x + margin;
  const maxX = platform.x + platform.width - margin;
  const clampedPreferred = Math.max(minX, Math.min(maxX, preferredX));
  const opponentPlatform = getTargetPlatformForFighter(opp);
  if (!opponentPlatform || platformKey(opponentPlatform) !== platformKey(platform)) return clampedPreferred;

  const opponentCenter = centerX(opp);
  const clearance = (ai.width + opp.width) / 2 + 14;
  if (Math.abs(clampedPreferred - opponentCenter) >= clearance) return clampedPreferred;

  const candidates = [opponentCenter - clearance, opponentCenter + clearance]
    .filter((x) => x >= minX && x <= maxX)
    .sort((a, b) => Math.abs(a - centerX(ai)) - Math.abs(b - centerX(ai)));
  if (candidates.length) return candidates[0];
  return Math.abs(minX - opponentCenter) >= Math.abs(maxX - opponentCenter) ? minX : maxX;
};

const getPlatformLaunchX = (from, to, desiredX) => {
  if (!from || !to) return desiredX;
  const fromMin = from.x + 24;
  const fromMax = from.x + from.width - 24;
  const jumpMin = Math.max(fromMin, to.x - 45);
  const jumpMax = Math.min(fromMax, to.x + to.width + 45);

  if (jumpMax >= jumpMin) return Math.max(jumpMin, Math.min(jumpMax, desiredX));
  if (to.x > from.x + from.width) return fromMax;
  if (to.x + to.width < from.x) return fromMin;
  return clampToPlatform(from, desiredX);
};

const beginAiJump = (ai, direction = ai.facing || 1, targetPlatform = null, force = false) => {
  const settings = getAiSettings(ai);
  const jumpAction = targetPlatform ? `platformJump:${platformKey(targetPlatform)}` : "jump";
  if ((ai.aiJumpLoopCooldown || 0) > 0 && (ai.aiHeadStackTimer || 0) <= 0) return false;
  if (ai.aiLastJumpAction === jumpAction && (ai.aiSameJumpCount || 0) >= 3 && (ai.aiHeadStackTimer || 0) <= 0) {
    ai.aiJumpLoopCooldown = 90;
    ai.aiFailedClimbCooldown = Math.max(ai.aiFailedClimbCooldown || 0, targetPlatform ? 90 : 45);
    clearAiNavigation(ai);
    return false;
  }
  if (
    !ai.grounded ||
    ai.jumpDisabled ||
    ai.aiJumpCooldown > 0 ||
    (
      targetPlatform &&
      !force &&
      (
        (ai.aiPlatformLoopLockTimer || 0) > 0 ||
        ((ai.aiVerticalRouteCooldown || 0) > 0 && ai.aiLastVerticalAction === "drop")
      )
    ) ||
    (!force && !canAiRepeatAction(ai, jumpAction))
  ) {
    return false;
  }
  const currentPlatform = getPlatformFighterIsOn(ai);
  ai.vy = ai.jumpPower;
  ai.grounded = false;
  ai.airJumpsUsed = 0;
  ai.facing = direction || ai.facing || 1;
  ai.vx = (direction || ai.facing || 1) * ai.speed;
  ai.aiJumpCooldown = settings.jumpCooldown;
  ai.aiJumpStartPlatformKey = currentPlatform ? platformKey(currentPlatform) : "";
  ai.aiJumpTargetPlatformKey = targetPlatform ? platformKey(targetPlatform) : "";
  if (targetPlatform) {
    ai.aiLastVerticalAction = "climb";
    ai.aiVerticalRouteCooldown = 90;
  }
  if (ai.aiLastJumpAction === jumpAction) ai.aiSameJumpCount = (ai.aiSameJumpCount || 0) + 1;
  else {
    ai.aiLastJumpAction = jumpAction;
    ai.aiSameJumpCount = 1;
  }
  rememberAiAction(ai, jumpAction);
  ai.aiAction = jumpAction;
  ai.aiActionTimer = Math.max(12, settings.movementCommit);
  return true;
};

const tryJumpToPlatform = (ai, opp) => {
  if (
    ai.ducking ||
    !ai.grounded ||
    ai.jumpDisabled ||
    ai.aiJumpCooldown > 0 ||
    ai.aiFailedClimbCooldown > 0 ||
    ai.aiPlatformLoopLockTimer > 0 ||
    (ai.aiVerticalRouteCooldown > 0 && ai.aiLastVerticalAction === "drop")
  ) return false;

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
  if (ai.aiAvoidPlatformTimer > 0 && ai.aiAvoidPlatformKey === platformKey(targetPlatform)) return false;

  const targetX = getOpenPlatformLandingX(ai, opp, targetPlatform, centerX(opp));
  ai.aiClimbTargetKey = platformKey(targetPlatform);
  ai.aiClimbTargetX = targetX;
  ai.aiClimbLandingX = targetX;
  if (beginAiJump(ai, targetX > centerX(ai) ? 1 : -1, targetPlatform)) return true;
  ai.aiClimbTargetKey = "";
  ai.aiClimbTargetX = 0;
  ai.aiClimbLandingX = 0;
  return false;
};

const tryClimbTowardOpponent = (ai, opp) => {
  if (
    ai.ducking ||
    !ai.grounded ||
    ai.jumpDisabled ||
    ai.aiJumpCooldown > 0 ||
    ai.aiFailedClimbCooldown > 0 ||
    ai.aiPlatformLoopLockTimer > 0 ||
    (ai.aiVerticalRouteCooldown > 0 && ai.aiLastVerticalAction === "drop")
  ) return false;

  const aiFeet = ai.y + ai.height;
  const aiCenter = centerX(ai);
  const currentPlatform = getPlatformFighterIsOn(ai);
  const opponentPlatform = getTargetPlatformForFighter(opp);
  if (!currentPlatform || !opponentPlatform || platformKey(currentPlatform) === platformKey(opponentPlatform)) return false;
  if (ai.aiAvoidPlatformTimer > 0 && ai.aiAvoidPlatformKey === platformKey(opponentPlatform)) return false;

  const activeTarget = ai.aiClimbTargetKey
    ? platforms.find((plat) => `${plat.x}:${plat.y}:${plat.width}` === ai.aiClimbTargetKey)
    : null;

  if (activeTarget && platformKey(activeTarget) === platformKey(currentPlatform)) {
    ai.aiClimbTargetKey = "";
    ai.aiClimbTargetX = 0;
    ai.aiClimbLandingX = 0;
  } else if (activeTarget && activeTarget.y < aiFeet - 20 && aiFeet - activeTarget.y <= 175 && canTravelPlatform(currentPlatform, activeTarget)) {
    const openLandingX = getOpenPlatformLandingX(ai, opp, activeTarget, centerX(opp));
    const targetX = ai.aiClimbTargetX || getPlatformLaunchX(currentPlatform, activeTarget, openLandingX);
    const direction = targetX >= aiCenter ? 1 : -1;
    const readyToJump = Math.abs(aiCenter - targetX) <= 16;
    const airDirection = activeTarget.x + activeTarget.width / 2 >= aiCenter ? 1 : -1;

    ai.facing = readyToJump ? airDirection : direction;
    ai.vx = readyToJump ? airDirection * ai.speed : direction * ai.speed;
    ai.blocking = false;
    ai.ducking = false;
    ai.attacking = false;

    if (readyToJump) {
      if (!beginAiJump(ai, airDirection, activeTarget)) return false;
    }

    return true;
  }

  if (ai.aiClimbTargetKey) {
    ai.aiClimbTargetKey = "";
    ai.aiClimbTargetX = 0;
    ai.aiClimbLandingX = 0;
  }

  const route = getPlatformRoute(currentPlatform, opponentPlatform);
  const targetPlatform = route[1];
  if (!targetPlatform) return false;

  const openLandingX = getOpenPlatformLandingX(ai, opp, targetPlatform, centerX(opp));
  const targetX = getPlatformLaunchX(currentPlatform, targetPlatform, openLandingX);
  const readyToJump = Math.abs(aiCenter - targetX) <= 16;
  const airDirection = targetPlatform.x + targetPlatform.width / 2 >= aiCenter ? 1 : -1;

  ai.aiClimbTargetKey = `${targetPlatform.x}:${targetPlatform.y}:${targetPlatform.width}`;
  ai.aiClimbTargetX = targetX;
  ai.aiClimbLandingX = openLandingX;
  ai.facing = readyToJump ? airDirection : targetX >= aiCenter ? 1 : -1;
  ai.vx = readyToJump ? airDirection * ai.speed : ai.facing * ai.speed;
  ai.blocking = false;
  ai.ducking = false;
  ai.attacking = false;

  if (readyToJump) {
    if (!beginAiJump(ai, airDirection, targetPlatform)) return false;
  }

  return true;
};

const continueClimbJump = (ai, opp) => {
  if (ai.grounded || !ai.aiClimbTargetKey) return false;

  const targetPlatform = platforms.find((plat) => platformKey(plat) === ai.aiClimbTargetKey);
  if (!targetPlatform) {
    ai.aiClimbTargetKey = "";
    ai.aiClimbTargetX = 0;
    ai.aiClimbLandingX = 0;
    return false;
  }

  const aiCenter = centerX(ai);
  const preferredLandingX = getOpenPlatformLandingX(
    ai,
    opp,
    targetPlatform,
    ai.aiClimbLandingX || targetPlatform.x + targetPlatform.width / 2
  );
  ai.aiClimbLandingX = preferredLandingX;
  const targetX = clampToPlatform(targetPlatform, preferredLandingX, 24);
  const insideLandingZone =
    aiCenter >= targetPlatform.x + 12 &&
    aiCenter <= targetPlatform.x + targetPlatform.width - 12;
  const direction = insideLandingZone
    ? 0
    : targetX > aiCenter
    ? 1
    : -1;

  if (direction !== 0) ai.facing = direction;
  ai.vx = direction * ai.speed;
  ai.blocking = false;
  ai.ducking = false;
  ai.attacking = false;
  ai.attackTimer = 0;
  ai.attackType = "";
  ai.attackHeight = "";
  return true;
};

const tryDropToOpponent = (ai, opp) => {
  if (!ai.grounded || ai.ducking) return false;
  if (
    ai.aiPlatformLoopLockTimer > 0 ||
    (ai.aiVerticalRouteCooldown > 0 && ai.aiLastVerticalAction === "climb")
  ) return false;
  if (centerY(opp) <= centerY(ai) + 70) return false;
  const platform = getPlatformFighterIsOn(ai);
  if (!platform || platform.width >= WORLD_W - 4) return false;

  const aiCenter = centerX(ai);
  const oppCenter = centerX(opp);
  const aiToLeftEdge = Math.abs(aiCenter - platform.x);
  const aiToRightEdge = Math.abs(aiCenter - (platform.x + platform.width));
  const oppOutsideLeft = oppCenter < platform.x;
  const oppOutsideRight = oppCenter > platform.x + platform.width;
  const direction = oppOutsideLeft ? -1 : oppOutsideRight ? 1 : aiToLeftEdge < aiToRightEdge ? -1 : 1;

  ai.facing = direction;
  ai.vx = direction * ai.speed;
  ai.blocking = false;
  ai.ducking = false;
  ai.attacking = false;
  ai.aiDropDir = direction;
  ai.aiDropCommitTimer = 45;
  ai.aiLastVerticalAction = "drop";
  ai.aiVerticalRouteCooldown = 90;
  return true;
};

const chaseOpponentLevel = (ai, opp) => {
  const verticalGap = centerY(opp) - centerY(ai);
  ai.aiVerticalHold = false;
  const opponentPlatform = getTargetPlatformForFighter(opp);
  const avoidingOccupiedRoute =
    verticalGap < -55 &&
    opponentPlatform &&
    ai.aiAvoidPlatformTimer > 0 &&
    ai.aiAvoidPlatformKey === platformKey(opponentPlatform);
  if (avoidingOccupiedRoute) {
    clearAiNavigation(ai);
    const horizontalGap = Math.abs(centerX(opp) - centerX(ai));
    if ((ai.aiRecoveryTimer || 0) <= 0) {
      ai.aiRecoveryDir = getAiOpenDirection(ai, opp);
      ai.aiRecoveryTimer = Math.min(60, ai.aiAvoidPlatformTimer);
    }
    if (ai.x < 24) ai.aiRecoveryDir = 1;
    else if (ai.x + ai.width > WORLD_W - 24) ai.aiRecoveryDir = -1;
    if (horizontalGap < 125) {
      ai.facing = ai.aiRecoveryDir || 1;
      ai.vx = ai.facing * ai.speed * 0.82;
      ai.blocking = false;
      ai.ducking = false;
      return true;
    }
    ai.aiVerticalHold = true;
    ai.vx = 0;
    return false;
  }
  if (ai.aiPlatformLoopLockTimer > 0 && Math.abs(verticalGap) > 55) {
    clearAiNavigation(ai);
    if ((ai.aiRecoveryTimer || 0) <= 0) {
      ai.aiRecoveryDir = getAiOpenDirection(ai, opp);
      ai.aiRecoveryTimer = Math.min(60, ai.aiPlatformLoopLockTimer);
    }
    if (ai.x < 24) ai.aiRecoveryDir = 1;
    else if (ai.x + ai.width > WORLD_W - 24) ai.aiRecoveryDir = -1;
    ai.facing = ai.aiRecoveryDir || 1;
    ai.vx = ai.facing * ai.speed;
    ai.blocking = false;
    ai.ducking = false;
    return true;
  }

  if (ai.aiFailedClimbCooldown > 0 && verticalGap < -55) {
    ai.aiClimbTargetKey = "";
    ai.aiClimbTargetX = 0;
    ai.aiClimbLandingX = 0;
    ai.aiLevelPathTimer = 0;
    if (ai.grounded && !ai.ducking) {
      if ((ai.aiRecoveryTimer || 0) <= 0) {
        ai.aiRecoveryDir = getAiOpenDirection(ai, opp);
        ai.aiRecoveryTimer = Math.min(54, ai.aiFailedClimbCooldown);
      }
      if (ai.x < 24) ai.aiRecoveryDir = 1;
      else if (ai.x + ai.width > WORLD_W - 24) ai.aiRecoveryDir = -1;
      ai.facing = ai.aiRecoveryDir || 1;
      ai.vx = ai.facing * ai.speed * 0.82;
      ai.blocking = false;
      ai.attacking = false;
      return true;
    }
  }

  if (ai.grounded && Math.abs(verticalGap) < 55 && ai.aiDropCommitTimer <= 0) {
    ai.aiLevelPathTimer = 0;
    ai.aiDropCommitTimer = 0;
    ai.aiDropDir = 0;
    ai.aiClimbTargetKey = "";
    ai.aiClimbTargetX = 0;
    ai.aiClimbLandingX = 0;
    return false;
  }

  if (ai.aiDropCommitTimer > 0 && ai.grounded) {
    ai.aiDropCommitTimer--;
    const direction = ai.aiDropDir || (centerX(opp) > centerX(ai) ? 1 : -1);

    ai.facing = direction;
    ai.vx = direction * ai.speed;
    ai.blocking = false;
    ai.ducking = false;
    ai.attacking = false;

    return true;
  }

  if (!ai.grounded && ai.aiDropDir) {
    ai.facing = ai.aiDropDir;
    ai.vx = ai.aiDropDir * ai.speed;
    ai.blocking = false;
    ai.ducking = false;
    ai.attacking = false;
    return true;
  }

  if (continueClimbJump(ai, opp)) {
    ai.aiLevelPathTimer = 18;
    return true;
  }

  if (verticalGap > 55 && tryDropToOpponent(ai, opp)) {
    ai.aiLevelPathTimer = 24;
    ai.aiClimbTargetKey = "";
    ai.aiClimbTargetX = 0;
    ai.aiClimbLandingX = 0;
    return true;
  }

  if (verticalGap < -55) {
    if (tryClimbTowardOpponent(ai, opp)) {
      ai.aiLevelPathTimer = 18;
      return true;
    }


    if (tryJumpToPlatform(ai, opp)) {
      ai.aiLevelPathTimer = 18;
      return true;
    }

    if (ai.grounded && !ai.ducking) {
      moveToward(ai, opp, 1);
      ai.aiLevelPathTimer = 18;
      return true;
    }
  }

  if (ai.aiLevelPathTimer > 0) {
    ai.aiLevelPathTimer--;
    if (Math.abs(verticalGap) > 55) {
      const activeClimbTarget = ai.aiClimbTargetKey
        ? platforms.find((plat) => platformKey(plat) === ai.aiClimbTargetKey)
        : null;
      const targetX = activeClimbTarget
        ? clampToPlatform(activeClimbTarget, ai.aiClimbTargetX || activeClimbTarget.x + activeClimbTarget.width / 2)
        : centerX(opp);
      const direction = ai.aiDropDir || (targetX > centerX(ai) ? 1 : -1);
      ai.facing = direction;
      ai.vx = direction * ai.speed;
    }
    return true;
  }

  return false;
};

const updateAiTargetRead = (ai, opp) => {
  const settings = getAiSettings(ai);
  if (ai.aiObservedTargetId !== opp.id) {
    ai.aiObservedTargetId = opp.id;
    ai.aiObservedTargetX = opp.x;
    ai.aiObservedTargetY = opp.y;
    ai.aiPerceivedTargetX = opp.x;
    ai.aiPerceivedTargetY = opp.y;
    ai.aiAimOffsetX = 0;
    ai.aiAimOffsetY = 0;
    ai.aiAimDriftTimer = 0;
    ai.aiObservationTimer = settings.reactionTime;
    ai.aiObservationRevision = 0;
    ai.aiLastReadRevision = -1;
    ai.aiObservedState = {
      attacking: false,
      attackType: "",
      attackHeight: "",
      blocking: false,
      ducking: false,
      grounded: true,
      vx: 0,
      vy: 0,
      frozen: false,
      hitstun: false,
      spearStunned: false,
      blockDisabled: false,
      jumpDisabled: false,
      damageAmpTimer: 0,
    };
    ai.aiAttackReactionTimer = 0;
    ai.aiDefenseRollRevision = -1;
    ai.aiTargetStillTimer = 0;
    return;
  }

  const moved =
    Math.abs((ai.aiObservedTargetX ?? opp.x) - opp.x) +
    Math.abs((ai.aiObservedTargetY ?? opp.y) - opp.y);

  ai.aiTargetStillTimer = moved < 1.2 ? (ai.aiTargetStillTimer || 0) + 1 : 0;
  ai.aiObservedTargetX = opp.x;
  ai.aiObservedTargetY = opp.y;


  ai.aiObservationTimer = Math.max(0, (ai.aiObservationTimer || 0) - 1);
  if (!ai.aiObservedState || ai.aiObservationTimer <= 0) {
    const previousState = ai.aiObservedState;
    const nextState = {
      attacking: !!opp.attacking,
      attackType: opp.attackType || "",
      attackHeight: opp.attackHeight || "",
      blocking: !!opp.blocking,
      ducking: !!opp.ducking,
      grounded: !!opp.grounded,
      vx: opp.vx || 0,
      vy: opp.vy || 0,
      frozen: !!opp.frozen,
      hitstun: !!opp.hitstun,
      spearStunned: !!opp.spearStunned,
      blockDisabled: !!opp.blockDisabled,
      jumpDisabled: !!opp.jumpDisabled,
      damageAmpTimer: opp.damageAmpTimer || 0,
    };
    ai.aiObservedState = nextState;
    ai.aiObservationRevision = (ai.aiObservationRevision || 0) + 1;

    const newlySeenAttack =
      nextState.attacking &&
      (!previousState?.attacking || previousState.attackType !== nextState.attackType);
    if (newlySeenAttack) {
      ai.aiAttackReactionTimer = Math.max(
        2,
        settings.defenseReaction + Math.round((rand() * 2 - 1) * settings.observationJitter * 0.25)
      );
    } else if (!nextState.attacking) {
      ai.aiAttackReactionTimer = 0;
    }

    const jitter = (rand() * 2 - 1) * settings.observationJitter;
    ai.aiObservationTimer = Math.max(3, Math.round(settings.reactionTime + jitter));
  }

  ai.aiAimDriftTimer = Math.max(0, (ai.aiAimDriftTimer || 0) - 1);
  if (ai.aiAimDriftTimer <= 0) {
    const stillBonus = (ai.aiTargetStillTimer || 0) > 90 ? 0.45 : 1;
    ai.aiAimOffsetX = (rand() * 2 - 1) * settings.aimError * stillBonus;
    ai.aiAimOffsetY = (rand() * 2 - 1) * settings.verticalError * stillBonus;
    ai.aiAimDriftTimer = Math.max(10, settings.reactionTime + 12 + Math.floor(rand() * 20));
  }

  const lag = settings.targetLag;
  const desiredX = opp.x + (ai.aiAimOffsetX || 0);
  const desiredY = opp.y + (ai.aiAimOffsetY || 0);
  ai.aiPerceivedTargetX = (ai.aiPerceivedTargetX ?? opp.x) + (desiredX - (ai.aiPerceivedTargetX ?? opp.x)) * lag;
  ai.aiPerceivedTargetY = (ai.aiPerceivedTargetY ?? opp.y) + (desiredY - (ai.aiPerceivedTargetY ?? opp.y)) * lag;
};

const getAiPerceivedTarget = (ai, opp) => ({
  ...opp,
  ...(ai.aiObservedState || {}),
  x: Math.max(0, Math.min(WORLD_W - opp.width, ai.aiPerceivedTargetX ?? opp.x)),
  y: Math.max(0, Math.min(WORLD_H - opp.height, ai.aiPerceivedTargetY ?? opp.y)),
});

const updateAiMovementMemory = (ai, opp) => {
  const moved =
    Math.abs((ai.aiLastX ?? ai.x) - ai.x) +
    Math.abs((ai.aiLastY ?? ai.y) - ai.y);
  const needsProgress =
    Math.abs(centerX(opp) - centerX(ai)) > 135 ||
    Math.abs(centerY(opp) - centerY(ai)) > 70;
  const busy =
    ai.attacking ||
    ai.charging ||
    ai.healing ||
    ai.reflecting ||
    ai.spearLocked ||
    ai.purpleCharging ||
    ai.orangeCharging ||
    ai.transparentBurrowing ||
    ai.grayHammerTimer > 0 ||
    ai.brownCharging;

  ai.aiStuckTimer = needsProgress && !busy && moved < 0.45 ? (ai.aiStuckTimer || 0) + 1 : 0;
  ai.aiLastX = ai.x;
  ai.aiLastY = ai.y;

  const moveDirection = Math.abs(ai.vx || 0) > 1 ? Math.sign(ai.vx) : 0;
  if ((ai.aiDirectionChangeTimer || 0) > 0) ai.aiDirectionChangeTimer--;
  else ai.aiDirectionChangeCount = 0;
  if (moveDirection && ai.aiLastMoveDirection && moveDirection !== ai.aiLastMoveDirection) {
    ai.aiDirectionChangeCount = (ai.aiDirectionChangeCount || 0) + 1;
    ai.aiDirectionChangeTimer = 55;
    if (ai.aiDirectionChangeCount >= 4) {
      ai.aiOscillationDir = ai.aiEscapeDir || getAiOpenDirection(ai, opp);
      ai.aiOscillationLockTimer = 42;
      ai.aiDirectionChangeCount = 0;
      clearAiNavigation(ai);
    }
  }
  if (moveDirection) ai.aiLastMoveDirection = moveDirection;

  if (ai.grounded && Math.abs(centerY(opp) - centerY(ai)) < 55 && (ai.aiJumpLoopCooldown || 0) <= 0) {
    ai.aiGroundedStableTimer = (ai.aiGroundedStableTimer || 0) + 1;
    if (ai.aiGroundedStableTimer >= 36) {
      ai.aiLastJumpAction = "";
      ai.aiSameJumpCount = 0;
    }
  } else {
    ai.aiGroundedStableTimer = 0;
  }

  if (ai.aiLastAbilityTimer > 0) ai.aiLastAbilityTimer--;
  if (ai.aiComboTimer > 0) ai.aiComboTimer--;
  else ai.aiComboHits = 0;
  if (ai.aiActionTimer > 0) ai.aiActionTimer--;
  if (ai.aiAttackReactionTimer > 0) ai.aiAttackReactionTimer--;
  if (ai.aiDefenseCooldown > 0) ai.aiDefenseCooldown--;
  if (ai.aiEscapeTimer > 0) ai.aiEscapeTimer--;
  if (ai.aiRecoveryTimer > 0) ai.aiRecoveryTimer--;
  if (ai.aiOscillationLockTimer > 0) ai.aiOscillationLockTimer--;
  if (ai.aiJumpCooldown > 0) ai.aiJumpCooldown--;
  if (ai.aiJumpLoopCooldown > 0) {
    ai.aiJumpLoopCooldown--;
    if (ai.aiJumpLoopCooldown <= 0) {
      ai.aiLastJumpAction = "";
      ai.aiSameJumpCount = 0;
    }
  }
  if (ai.aiAvoidPlatformTimer > 0) {
    ai.aiAvoidPlatformTimer--;
    if (ai.aiAvoidPlatformTimer <= 0) ai.aiAvoidPlatformKey = "";
  }
  if (ai.aiFailedClimbCooldown > 0) ai.aiFailedClimbCooldown--;
  if (ai.aiCornerEscapeCooldown > 0) ai.aiCornerEscapeCooldown--;
  if (ai.aiStackEscapeCooldown > 0) ai.aiStackEscapeCooldown--;
  if (ai.aiHeadStackTimer > 0) ai.aiHeadStackTimer--;
  if (ai.aiGuardPressure > 0) ai.aiGuardPressure = Math.max(0, ai.aiGuardPressure - 0.35);
  if (ai.aiPlatformLoopLockTimer > 0) ai.aiPlatformLoopLockTimer--;
  if (ai.aiVerticalRouteCooldown > 0) {
    ai.aiVerticalRouteCooldown--;
  } else {
    ai.aiLastVerticalAction = "";
  }
  if (ai.aiActionCooldowns) {
    for (const key of Object.keys(ai.aiActionCooldowns)) {
      if (ai.aiActionCooldowns[key] > 0) ai.aiActionCooldowns[key]--;
    }
  }
};

const updateAiPlayerRead = (ai, opp, incoming) => {
  const read = ai.aiRead || { rush: 0, turtle: 0, airborne: 0, projectile: 0, low: 0, retreat: 0, camping: 0 };
  const settings = getAiSettings(ai);
  const rate = settings.adaptRate || 0.5;
  const dx = Math.abs(centerX(opp) - centerX(ai));
  const decay = 0.992;

  for (const key of ["rush", "turtle", "airborne", "projectile", "low", "retreat", "camping"]) {
    read[key] = (read[key] || 0) * decay;
  }


  const hasNewObservation = ai.aiLastReadRevision !== ai.aiObservationRevision;
  if (hasNewObservation) {
    const previous = ai.aiLastHabitState;
    const previousDistance = ai.aiLastReadDistance ?? dx;
    const distanceGrowth = dx - previousDistance;

    if (dx < 130 && (Math.abs(opp.vx || 0) > 1.5 || opp.attacking)) read.rush += rate;
    if (opp.blocking) read.turtle += rate * 1.25;
    if (opp.ducking || opp.attackHeight === "low") read.low += rate;
    if (!opp.grounded) read.airborne += rate * (previous?.grounded === false ? 0.65 : 2.2);
    if (distanceGrowth > 7 && Math.abs(opp.vx || 0) > 1) read.retreat += rate * 1.5;
    if ((ai.aiTargetStillTimer || 0) > 75 && dx > 150) read.camping += rate * 1.25;

    ai.aiLastHabitState = {
      grounded: !!opp.grounded,
      blocking: !!opp.blocking,
      attackType: opp.attackType || "",
    };
    ai.aiLastReadDistance = dx;
    ai.aiLastReadRevision = ai.aiObservationRevision;
  }

  const visibleProjectile =
    incoming ||
    projectiles.current.find((proj) => proj.team !== ai.team && proj.owner?.id === opp.id);
  if (visibleProjectile && visibleProjectile !== ai.aiLastReadProjectile) {
    read.projectile += 0.55 + rate * 2.1;
    ai.aiLastReadProjectile = visibleProjectile;
  } else if (!visibleProjectile) {
    ai.aiLastReadProjectile = null;
  }

  ai.aiRead = read;
  return read;
};

const clearAiCombatLocks = (ai) => {
  ai.healing = false;
  ai.charging = false;
  ai.chargeFrames = 0;
  ai.purpleCharging = false;
  ai.purpleChargeTimer = 0;
  ai.orangeCharging = false;
  ai.orangeChargeTimer = 0;
  ai.reflecting = false;
  ai.reflectTimer = 0;
  ai.spearLocked = false;
  ai.pinkParrying = false;
  ai.pinkParryTimer = 0;
  ai.brownCharging = false;
  ai.brownChargeTimer = 0;
  ai.brownPhasing = false;
  ai.transparentBurrowing = false;
  ai.transparentBurrowTimer = 0;
  ai.transparentPoundChargeTimer = 0;
  ai.transparentPoundActiveTimer = 0;
  ai.grayHammerTimer = 0;
  ai.grayHammerRotation = 0;
  ai.grayHammerHitIds = {};
  ai.attacking = false;
  ai.attackTimer = 0;
  ai.attackType = "";
  ai.attackHeight = "";
  ai.blocking = false;
  ai.ducking = false;
  ai.vx = 0;
  ai.aiLockTimer = 0;
  ai.aiDefenseTimer = 0;
  ai.aiLastAbilityTimer = Math.max(ai.aiLastAbilityTimer || 0, 20);
};

const updateAiLockWatchdog = (ai) => {
  const locked =
    ai.healing ||
    ai.charging ||
    ai.purpleCharging ||
    ai.orangeCharging ||
    ai.reflecting ||
    ai.spearLocked ||
    ai.pinkParrying ||
    ai.brownCharging ||
    ai.brownPhasing ||
    ai.transparentBurrowing ||
    ai.transparentPoundChargeTimer > 0 ||
    ai.transparentPoundActiveTimer > 0 ||
    ai.grayHammerTimer > 0;

  if (!locked) {
    ai.aiLockTimer = 0;
    return false;
  }

  ai.aiLockTimer = (ai.aiLockTimer || 0) + 1;
  if (ai.aiLockTimer <= getAiSettings(ai).maxLockFrames) return false;

  clearAiCombatLocks(ai);
  return true;
};

const getAiOpenDirection = (ai, opp) => {
  if (ai.x < 80) return 1;
  if (ai.x + ai.width > WORLD_W - 80) return -1;

  const leftSpace = ai.x;
  const rightSpace = WORLD_W - (ai.x + ai.width);
  if ((ai.aiHeadStackTimer || 0) > 0) return rightSpace >= leftSpace ? 1 : -1;
  return centerX(opp) < centerX(ai) ? 1 : -1;
};

const clearAiNavigation = (ai) => {
  ai.aiClimbTargetKey = "";
  ai.aiClimbTargetX = 0;
  ai.aiClimbLandingX = 0;
  ai.aiDropCommitTimer = 0;
  ai.aiDropDir = 0;
  ai.aiLevelPathTimer = 0;
};

const tryAiEmergencyEscape = (ai, opp) => {
  const stacked = (ai.aiHeadStackTimer || 0) > 0;
  const cornered = ai.x < 58 || ai.x + ai.width > WORLD_W - 58;
  const cornerPressure =
    cornered &&
    Math.abs(centerX(opp) - centerX(ai)) < 145 &&
    ((ai.aiGuardPressure || 0) >= 20 || (ai.aiPressureHits || 0) >= 2);

  if (!stacked && !cornerPressure) return false;

  let direction = ai.aiEscapeDir || getAiOpenDirection(ai, opp);
  if (ai.x < 24) direction = 1;
  else if (ai.x + ai.width > WORLD_W - 24) direction = -1;
  if (stacked && (ai.aiStackEscapeCooldown || 0) > 0) {
    stopDefense(ai);
    ai.ducking = false;
    ai.aiEscapeDir = direction;
    ai.vx = direction * ai.speed;
    return true;
  }
  if (cornerPressure && (ai.aiCornerEscapeCooldown || 0) > 0) return false;

  clearAiCombatLocks(ai);
  clearAiNavigation(ai);
  ai.aiGuardPressure = 0;
  ai.aiPressureHits = 0;
  ai.aiBlockHoldTimer = 0;
  ai.aiDefenseCooldown = 0;
  ai.aiActionCooldowns.block = Math.max(ai.aiActionCooldowns.block || 0, getAiSettings(ai).blockCooldown);
  direction = getAiOpenDirection(ai, opp);
  ai.aiEscapeDir = direction;
  ai.aiEscapeTimer = stacked ? 38 : 32;
  ai.aiAction = "escape";
  ai.aiActionTimer = ai.aiEscapeTimer;
  rememberAiAction(ai, stacked ? "escapeStack" : "escapeCorner");

  if (stacked) {
    ai.aiStackEscapeCooldown = 90;
    ai.vx = direction * ai.speed;
    return true;
  }

  ai.aiCornerEscapeCooldown = 120;
  if (ai.grounded && !ai.jumpDisabled && beginAiJump(ai, direction, null, true)) {
    ai.aiEscapeDir = direction;
    ai.aiEscapeTimer = 32;
    return true;
  }

  ai.vx = direction * ai.speed;
  return true;
};

const tryAiEscapeStuck = (ai, opp, sameLane, incoming) => {
  const settings = getAiSettings(ai);
  if ((ai.aiStuckTimer || 0) < settings.stuckFrames) return false;
  if (rand() > settings.escapeChance && ai.aiStuckTimer < settings.stuckFrames * 1.6) return false;

  clearAiNavigation(ai);
  stopDefense(ai);
  faceTarget(ai, opp);

  if (centerY(opp) > centerY(ai) + 65 && tryDropToOpponent(ai, opp)) {
    ai.aiStuckTimer = 0;
    return true;
  }

  if (ai.grounded && !ai.jumpDisabled) {
    const dir = getAiOpenDirection(ai, opp);
    if (beginAiJump(ai, dir, null, true)) {
      ai.aiEscapeTimer = 24;
      ai.aiEscapeDir = dir;
      ai.aiStuckTimer = 0;
      return true;
    }
  }

  if (tryAiAbility(ai, opp, sameLane, incoming, { force: true, reason: "stuck" })) {
    ai.aiStuckTimer = 0;
    return true;
  }

  const dir = getAiOpenDirection(ai, opp);
  ai.facing = dir;
  ai.vx = dir * ai.speed;
  ai.aiEscapeTimer = 18;
  ai.aiEscapeDir = dir;
  ai.aiStuckTimer = 0;
  return true;
};

const tryAiAbility = (ai, opp, sameLane, incoming, options = {}) => {
  const settings = getAiSettings(ai);
  const read = ai.aiRead || {};
  const dx = Math.abs(centerX(opp) - centerX(ai));
  const force = !!options.force;
  const specialChance = options.chance ?? settings.specialChance;
  const badlyBehind = (opp.health || 0) - (ai.health || 0) >= 24;
  const targetVulnerable =
    opp.frozen ||
    opp.hitstun ||
    opp.spearStunned ||
    opp.blockDisabled ||
    opp.jumpDisabled ||
    !opp.grounded;
  const chance = force
    ? 1
    : Math.min(0.99, (specialChance + Math.max(read.turtle || 0, read.rush || 0, read.airborne || 0) * 0.025) * settings.offenseBias);
  const canTry =
    force ||
    (
      (ai.aiLastAbilityTimer || 0) <= 0 &&
      (ai.aiActionCooldowns?.special || 0) <= 0 &&
      rand() < chance
    );
  if (!canTry || ai.specialDisabled) return false;

  let usedAction = "";
  const tryAbilityAction = (action, condition, begin) => {
    if (usedAction || !condition || !canAiRepeatAction(ai, action)) return false;
    if (!begin()) return false;
    usedAction = action;
    return true;
  };
  const wantsAbility = (action, contextual, naturalChance) => {
    if (force || contextual) return true;
    const recent = (ai.aiActionHistory || []).slice(-3);
    const repetitionScale = recent.includes(action) ? 0.42 : 1;
    return rand() < naturalChance * repetitionScale;
  };

  const thirdMoveContext =
    (ai.type === "fire" && opp.y + opp.height <= ai.y + 22 && dx < 105) ||
    (ai.type === "psychic" && sameLane && dx < 360) ||
    (ai.type === "monochrome" && sameLane && dx < 110) ||
    (ai.type === "gray" && sameLane && dx < 95) ||
    (ai.type === "explosion" && (!ai.grounded || centerY(opp) > centerY(ai))) ||
    (ai.type === "pink" && ai.pinkTeleportMarker && ai.pinkTeleportArmTimer <= 0) ||
    (ai.type === "electric" && dx > 90) ||
    targetVulnerable || badlyBehind;

  tryAbilityAction(
    `${ai.type}Special3`,
    (ai.canSpecial3 || (ai.type === "pink" && ai.pinkTeleportMarker) || (ai.type === "explosion" && ai.harpoonTargetId)) && wantsAbility(`${ai.type}Special3`, thirdMoveContext, 0.56),
    () => beginSpecial3(ai, opp)
  );

  if (!usedAction) switch (ai.type) {
    case "rainbow":
      tryAbilityAction(
        "rainbowSummon",
        ai.canSpecial2 && !getActiveRainbowSummon(ai) && wantsAbility("rainbowSummon", badlyBehind || read.rush > 9 || read.turtle > 10, 0.42),
        () => beginRainbowSummon(ai)
      ) ||
      tryAbilityAction(
        "rainbowTurret",
        ai.canProjectile && dx > 95 && wantsAbility("rainbowTurret", dx > 155 || read.airborne > 6, 0.74),
        () => beginRainbowTurret(ai)
      );
      break;
    case "monochrome":
      tryAbilityAction(
        "monochromeMissile",
        ai.canProjectile && dx > 95 && wantsAbility("monochromeMissile", read.airborne > 6 || dx > 165, 0.7),
        () => beginMonochromeMissile(ai)
      ) ||
      tryAbilityAction(
        "monochromeWave",
        ai.canSpecial2 && dx > 70 && dx < 650 && wantsAbility("monochromeWave", badlyBehind || read.turtle > 6 || targetVulnerable, 0.5),
        () => beginMonochromeWave(ai)
      );
      break;
    case "pink":
      tryAbilityAction(
        "pinkParry",
        ai.canSpecial2 && sameLane && dx < 165 && wantsAbility("pinkParry", opp.attacking || read.rush > 7, 0.16),
        () => beginPinkParry(ai)
      ) ||
      tryAbilityAction(
        "pinkPlus",
        ai.canProjectile && dx > 80 && wantsAbility("pinkPlus", read.airborne > 6 || read.turtle > 8 || dx > 150, 0.76),
        () => beginPinkPlus(ai)
      );
      break;
    case "brown":
      tryAbilityAction(
        "brownShift",
        ai.canProjectile && dx > 105 && wantsAbility("brownShift", incoming || read.projectile > 6 || dx > 230, 0.48),
        () => beginBrownShift(ai)
      ) ||
      tryAbilityAction(
        "brownArmor",
        ai.canSpecial2 && dx < 285 && wantsAbility("brownArmor", badlyBehind || read.rush > 6 || targetVulnerable, 0.58),
        () => beginBrownArmorCharge(ai)
      );
      break;
    case "gray":
      tryAbilityAction(
        "grayWind",
        ai.canProjectile && dx > 80 && wantsAbility("grayWind", dx > 115 || read.airborne > 6, 0.68),
        () => beginGrayWind(ai)
      ) ||
      tryAbilityAction(
        "grayHammer",
        ai.canSpecial2 && sameLane && dx < 145 && wantsAbility("grayHammer", read.rush > 5 || targetVulnerable, 0.55),
        () => beginGrayHammer(ai)
      );
      break;
    case "transparent":
      tryAbilityAction(
        "transparentBurrow",
        ai.canProjectile && dx > 100 && wantsAbility("transparentBurrow", read.turtle > 6 || dx > 180, 0.64),
        () => beginTransparentBurrow(ai)
      ) ||
      tryAbilityAction(
        "transparentPound",
        ai.canSpecial2 && dx > 65 && dx < 540 && wantsAbility("transparentPound", read.rush > 7 || targetVulnerable, 0.48),
        () => beginTransparentPound(ai)
      );
      break;
    case "psychic":
      tryAbilityAction(
        "psychicPowerUp",
        ai.canSpecial2 && ai.speedBoostTimer <= 0 && dx > 125 && wantsAbility("psychicPowerUp", badlyBehind || dx > 180 || read.projectile > 6, 0.45),
        () => beginPurplePowerUp(ai)
      ) ||
      tryAbilityAction(
        "psychicProjectile",
        ai.canProjectile && sameLane && dx > 105 && dx < 480 && wantsAbility("psychicProjectile", read.turtle > 6 || targetVulnerable, 0.74),
        () => beginProjectile(ai)
      );
      break;
    case "electric":
      tryAbilityAction(
        "electricReflect",
        incoming && ai.canSpecial2,
        () => beginYellowReflect(ai)
      ) ||
      tryAbilityAction(
        "electricSpear",
        ai.canProjectile && sameLane && dx > 120 && dx < 540 && wantsAbility("electricSpear", read.airborne > 5 || read.projectile > 5 || targetVulnerable, 0.72),
        () => beginProjectile(ai)
      );
      break;
    case "explosion":
      tryAbilityAction(
        "explosionDownShotgun",
        ai.canSpecial2 && wantsAbility("explosionDownShotgun", targetVulnerable || read.rush > 5 || read.airborne > 4 || dx < 170, 0.5),
        () => beginOrangeDownShotgun(ai)
      ) ||
      tryAbilityAction(
        "explosionBurst",
        ai.canProjectile && sameLane && dx > 100 && dx < 460 && wantsAbility("explosionBurst", read.airborne > 5 || targetVulnerable || ai.cooldownBoostTimer > 0, 0.74),
        () => beginProjectile(ai)
      );
      break;
    case "light":
      tryAbilityAction(
        "lightDrop",
        ai.canSpecial2 && dx > 75 && dx < 580 && wantsAbility("lightDrop", read.turtle > 5 || read.airborne > 5 || targetVulnerable, 0.52),
        () => beginWhiteDrop(ai, opp)
      ) ||
      tryAbilityAction(
        "lightLowShot",
        ai.canProjectile && sameLane && dx > 85 && dx < 460 && wantsAbility("lightLowShot", read.low < 5 || targetVulnerable, 0.72),
        () => beginProjectile(ai)
      );
      break;
    case "poison":
      tryAbilityAction(
        "poisonHeal",
        ai.canSpecial2 && ai.health <= settings.healHealth && dx > Math.max(120, settings.healSafeDistance - 80) && !incoming,
        () => beginPoisonHeal(ai)
      ) ||
      tryAbilityAction(
        "poisonOrb",
        ai.canProjectile && sameLane && dx > 90 && dx < 450 && wantsAbility("poisonOrb", read.turtle > 5 || targetVulnerable, 0.78),
        () => beginProjectile(ai)
      );
      break;
    case "void":
      tryAbilityAction(
        "voidCharge",
        ai.canSpecial2 && sameLane && dx > 130 && dx < 535 && wantsAbility("voidCharge", badlyBehind || read.turtle > 5 || read.projectile > 5 || targetVulnerable, 0.54),
        () => beginVoidCharge(ai)
      ) ||
      tryAbilityAction(
        "voidProjectile",
        ai.canProjectile && sameLane && dx > 100 && dx < 450 && wantsAbility("voidProjectile", targetVulnerable, 0.7),
        () => beginProjectile(ai)
      );
      break;
    case "ice":
      tryAbilityAction(
        "iceSlowOrb",
        ai.canSpecial2 && sameLane && dx > 90 && dx < 460 && wantsAbility("iceSlowOrb", badlyBehind || read.rush > 5 || read.turtle > 6 || targetVulnerable, 0.48),
        () => beginIceSlowOrb(ai)
      ) ||
      tryAbilityAction(
        "iceProjectile",
        ai.canProjectile && sameLane && dx > 95 && dx < 450 && wantsAbility("iceProjectile", targetVulnerable, 0.74),
        () => beginProjectile(ai)
      );
      break;
    case "fire":
      tryAbilityAction(
        "fireDash",
        ai.canSpecial2 && sameLane && dx > 85 && dx < 330 && wantsAbility("fireDash", read.turtle > 5 || targetVulnerable || ai.x < 70 || ai.x + ai.width > WORLD_W - 70, 0.56),
        () => beginRedDash(ai)
      ) ||
      tryAbilityAction(
        "fireProjectile",
        ai.canProjectile && sameLane && dx > 115 && dx < 450 && wantsAbility("fireProjectile", read.airborne > 5 || read.turtle > 5, 0.74),
        () => beginProjectile(ai)
      );
      break;
    default:
      tryAbilityAction(
        "projectile",
        ai.canProjectile && sameLane && dx > 130,
        () => beginProjectile(ai)
      );
      break;
  }

  if (usedAction) {
    rememberAiAction(ai, usedAction);
    ai.aiActionCooldowns.special = force
      ? Math.max(20, Math.round(settings.specialCooldown * 0.5))
      : settings.specialCooldown;
    ai.aiLastAbilityTimer = force ? 18 : Math.max(settings.reactionTime, settings.specialCooldown);
    return true;
  }
  return false;
};

const getAiTactic = (ai, opp, targetStill) => {
  const settings = getAiSettings(ai);
  const read = ai.aiRead || {};
  const counterplay = settings.counterplay || 0.5;
  const habitThreshold = 14 - counterplay * 4;
  const spacingScale = settings.spacing / 92;
  const scaleSpacing = (value) => Math.round(value * spacingScale);
  const healthDeficit = Math.max(0, (opp.health || 0) - (ai.health || 0));
  const badlyBehind = healthDeficit >= 24;
  const criticalHealth = ai.health <= 30;
  let spacingAdjustment = 0;
  let spacingCap = Infinity;
  const tactic = {
    spacing: settings.spacing,
    meleeRange: settings.meleeRange,
    aggression: settings.aggression,
    specialChance: settings.specialChance,
    projectileRange: settings.projectileRange,
    pressureChance: settings.neutralPressureChance,
    defenseBoost: badlyBehind ? 0.1 + (criticalHealth ? 0.05 : 0) : 0,
    punishBoost: badlyBehind ? 0.08 + (criticalHealth ? 0.04 : 0) : 0,
    mistakeScale: badlyBehind ? (criticalHealth ? 0.32 : 0.55) : 1,
    projectileAdvanceScale: badlyBehind ? 0.72 : 1,
    badlyBehind,
  };

  if (targetStill) {
    spacingAdjustment -= 34 * counterplay;
    tactic.aggression = Math.min(1.35, tactic.aggression + 0.3 * counterplay);
    tactic.specialChance = Math.min(0.98, tactic.specialChance + 0.2 * counterplay);
  }

  if (read.rush > habitThreshold) {
    spacingAdjustment += 26 * counterplay;
    tactic.specialChance += 0.1 * counterplay;
  }

  if (read.turtle > habitThreshold) {
    spacingAdjustment -= 24 * counterplay;
    tactic.aggression += 0.2 * counterplay;
    tactic.specialChance += 0.16 * counterplay;
  }

  if (read.airborne > habitThreshold - 2) {
    tactic.meleeRange += 14 * counterplay;
    tactic.projectileRange = Math.max(70, tactic.projectileRange - 20 * counterplay);
    tactic.specialChance += 0.12 * counterplay;
  }

  if (read.projectile > habitThreshold - 2) {
    spacingCap = 112;
    tactic.aggression += 0.16 * counterplay;
    tactic.specialChance += 0.12 * counterplay;
  }

  if (read.retreat > habitThreshold - 3 || read.camping > habitThreshold - 3) {
    spacingAdjustment -= 32 * counterplay;
    tactic.aggression += 0.24 * counterplay;
    tactic.specialChance += 0.08 * counterplay;
  }

  switch (ai.type) {
    case "fire":
      tactic.spacing = scaleSpacing(badlyBehind ? 78 : 58);
      tactic.aggression += 0.32;
      tactic.pressureChance = badlyBehind ? 0.76 : 0.96;
      tactic.specialChance += badlyBehind ? 0.16 : 0.08;
      break;
    case "ice":
      tactic.spacing = scaleSpacing(badlyBehind ? 178 : 132);
      tactic.projectileRange = 115;
      tactic.pressureChance = badlyBehind ? 0.28 : 0.46;
      tactic.specialChance += badlyBehind ? 0.18 : 0.08;
      break;
    case "poison":
      tactic.spacing = scaleSpacing(badlyBehind || ai.health < 65 ? 255 : 150);
      tactic.projectileRange = 95;
      tactic.pressureChance = badlyBehind ? 0.22 : 0.52;
      tactic.specialChance += badlyBehind ? 0.22 : 0.08;
      break;
    case "void":
      tactic.spacing = scaleSpacing(ai.charging ? 280 : badlyBehind ? 205 : 158);
      tactic.projectileRange = 125;
      tactic.pressureChance = badlyBehind ? 0.3 : 0.5;
      tactic.specialChance += badlyBehind ? 0.18 : 0.1;
      break;
    case "light":
      tactic.spacing = scaleSpacing(badlyBehind ? 168 : 126);
      tactic.projectileRange = 90;
      tactic.pressureChance = badlyBehind ? 0.3 : 0.5;
      tactic.specialChance += badlyBehind ? 0.16 : 0.08;
      break;
    case "psychic":
      tactic.spacing = scaleSpacing(opp.damageAmpTimer > 0 || ai.speedBoostTimer > 0 ? 58 : badlyBehind ? 195 : 145);
      tactic.aggression += opp.damageAmpTimer > 0 || ai.speedBoostTimer > 0 ? 0.48 : 0.1;
      tactic.pressureChance = opp.damageAmpTimer > 0 || ai.speedBoostTimer > 0 ? 0.96 : badlyBehind ? 0.28 : 0.5;
      tactic.specialChance += badlyBehind ? 0.18 : 0.08;
      break;
    case "electric":
      tactic.spacing = scaleSpacing(badlyBehind ? 205 : 158);
      tactic.projectileRange = 120;
      tactic.pressureChance = badlyBehind ? 0.3 : 0.48;
      tactic.specialChance += badlyBehind ? 0.16 : 0.08;
      break;
    case "explosion":
      tactic.spacing = scaleSpacing(ai.cooldownBoostTimer > 0 ? 105 : badlyBehind ? 205 : 155);
      tactic.pressureChance = ai.cooldownBoostTimer > 0 ? 0.82 : badlyBehind ? 0.3 : 0.5;
      tactic.specialChance += ai.cooldownBoostTimer > 0 ? 0.2 : badlyBehind ? 0.16 : 0.08;
      break;
    case "rainbow":
      tactic.spacing = scaleSpacing(badlyBehind ? 225 : 178);
      tactic.projectileRange = 100;
      tactic.pressureChance = badlyBehind ? 0.24 : 0.42;
      tactic.specialChance += badlyBehind ? 0.24 : 0.14;
      break;
    case "monochrome":
      tactic.spacing = scaleSpacing(badlyBehind ? 158 : 118);
      tactic.projectileRange = 80;
      tactic.pressureChance = badlyBehind ? 0.34 : 0.58;
      tactic.specialChance += badlyBehind ? 0.24 : 0.18;
      break;
    case "transparent":
      tactic.spacing = scaleSpacing(badlyBehind ? 112 : 82);
      tactic.aggression += 0.26;
      tactic.pressureChance = badlyBehind ? 0.68 : 0.92;
      tactic.specialChance += badlyBehind ? 0.18 : 0.1;
      break;
    case "gray":
      tactic.spacing = scaleSpacing(badlyBehind ? 92 : 64);
      tactic.meleeRange += 12;
      tactic.aggression += 0.3;
      tactic.pressureChance = badlyBehind ? 0.72 : 0.98;
      tactic.specialChance += badlyBehind ? 0.16 : 0.08;
      break;
    case "brown":
      tactic.spacing = scaleSpacing(ai.brownInvulnTimer > 0 ? 58 : badlyBehind ? 128 : 92);
      tactic.aggression += ai.brownInvulnTimer > 0 ? 0.4 : 0.16;
      tactic.pressureChance = ai.brownInvulnTimer > 0 ? 0.98 : badlyBehind ? 0.58 : 0.86;
      tactic.specialChance += badlyBehind ? 0.2 : 0.1;
      break;
    case "pink":
      tactic.spacing = scaleSpacing(badlyBehind ? 245 : 205);
      tactic.projectileRange = 65;
      tactic.pressureChance = badlyBehind ? 0.2 : 0.36;
      tactic.specialChance += badlyBehind ? 0.26 : 0.2;
      break;
    default:
      break;
  }

  tactic.spacing = Math.max(58, Math.min(spacingCap, tactic.spacing + spacingAdjustment));
  tactic.aggression = Math.max(0.25, Math.min(1.45, tactic.aggression));
  tactic.specialChance = Math.max(0.05, Math.min(0.98, tactic.specialChance));
  tactic.pressureChance = Math.max(0.1, Math.min(0.98, tactic.pressureChance));
  return tactic;
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

  updateAiTargetRead(ai, opp);
  const readOpp = getAiPerceivedTarget(ai, opp);
  const dx = centerX(readOpp) - centerX(ai);
  const abs = Math.abs(dx);
  const sameLane = sameVerticalLane(ai, readOpp, 42);
  const readProjectileInput = tryAiReadProjectileInput(ai, opp);
  const incoming = getIncomingProjectile(ai, readProjectileInput ? opp : null);
  updateAiMovementMemory(ai, readOpp);
  updateAiPlayerRead(ai, readOpp, incoming);
  const settings = getAiSettings(ai);
  const targetStill = (ai.aiTargetStillTimer || 0) > settings.campingFrames;
  const tactic = getAiTactic(ai, readOpp, targetStill);
  const retreatRange = tactic.badlyBehind
    ? Math.max(settings.retreatRange, tactic.spacing - 55)
    : settings.retreatRange;
  const projectileResponseThreshold = 9 - settings.counterplay * 3;
  const underProjectilePressure = (ai.aiRead?.projectile || 0) > projectileResponseThreshold;
  const defenseChance = (value) => Math.max(0.02, Math.min(0.96, value * settings.defenseBias + tactic.defenseBoost));
  const offenseChance = (value) => Math.max(0.02, Math.min(0.99, value * settings.offenseBias));

  const targetVulnerable =
    readOpp.frozen ||
    readOpp.hitstun ||
    readOpp.spearStunned ||
    readOpp.blockDisabled ||
    readOpp.jumpDisabled ||
    !readOpp.grounded;

  const aiCornered =
    ai.x < 55 ||
    ai.x + ai.width > WORLD_W - 55;

  if (updateAiLockWatchdog(ai)) return;

  if (ai.transparentBurrowing) {
    ai.vx = (dx >= 0 ? 1 : -1) * 7;
    if (abs < 46 || ai.transparentBurrowTimer < 30) surfaceTransparent(ai);
    return;
  }

  if (ai.special3RollTimer > 0) {
    stopDefense(ai);
    ai.ducking = true;
    ai.vx = ai.facing * 10;
    return;
  }

  if (ai.spearLocked || ai.reflecting || ai.purpleCharging || ai.orangeCharging || ai.blackCharging) {
    stopDefense(ai);
    ai.vx = 0;
    return;
  }

  if (ai.dashTimer > 0) {
    stopDefense(ai);
    ai.vx = ai.facing * 12;
    ai.dashTimer--;
    return;
  }

  if (ai.grayHammerTimer > 0) {
    stopDefense(ai);
    if (abs > 90) moveToward(ai, readOpp, 0.75);
    else if (abs < 55) moveAway(ai, readOpp, 0.45);
    return;
  }

  if (ai.frozen || ai.hitstun || ai.spearStunned) {
    ai.healing = false;
    ai.charging = false;
    ai.chargeFrames = 0;
    ai.purpleCharging = false;
    ai.purpleChargeTimer = 0;
    ai.orangeCharging = false;
    ai.orangeChargeTimer = 0;
    ai.reflecting = false;
    ai.reflectTimer = 0;
    ai.spearLocked = false;
    if (ai.frozen || ai.spearStunned) ai.vx = 0;
    return;
  }

  if (tryAiEmergencyEscape(ai, readOpp)) return;

  if (ai.aiEscapeTimer > 0) {
    stopDefense(ai);
    ai.ducking = false;
    ai.vx = (ai.aiEscapeDir || getAiOpenDirection(ai, readOpp)) * ai.speed;
    return;
  }

  if (ai.aiOscillationLockTimer > 0) {
    if (ai.x < 24) ai.aiOscillationDir = 1;
    else if (ai.x + ai.width > WORLD_W - 24) ai.aiOscillationDir = -1;
    stopDefense(ai);
    clearAiNavigation(ai);
    ai.facing = ai.aiOscillationDir || getAiOpenDirection(ai, readOpp);
    ai.vx = ai.facing * ai.speed;
    return;
  }

  if (ai.charging && ai.type === "void") {
    stopDefense(ai);
    faceTarget(ai, readOpp);

    const shouldRelease =
      ai.chargeFrames >= getAiSettings(ai).chargeMinFrames &&
      sameLane &&
      abs < 560 &&
      (targetVulnerable || abs < 260 || readOpp.blocking);

    const mustRelease =
      ai.chargeFrames >= getAiSettings(ai).chargeMaxFrames ||
      abs < 115;

    if (shouldRelease || mustRelease) {
      releaseVoidCharge(ai);
      return;
    }

    if (abs < 170) moveAway(ai, readOpp, 0.65);
    else if (abs > 390) moveToward(ai, readOpp, 0.45);
    else ai.vx = 0;

    return;
  }

  if (ai.healing) {
    const safeToKeepHealing =
      ai.health < 100 &&
      abs > getAiSettings(ai).healSafeDistance &&
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

  const holdingBlock =
    (ai.aiAction === "block" || ai.aiAction === "lowBlock") &&
    (ai.aiActionTimer || 0) > 0;
  if (holdingBlock) {
    const canAdvancePastProjectile =
      incoming &&
      Math.abs(incoming.vx || 0) >= Math.abs(incoming.vy || 0) &&
      ai.grounded &&
      !ai.jumpDisabled &&
      ai.aiJumpCooldown <= 0 &&
      (readProjectileInput || underProjectilePressure);
    const advanceChance = settings.projectileAdvanceChance * tactic.projectileAdvanceScale * (readProjectileInput ? 1 : 0.55);
    if (canAdvancePastProjectile && rand() < advanceChance) {
      finishAiBlock(ai);
      if (beginAiJump(ai, dx >= 0 ? 1 : -1, null, true)) {
        moveToward(ai, readOpp, Math.min(1, tactic.aggression));
        return;
      }
    }
    const threatStillPlausible =
      incoming ||
      (sameLane && readOpp.attacking && abs < 155) ||
      ((ai.aiBlockHoldTimer || 0) > 0 && sameLane && abs < 118);
    if (threatStillPlausible && (ai.aiDefenseTimer || 0) < settings.maxDefenseHold) {
      if (incoming) {
        ai.aiBlockHeight = incoming.attackHeight === "low" ? "low" : "mid";
      }
      smartBlock(ai, ai.aiBlockHeight || "mid");
      ai.aiDefenseTimer = (ai.aiDefenseTimer || 0) + 1;
      return;
    }
    finishAiBlock(ai);
  } else {
    stopDefense(ai);
  }


  if (!incoming) {
    ai.aiDefendedProjectile = null;
    ai.aiEmergencyProjectile = null;
    ai.aiProjectileMisses = Math.max(0, (ai.aiProjectileMisses || 0) - 0.08);
  }
  const incomingDistance = incoming
    ? Math.abs(incoming.x - centerX(ai))
    : Infinity;
  const firstProjectileDecision =
    incoming && incoming !== ai.aiDefendedProjectile;
  const emergencyProjectileDecision =
    incoming &&
    incoming === ai.aiDefendedProjectile &&
    incoming !== ai.aiEmergencyProjectile &&
    incomingDistance < 100;
  if (
    incoming &&
    (firstProjectileDecision || emergencyProjectileDecision) &&
    (ai.aiActionCooldowns?.block || 0) <= 0
  ) {
    if (firstProjectileDecision) ai.aiDefendedProjectile = incoming;
    if (emergencyProjectileDecision) ai.aiEmergencyProjectile = incoming;

    const projectileHabitBonus = Math.min(0.18, (ai.aiRead?.projectile || 0) * 0.012);
    const missedDefenseBonus = Math.min(0.24, (ai.aiProjectileMisses || 0) * 0.1);
    const reactionChance = emergencyProjectileDecision
      ? 0.3 + settings.accuracy * 0.38 + missedDefenseBonus
      : settings.projectileBlockChance + projectileHabitBonus + missedDefenseBonus;
    const reacts = rand() < defenseChance(reactionChance);

    if (
      reacts &&
      ai.type === "electric" &&
      ai.canSpecial2 &&
      !ai.specialDisabled &&
      (ai.aiActionCooldowns?.special || 0) <= 0 &&
      rand() < settings.accuracy
    ) {
      if (beginYellowReflect(ai)) {
        rememberAiAction(ai, "electricReflect");
        ai.aiActionCooldowns.special = settings.specialCooldown;
        ai.aiProjectileMisses = 0;
        return;
      }
    }

    const canAdvancePastProjectile =
      reacts &&
      Math.abs(incoming.vx || 0) >= Math.abs(incoming.vy || 0) &&
      ai.grounded &&
      !ai.jumpDisabled &&
      ai.aiJumpCooldown <= 0 &&
      (readProjectileInput || underProjectilePressure);
    const advanceChance = settings.projectileAdvanceChance * tactic.projectileAdvanceScale * (readProjectileInput ? 1 : 0.55);
    if (canAdvancePastProjectile && rand() < advanceChance) {
      if (beginAiJump(ai, dx >= 0 ? 1 : -1, null, true)) {
        setAiMovementIntent(ai, "pressure", settings.movementCommit + 8);
        moveToward(ai, readOpp, Math.min(1, tactic.aggression + 0.12));
        ai.aiProjectileMisses = 0;
        return;
      }
    }

    if (reacts && incoming.type === "poisonorb") {
      if (ai.grounded && !ai.jumpDisabled && rand() < settings.jumpChance) {
        beginAiJump(ai, dx >= 0 ? -1 : 1);
      }
      setAiMovementIntent(ai, "retreat", settings.movementCommit);
      moveAway(ai, readOpp, 1);
      ai.aiProjectileMisses = 0;
      return;
    }

    if (reacts && startAiBlock(ai, incoming.attackHeight || "mid")) {
      ai.aiProjectileMisses = 0;
      return;
    }

    ai.aiProjectileMisses = Math.min(4, (ai.aiProjectileMisses || 0) + 1);
  }

  if (tryAiEscapeStuck(ai, readOpp, sameLane, incoming)) return;

  if (chaseOpponentLevel(ai, readOpp)) return;

  faceTarget(ai, readOpp);

  const newAttackRead =
    readOpp.attacking &&
    ai.aiAttackReactionTimer <= 0 &&
    ai.aiDefenseRollRevision !== ai.aiObservationRevision;
  if (
    newAttackRead &&
    sameLane &&
    abs < 145 &&
    (ai.aiActionCooldowns?.block || 0) <= 0
  ) {
    ai.aiDefenseRollRevision = ai.aiObservationRevision;
    const pressureBonus = Math.min(0.16, (ai.aiBlockHoldTimer || 0) / 400);
    if (rand() < defenseChance(settings.blockChance + pressureBonus)) {
      const observedHeight = readOpp.attackHeight || ((ai.aiRead?.low || 0) > 7 ? "low" : "mid");

      if (
        ai.type === "pink" &&
        ai.canSpecial2 &&
        !ai.specialDisabled &&
        (ai.aiActionCooldowns?.special || 0) <= 0 &&
        rand() < settings.specialChance
      ) {
        ai.ducking = ["low", "mid", "unblockable"].includes(observedHeight);
        if (beginPinkParry(ai)) {
          rememberAiAction(ai, "pinkParry");
          ai.aiActionCooldowns.special = settings.specialCooldown;
          return;
        }
      }

      if (startAiBlock(ai, observedHeight === "low" ? "low" : "mid")) return;
    }
  }

  ai.aiDefenseTimer = Math.max(0, (ai.aiDefenseTimer || 0) - 2);

  ai.aiTimer++;
  if (ai.aiTimer < settings.reactionTime) {
    if (ai.aiVerticalHold) {
      ai.vx = 0;
      return;
    }
    if (!followAiMovementIntent(ai, readOpp, tactic)) {
      if (abs > tactic.spacing + 42) moveToward(ai, readOpp, 0.72);
      else if (abs < retreatRange) moveAway(ai, readOpp, 0.62);
      else ai.vx *= 0.72;
    }
    return;
  }


  ai.aiTimer = -Math.round(rand() * settings.observationJitter * 0.45);

  const read = ai.aiRead || {};
  const canStartCloseOffense =
    sameLane &&
    abs <= tactic.meleeRange + 8;
  const expectsPressure =
    (ai.aiBlockHoldTimer || 0) > 0 ||
    (read.rush || 0) > 4 ||
    (read.low || 0) > 6 ||
    (tactic.badlyBehind && abs < 118);
  if (
    expectsPressure &&
    sameLane &&
    abs < 125 &&
    (ai.aiActionCooldowns?.block || 0) <= 0 &&
    rand() < defenseChance(settings.blockChance * 0.34)
  ) {
    const predictsLow = (read.low || 0) > 7 && rand() < settings.accuracy;
    if (startAiBlock(ai, predictsLow ? "low" : "mid")) return;
  }

  if (
    !ai.aiVerticalHold &&
    !canStartCloseOffense &&
    (ai.aiActionTimer || 0) > 0 &&
    ["approach", "pressure", "retreat", "hold"].includes(ai.aiAction) &&
    followAiMovementIntent(ai, readOpp, tactic)
  ) {
    return;
  }

  if (ai.aiVerticalHold) {
    if (tryAiAbility(ai, readOpp, sameLane, incoming, { chance: tactic.specialChance })) return;
    ai.vx = 0;
    return;
  }

  if (rand() < settings.mistakeChance * tactic.mistakeScale) {
    const mistake = rand();
    if (mistake < 0.34) setAiMovementIntent(ai, "hold");
    else if (mistake < 0.67 && abs > 78) setAiMovementIntent(ai, "retreat");
    else setAiMovementIntent(ai, "approach", Math.round(settings.movementCommit * 0.7));
    followAiMovementIntent(ai, readOpp, tactic);
    return;
  }

  const targetPunishable =
    readOpp.frozen ||
    readOpp.hitstun ||
    readOpp.spearStunned ||
    readOpp.blockDisabled ||
    readOpp.jumpDisabled;

  const continuingCombo = (ai.aiComboTimer || 0) > 0 && (ai.aiComboHits || 0) < 3;
  if ((targetPunishable || continuingCombo) && rand() < Math.min(0.98, settings.punishChance + tactic.punishBoost)) {
    if (sameLane && abs <= tactic.meleeRange && chooseCloseAttack(ai, readOpp)) return;
    setAiMovementIntent(ai, "pressure", settings.movementCommit + 8);
    moveToward(ai, readOpp, Math.min(1, tactic.aggression + 0.12));
    return;
  }

  if (
    sameLane &&
    !readOpp.grounded &&
    abs < 112 &&
    rand() < settings.antiAirChance
  ) {
    if (beginMelee(ai, "uppercut") || chooseCloseAttack(ai, readOpp)) return;
  }

  if (tryAiAbility(ai, readOpp, sameLane, incoming, { chance: tactic.specialChance })) return;

  if (
    sameLane &&
    abs <= tactic.meleeRange &&
    rand() < offenseChance(settings.attackChance)
  ) {
    if (chooseCloseAttack(ai, readOpp)) return;
  }

  const habitResponseThreshold = 13 - settings.counterplay * 5;
  const antiCheesePressure =
    targetStill ||
    (read.turtle || 0) > habitResponseThreshold ||
    (read.retreat || 0) > habitResponseThreshold - 1 ||
    (read.camping || 0) > habitResponseThreshold - 1;
  const projectileHabit = underProjectilePressure;

  if (
    ai.grounded &&
    !ai.ducking &&
    !ai.jumpDisabled &&
    sameLane &&
    abs > 110 &&
    abs < 270 &&
    rand() < Math.min(0.82, (settings.jumpChance + (projectileHabit ? settings.adaptRate * 0.16 : 0)) * tactic.projectileAdvanceScale)
  ) {
    if (beginAiJump(ai, dx >= 0 ? 1 : -1)) {
      moveToward(ai, readOpp, 0.82);
      return;
    }
  }

  if (antiCheesePressure || (projectileHabit && !incoming)) {
    setAiMovementIntent(ai, "pressure", settings.movementCommit + 8);
    moveToward(ai, readOpp, Math.min(1, tactic.aggression + 0.12));
    return;
  }

  if (
    sameLane &&
    abs > tactic.meleeRange + 6 &&
    abs <= tactic.spacing + 18 &&
    rand() < offenseChance(tactic.pressureChance)
  ) {
    setAiMovementIntent(ai, "pressure", settings.movementCommit + 6);
    moveToward(ai, readOpp, tactic.aggression);
    return;
  }

  if (abs > tactic.spacing + 12) {
    setAiMovementIntent(ai, "approach");
    moveToward(ai, readOpp, tactic.aggression);
  } else if (abs < retreatRange || ((read.rush || 0) > 9 && !aiCornered)) {
    setAiMovementIntent(ai, "retreat");
    moveAway(ai, readOpp, 0.8);
  } else {
    setAiMovementIntent(ai, "hold", Math.round(settings.movementCommit * 0.65));
    ai.vx *= 0.65;
  }
};

    const drawHealthBarSmall = (label, health, x, y, color, roundsWon, alignRight = false, maxHealth = 100) => {
      const barW = 220;
      const barH = 10;
      const boxH = 38;

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(x, y, barW, boxH);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, barW, boxH);

      const hpText = `${label}  ${Math.max(0, Math.floor(health))} HP`;
      ctx.fillStyle = "#111827";
      let labelFontSize = 10;
      ctx.font = `${labelFontSize}px Arial`;
      let tw = ctx.measureText(hpText).width;
      while (tw > barW - 16 && labelFontSize > 7) {
        labelFontSize--;
        ctx.font = `${labelFontSize}px Arial`;
        tw = ctx.measureText(hpText).width;
      }
      ctx.fillText(hpText, alignRight ? x + barW - 8 - tw : x + 8, y + 11);

      ctx.fillStyle = "#e5e7eb";
ctx.fillRect(x + 8, y + 16, barW - 16, barH);
ctx.strokeStyle = "#000000";
ctx.lineWidth = 2;
ctx.strokeRect(x + 8, y + 16, barW - 16, barH);

const hpW = ((Math.max(0, Math.min(maxHealth, health)) / maxHealth) * (barW - 16)) | 0;
if (color === "rainbow" || color === "monochrome") {
  const barGradient = ctx.createLinearGradient(x + 8, y + 16, x + barW - 8, y + 16);
  const colors = color === "rainbow" ? RAINBOW_COLORS : MONOCHROME_COLORS;
  colors.forEach((barColor, index) => {
    barGradient.addColorStop(index / (colors.length - 1), barColor);
  });
  ctx.fillStyle = barGradient;
} else {
  ctx.fillStyle = color;
}
ctx.fillRect(x + 8, y + 16, hpW, barH);

if (hpW > 0) {
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 8, y + 16, hpW, barH);
}

      if (roundsWon != null) {
        for (let i = 0; i < 2; i++) {
  const coinX = x + barW - 14 - i * 14;
  const coinY = y + 30;

  ctx.fillStyle = i < roundsWon ? "#fbbf24" : "#e5e7eb";
  ctx.beginPath();
  ctx.arc(coinX, coinY, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.stroke();
}
      }
    };

    const drawRoundTimer = (secondsLeft) => {
      const boxW = 82;
      const boxH = 28;
      const x = WORLD_W / 2 - boxW / 2;
      const y = 18;

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(x, y, boxW, boxH);

      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, boxW, boxH);

      ctx.fillStyle = "#111827";
      ctx.font = "bold 16px Arial";
      const t = String(secondsLeft).padStart(2, "0");
      const textW = ctx.measureText(t).width;
      ctx.fillText(t, x + boxW / 2 - textW / 2, y + 20);
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

    const aliveOnTeam = (team) => fighters.filter((f) => f.alive && f.team === team && !f.isSummon);
    const teamTotalHP = (team) => aliveOnTeam(team).reduce((sum, f) => sum + Math.max(0, f.health), 0);
    const teamDisplayName = (team) => {
      if (mode === "online") {
        return team === 1 ? onlinePlayerNames.p1 || "Player 1" : onlinePlayerNames.p2 || "Player 2";
      }
      if (is2v2) return team === 1 ? "Team 1" : "Team 2";
      const fighter = fighters.find((f) => f.team === team);
      if (team === 1) return "You";
      return fighter?.isHuman ? "P2" : gameConfig.practiceDummy ? "Dummy" : "AI";
    };

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
        p.health = p.maxHealth || 100;

        p.frozen = false;
        p.frozenTimer = 0;

        p.poisoned = false;
        p.poisonTicksLeft = 0;
        p.poisonTickTimer = 0;
        p.poisonOwnerId = null;

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
        p.poisonSlowTimer = 0;

        p.blockDisabled = false;
        p.blockDisabledTimer = 0;

        p.jumpDisabled = false;
        p.jumpDisabledTimer = 0;

        p.canProjectile = true;
        p.canSpecial2 = true;
        p.canSpecial3 = true;
        p.special2WasHeld = false;
        p.special3WasHeld = false;
        p.blackCharging = false;
        p.blackChargeTimer = 0;
        p.snowflakeExpiries = [];
        p.damageReducedTimer = 0;
        p.special3VisualTimer = 0;
        p.special3RollTimer = 0;
        p.special3HasHit = false;
        p.yellowWaveChargeTimer = 0;
        p.yellowWaveTargetX = 0;
        p.shotgunVisualTimer = 0;
        p.shotgunVisualDownward = false;
        p.harpoonTargetId = null;
        p.harpoonPullTimer = 0;
        p.grayPeakId = null;
        if (p.brownOriginalForm) Object.assign(p, p.brownOriginalForm);
        p.brownOriginalForm = null;
        p.brownMorphHealth = 0;
        p.pinkTeleportMarker = null;
        p.pinkTeleportArmTimer = 0;
        p.pinkTeleportExplosionTimer = 0;
        p.thrownById = null;
        p.thrownLandingPending = false;
        p.thrownDirection = 0;

        p.healing = false;
        p.healTickTimer = 0;

        p.charging = false;
        p.chargeFrames = 0;
        p.purpleCharging = false;
        p.purpleChargeTimer = 0;
        p.orangeCharging = false;
        p.orangeChargeTimer = 0;
        p.rainbowTurretTimer = 0;
        p.rainbowTurretShotTimer = 0;
        p.rainbowSummonId = null;
        p.speedBoostTimer = 0;
        p.airJumpsUsed = 0;
        p.jumpWasHeld = false;
        p.cooldownBoostTimer = 0;
        p.damageAmpTimer = 0;
        p.spearLocked = false;
        p.spearStunned = false;
        p.spearStunTimer = 0;
        p.monochromeStunned = false;
        p.monochromeStunTimer = 0;
        p.transparentStunned = false;
        p.transparentStunTimer = 0;
        p.transparentBurrowing = false;
        p.transparentBurrowTimer = 0;
        p.transparentStrikeTimer = 0;
        p.transparentPoundChargeTimer = 0;
        p.transparentPoundActiveTimer = 0;
        p.transparentPoundHitIds = {};
        p.grayHammerTimer = 0;
        p.grayHammerRotation = 0;
        p.grayHammerHitIds = {};
        p.pinkParrying = false;
        p.pinkParryTimer = 0;
        p.pinkParryDucking = false;
        p.brownPhasing = false;
        p.brownStunned = false;
        p.brownStunTimer = 0;
        p.brownCharging = false;
        p.brownChargeTimer = 0;
        p.brownInvulnTimer = 0;
        p.reflecting = false;
        p.reflectTimer = 0;
        p.inputIntentAction = "";
        p.inputIntentAt = 0;
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
        p.health = p.maxHealth || 100;

        p.frozen = false;
        p.frozenTimer = 0;

        p.poisoned = false;
        p.poisonTicksLeft = 0;
        p.poisonTickTimer = 0;
        p.poisonOwnerId = null;

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
        p.poisonSlowTimer = 0;

        p.blockDisabled = false;
        p.blockDisabledTimer = 0;

        p.jumpDisabled = false;
        p.jumpDisabledTimer = 0;

        p.canProjectile = true;
        p.canSpecial2 = true;
        p.canSpecial3 = true;
        p.special2WasHeld = false;
        p.special3WasHeld = false;
        p.blackCharging = false;
        p.blackChargeTimer = 0;
        p.snowflakeExpiries = [];
        p.damageReducedTimer = 0;
        p.special3VisualTimer = 0;
        p.special3RollTimer = 0;
        p.special3HasHit = false;
        p.yellowWaveChargeTimer = 0;
        p.yellowWaveTargetX = 0;
        p.shotgunVisualTimer = 0;
        p.shotgunVisualDownward = false;
        p.harpoonTargetId = null;
        p.harpoonPullTimer = 0;
        p.grayPeakId = null;
        if (p.brownOriginalForm) Object.assign(p, p.brownOriginalForm);
        p.brownOriginalForm = null;
        p.brownMorphHealth = 0;
        p.pinkTeleportMarker = null;
        p.pinkTeleportArmTimer = 0;
        p.pinkTeleportExplosionTimer = 0;
        p.thrownById = null;
        p.thrownLandingPending = false;
        p.thrownDirection = 0;

        p.healing = false;
        p.healTickTimer = 0;

        p.charging = false;
        p.chargeFrames = 0;
        p.purpleCharging = false;
        p.purpleChargeTimer = 0;
        p.orangeCharging = false;
        p.orangeChargeTimer = 0;
        p.rainbowTurretTimer = 0;
        p.rainbowTurretShotTimer = 0;
        p.rainbowSummonId = null;
        p.speedBoostTimer = 0;
        p.cooldownBoostTimer = 0;
        p.damageAmpTimer = 0;
        p.spearLocked = false;
        p.spearStunned = false;
        p.spearStunTimer = 0;
        p.monochromeStunned = false;
        p.monochromeStunTimer = 0;
        p.transparentStunned = false;
        p.transparentStunTimer = 0;
        p.transparentBurrowing = false;
        p.transparentBurrowTimer = 0;
        p.transparentStrikeTimer = 0;
        p.transparentPoundChargeTimer = 0;
        p.transparentPoundActiveTimer = 0;
        p.transparentPoundHitIds = {};
        p.grayHammerTimer = 0;
        p.grayHammerRotation = 0;
        p.grayHammerHitIds = {};
        p.pinkParrying = false;
        p.pinkParryTimer = 0;
        p.pinkParryDucking = false;
        p.brownPhasing = false;
        p.brownStunned = false;
        p.brownStunTimer = 0;
        p.brownCharging = false;
        p.brownChargeTimer = 0;
        p.brownInvulnTimer = 0;
        p.reflecting = false;
        p.reflectTimer = 0;
        p.inputIntentAction = "";
        p.inputIntentAt = 0;
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
      if (p.frozen || p.hitstun || p.spearStunned || p.brownStunned) return;

      const binds = p.bindsRef?.current;
      const isOnline = (mode === "online" || mode === "online2v2") && onlineLocalTeam != null;
      const isOnlineRemote = isOnline && (p.remoteSlot || (mode === "online" && p.team !== onlineLocalTeam));
      const actionBinds = isOnline
        ? isOnlineRemote
          ? (p.bindsRef?.current || onlineOpponentBindsRef.current)
          : (p1BindsRef.current || binds || {})
        : (binds || {});
      if (!actionBinds) return;
      const canUseP1Controller = isOnline
        ? !isOnlineRemote
        : p.id === "p1" || p.label === "P1";
      const getHeld = (action) => {
        if (isOnlineRemote) {
          if (p.remoteSlot) return !!onlineRemoteInputsRef.current[p.remoteSlot]?.[action];
          return !!onlineRemoteInputsRef.current[action];
        }
        const keyboardHeld = !!(actionBinds[action] && keysPressed.current[actionBinds[action]]);
        if (!canUseP1Controller) return keyboardHeld;
        const controllerInput = p1ControllerBindsRef.current?.[action];
        return keyboardHeld || !!(controllerInput && keysPressed.current[controllerInput]);
      };
      const clearHeld = (action) => {
        if (isOnlineRemote) {
          if (p.remoteSlot) {
            onlineRemoteInputsRef.current[p.remoteSlot] = {
              ...(onlineRemoteInputsRef.current[p.remoteSlot] || {}),
              [action]: false,
            };
          } else {
            onlineRemoteInputsRef.current[action] = false;
          }
        } else if (actionBinds[action]) {
          keysPressed.current[actionBinds[action]] = false;
          const controllerInput = p1ControllerBindsRef.current?.[action];
          if (canUseP1Controller && controllerInput) keysPressed.current[controllerInput] = false;
        }
      };
      const jumpHeld = getHeld("jump");
      const jumpPressed = jumpHeld && !p.jumpWasHeld;
      const special2Held = getHeld("special2");
      const special2Pressed = special2Held && !p.special2WasHeld;
      const special3Held = getHeld("special3");
      const special3Pressed = special3Held && !p.special3WasHeld;
      const finishControls = () => {
        p.jumpWasHeld = jumpHeld;
        p.special2WasHeld = special2Held;
        p.special3WasHeld = special3Held;
      };
      const tryJump = () => {
        if (!jumpHeld || p.jumpDisabled) return;
        if (p.grounded) {
          p.vy = p.jumpPower;
          p.grounded = false;
          p.airJumpsUsed = 0;
          return;
        }
        if (jumpPressed && p.type === "psychic" && p.speedBoostTimer > 0 && p.airJumpsUsed < 1) {
          p.vy = p.jumpPower;
          p.airJumpsUsed++;
        }
      };

      if (p.type === "electric" && p.reflecting) {
        if (getHeld("special2") && !p.specialDisabled) {
          p.reflectTimer = 2;
        } else {
          p.reflecting = false;
          p.reflectTimer = 0;
        }
      }

      if (p.special3RollTimer > 0) {
        p.vx = p.facing * 10;
        p.ducking = true;
        p.blocking = false;
        finishControls();
        return;
      }

      if (p.spearLocked || p.reflecting || p.purpleCharging || p.orangeCharging || p.blackCharging || p.pinkParrying || p.brownPhasing || p.brownCharging) {
        p.vx = 0;
        p.blocking = false;
        if (!p.pinkParrying) p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        finishControls();
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
        finishControls();
        return;
      }

      if (p.type === "void" && p.charging) {
        p.vx = 0;
        p.ducking = getHeld("duck");

        if (!p.ducking) {
          if (getHeld("moveLeft")) {
            p.vx = -p.speed;
            p.facing = -1;
          }
          if (getHeld("moveRight")) {
            p.vx = p.speed;
            p.facing = 1;
          }

          tryJump();
        }

        p.blocking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        p.dashTimer = 0;
      } else {
        p.blocking = p.grayHammerTimer <= 0 && !p.blockDisabled && getHeld("block");

        if (p.blocking) {
          p.vx = 0;
          p.ducking = getHeld("duck");
          p.attacking = false;
          p.attackTimer = 0;
          p.attackType = "";
          p.attackHeight = "";
          finishControls();
          return;
        }

        p.vx = 0;
        p.ducking = getHeld("duck");

        if (!p.ducking) {
          if (getHeld("moveLeft")) {
            p.vx = -p.speed;
            p.facing = -1;
          }
          if (getHeld("moveRight")) {
            p.vx = p.speed;
            p.facing = 1;
          }

          tryJump();
        }

        if (p.grayHammerTimer > 0) {
          p.blocking = false;
          p.attacking = false;
          p.attackTimer = 0;
          p.attackType = "";
          p.attackHeight = "";
          clearHeld("punch");
          clearHeld("kick");
          clearHeld("special1");
          clearHeld("special2");
          finishControls();
          return;
        }

        if (getHeld("punch") && !p.attacking) {
          if (p.ducking && p.upperCooldown === 0) {
            p.attacking = true;
            p.attackType = "uppercut";
            p.attackHeight = "high";
            p.attackTimer = 15;
            p.upperCooldown = meleeCooldown(p, 60);
            playSfx("uppercut");
            clearHeld("punch");
          } else if (!p.ducking && p.punchCooldown === 0) {
            p.attacking = true;
            p.attackType = "punch";
            p.attackHeight = "mid";
            p.attackTimer = 15;
            p.punchCooldown = meleeCooldown(p, 20);
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
            p.sweepCooldown = meleeCooldown(p, 50);
            playSfx("sweep");
            clearHeld("kick");
          } else if (!p.ducking && p.kickCooldown === 0) {
            p.attacking = true;
            p.attackType = "kick";
            p.attackHeight = "overhead";
            p.attackTimer = 15;
            p.kickCooldown = meleeCooldown(p, 40);
            playSfx("kick");
            clearHeld("kick");
          }
        }

        if (p.dashTimer > 0) {
          p.ducking = false;
          p.vx = p.facing * 12;
          p.dashTimer--;
        }

        if (getHeld("special1") && p.transparentBurrowing) {
          surfaceTransparent(p);
          clearHeld("special1");
          finishControls();
          return;
        }

        if (getHeld("special1") && p.canProjectile && !p.specialDisabled) {
          p.inputIntentRevision = (p.inputIntentRevision || 0) + 1;
          p.inputIntentAction = "special1";
          p.inputIntentAt = Date.now();
          const projX = p.x + (p.facing > 0 ? p.width : 0);
          const projY = p.y + 25;
          let cooldown = 2500;

          if (p.type === "fire") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 8, owner: p, team: p.team, type: "fireball", attackHeight: "high", color: p.color, radius: 8 });
            playSfx("fireball");
            cooldown = 500;
          } else if (p.type === "rainbow") {
            beginRainbowTurret(p);
            clearHeld("special1");
            return;
          } else if (p.type === "monochrome") {
            if (beginMonochromeMissile(p)) clearHeld("special1");
            return;
          } else if (p.type === "transparent") {
            if (beginTransparentBurrow(p)) clearHeld("special1");
            return;
          } else if (p.type === "gray") {
            if (beginGrayWind(p)) clearHeld("special1");
            return;
          } else if (p.type === "pink") {
            if (beginPinkPlus(p)) clearHeld("special1");
            return;
          } else if (p.type === "brown") {
            if (beginBrownShift(p)) clearHeld("special1");
            return;
          } else if (p.type === "psychic") {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 12, owner: p, team: p.team, type: "purpleball", attackHeight: "high", color: "#a855f7", radius: 8 });
            playSfx("purple_damage");
            cooldown = 1000;
          } else if (p.type === "electric") {
            p.spearLocked = true;
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 20, owner: p, team: p.team, type: "yellowspear", attackHeight: "mid", color: "#facc15", radius: 7 });
            playSfx("yellow_spear");
            cooldown = 5000;
          } else if (p.type === "explosion") {
            fireShotgun(p, false);
            cooldown = 2000;
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
            cooldown = 1000;
          } else {
            projectiles.current.push({ x: projX, y: projY, vx: p.facing * 10, owner: p, team: p.team, type: "blackball", attackHeight: "mid", color: p.color, radius: 8 });
            playSfx("voidball");
            cooldown = 2500;
          }

          p.canProjectile = false;
          setManagedTimeout(() => (p.canProjectile = true), abilityCooldown(p, cooldown));
          clearHeld("special1");
        }

        if (special2Pressed) {
          p.inputIntentRevision = (p.inputIntentRevision || 0) + 1;
          p.inputIntentAction = "special2";
          p.inputIntentAt = Date.now();
        }

        if (special2Held && !p.specialDisabled && (p.type !== "explosion" || special2Pressed)) {
          if (p.type === "explosion") {
            if (beginOrangeDownShotgun(p)) clearHeld("special2");
          } else if (p.canSpecial2) {
            if (p.type === "fire") {
              p.ducking = false;
              p.attacking = true;
              p.attackType = "dash";
              p.attackHeight = "mid";
              p.attackTimer = 25;
              p.dashTimer = 25;
              p.dashHasHit = false;
              playSfx("dash");
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), abilityCooldown(p, 2000));
              clearHeld("special2");
            } else if (p.type === "ice") {
              projectiles.current.push({ x: p.x + (p.facing > 0 ? p.width : 0), y: p.y + 25, vx: p.facing * 2.2, owner: p, team: p.team, type: "sloworb", attackHeight: "mid", color: "#93c5fd", radius: 12 });
              playSfx("sloworb");
              p.canSpecial2 = false;
              setManagedTimeout(() => (p.canSpecial2 = true), abilityCooldown(p, 4000));
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
              setManagedTimeout(() => (p.canSpecial2 = true), abilityCooldown(p, 10000));
              clearHeld("special2");
            } else if (p.type === "electric") {
              p.vx = 0;
              p.blocking = false;
              p.ducking = false;
              p.reflecting = true;
              p.reflectTimer = 2;
              playSfx("reflect");
            } else if (p.type === "rainbow") {
              if (beginRainbowSummon(p)) clearHeld("special2");
            } else if (p.type === "monochrome") {
              if (beginMonochromeWave(p)) clearHeld("special2");
            } else if (p.type === "transparent") {
              if (beginTransparentPound(p)) clearHeld("special2");
            } else if (p.type === "gray") {
              if (beginGrayHammer(p)) clearHeld("special2");
            } else if (p.type === "pink") {
              if (beginPinkParry(p)) clearHeld("special2");
            } else if (p.type === "brown") {
              if (beginBrownArmorCharge(p)) clearHeld("special2");
            } else if (p.type === "light") {
              const target = getNearestEnemy(p);
              if (target) {
                const dropX = target.x + target.width / 2;
                const knockbackDir = dropX >= p.x + p.width / 2 ? 1 : -1;
                projectiles.current.push({ x: dropX, y: -40, vx: 0, vy: 13, owner: p, team: p.team, type: "whitedrop", attackHeight: "overhead", color: "#f8fafc", radius: 12, knockbackDir });
                playSfx("white_drop");
                p.canSpecial2 = false;
                setManagedTimeout(() => (p.canSpecial2 = true), abilityCooldown(p, 3000));
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

        if (special3Pressed) {
          p.inputIntentRevision = (p.inputIntentRevision || 0) + 1;
          p.inputIntentAction = "special3";
          p.inputIntentAt = Date.now();
          if (beginSpecial3(p)) clearHeld("special3");
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
          setManagedTimeout(() => (p.canSpecial2 = true), abilityCooldown(p, 3000));
        }

        finishControls();
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
        setManagedTimeout(() => (p.canSpecial2 = true), abilityCooldown(p, 3000));
      }
      finishControls();
    };

    const updatePerFrame = (p) => {
      if (!p.alive) return;
      
      if (p.punchCooldown > 0) p.punchCooldown--;
      if (p.kickCooldown > 0) p.kickCooldown--;
      if (p.upperCooldown > 0) p.upperCooldown--;
      if (p.sweepCooldown > 0) p.sweepCooldown--;

      if (p.charging) p.chargeFrames += 1.2;

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

      if (p.orangeCharging) {
        p.orangeChargeTimer++;
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.orangeChargeTimer >= 60) {
          p.orangeCharging = false;
          p.orangeChargeTimer = 0;
          p.cooldownBoostTimer = 600;
          playSfx("orange_orb");
        }
      }

      if (p.blackCharging) {
        p.blackChargeTimer++;
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.blackChargeTimer >= 60) {
          p.blackCharging = false;
          p.blackChargeTimer = 0;
          p.cooldownBoostTimer = 600;
          playSfx("orange_orb");
        }
      }

      if (p.brownCharging) {
        p.brownChargeTimer++;
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.brownChargeTimer >= 60) {
          p.brownCharging = false;
          p.brownChargeTimer = 0;
          p.brownInvulnTimer = 300;
          playSfx("purple_boost");
        }
      }

      if (p.pinkParrying) {
        p.pinkParryTimer--;
        p.vx = 0;
        p.blocking = false;
        p.ducking = !!p.pinkParryDucking;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.pinkParryTimer <= 0) {
          p.pinkParrying = false;
          p.pinkParryTimer = 0;
        }
      }

      if (p.brownPhasing) {
        p.vx = 0;
        p.vy = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        updateHitboxes(p);
        return;
      }

      if (p.transparentBurrowing) {
        p.transparentBurrowTimer--;
        p.vy = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        p.y = groundLevel - p.height;
        p.x += p.vx;
        if (p.x < 0) {
          p.x = 0;
          p.vx = Math.abs(p.vx || 7);
          p.facing = 1;
        }
        if (p.x + p.width > WORLD_W) {
          p.x = WORLD_W - p.width;
          p.vx = -Math.abs(p.vx || 7);
          p.facing = -1;
        }
        if (p.transparentBurrowTimer <= 0) surfaceTransparent(p);
        updateHitboxes(p);
        return;
      }

      if (p.brownInvulnTimer > 0) p.brownInvulnTimer--;
      if (p.transparentStrikeTimer > 0) p.transparentStrikeTimer--;

      if (p.rainbowTurretTimer > 0) {
        p.rainbowTurretTimer--;
        p.rainbowTurretShotTimer--;
        if (p.rainbowTurretShotTimer <= 0) {
          fireRainbowShot(p);
          p.rainbowTurretShotTimer = 12;
        }
        if (p.rainbowTurretTimer <= 0) {
          p.rainbowTurretTimer = 0;
          p.rainbowTurretShotTimer = 0;
        }
      }

      if (p.cooldownBoostTimer > 0) p.cooldownBoostTimer--;
      if (p.damageReducedTimer > 0) p.damageReducedTimer--;
      if (p.special3VisualTimer > 0) p.special3VisualTimer--;
      if (p.shotgunVisualTimer > 0) p.shotgunVisualTimer--;
      if (p.pinkTeleportArmTimer > 0) p.pinkTeleportArmTimer--;
      if (p.pinkTeleportExplosionTimer > 0) p.pinkTeleportExplosionTimer--;
      p.snowflakeExpiries = (p.snowflakeExpiries || []).filter((expiry) => expiry > Date.now());

      if (p.special3RollTimer > 0) {
        p.special3RollTimer--;
        p.vx = p.facing * 10;
        p.ducking = true;
        if (p.special3RollTimer <= 0 || p.x <= 0 || p.x + p.width >= WORLD_W) {
          p.special3RollTimer = 0;
          p.attacking = false;
          p.attackType = "";
          p.attackHeight = "";
          p.ducking = false;
          p.vx = 0;
        }
      }

      if (p.yellowWaveChargeTimer > 0) {
        p.yellowWaveChargeTimer--;
        if (p.yellowWaveChargeTimer <= 0) {
          const waveTarget = getNearestEnemy(p);
          const waveX = waveTarget ? centerX(waveTarget) : p.yellowWaveTargetX;
          projectiles.current.push({
            x: waveX,
            y: groundLevel + 22,
            vx: 0,
            vy: -13,
            owner: p,
            team: p.team,
            type: "yellowwave",
            attackHeight: "low",
            color: "rgba(250,204,21,0.9)",
            radius: 30,
            width: 60,
            height: 120,
            knockbackDir: waveX >= centerX(p) ? 1 : -1,
          });
          playSfx("yellow_spear");
        }
      }

      if (p.harpoonTargetId) {
        const tethered = fighters.find((other) => other.id === p.harpoonTargetId && other.alive);
        if (!tethered) {
          p.harpoonTargetId = null;
          p.harpoonPullTimer = 0;
        } else if (p.harpoonPullTimer > 0) {
          p.harpoonPullTimer--;
          const dx = centerX(p) - centerX(tethered);
          if (Math.abs(dx) <= p.width * 0.5) {
            tethered.vx = 0;
            p.harpoonPullTimer = 0;
            p.harpoonTargetId = null;
          } else {
            tethered.vx = Math.sign(dx) * 14;
            tethered.vy += (centerY(p) - centerY(tethered)) * 0.06;
            tethered.hitstun = true;
            tethered.hitstunTimer = Math.max(tethered.hitstunTimer || 0, 4);
            if (p.harpoonPullTimer <= 0) {
              tethered.vx = 0;
              p.harpoonTargetId = null;
            }
          }
        }
      }

      if (p.thrownLandingPending && p.grounded) {
        const thrower = fighters.find((other) => other.id === p.thrownById) || p;
        p.thrownLandingPending = false;
        p.thrownById = null;
        p.thrownDirection = 0;
        p.hitstun = false;
        applyDamage(thrower, p, "monochromethrow", { attackHeight: "unblockable", isProjectile: true, knockbackDir: 0 });
        markKOIfNeeded(p);
        playSfx("hit");
      } else if (p.thrownLandingPending) {
        p.vx = (p.thrownDirection || 1) * 18;
      }

      if (p.speedBoostTimer > 0) {
        p.speedBoostTimer--;
        p.speed = 6;
        p.jumpPower = -22;
      } else {
        p.speed = 5;
        p.jumpPower = -22;
      }

      if (p.slowedTimer > 0) {
        p.slowedTimer--;
        p.speed *= 0.75;
        p.jumpPower *= 0.75;
      }

      if (p.poisonSlowTimer > 0) {
        p.poisonSlowTimer--;
        p.speed *= 0.75;
      }

      if (p.damageAmpTimer > 0) p.damageAmpTimer--;

      if (p.grayHammerTimer > 0) {
        p.grayHammerTimer--;
        p.blocking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        const rotationIndex = Math.min(3, Math.floor((120 - p.grayHammerTimer) / 30));
        if (p.grayHammerRotation !== rotationIndex) {
          p.grayHammerRotation = rotationIndex;
          p.grayHammerHitIds = {};
        }
        const hammerRadius = 112;
        fighters
          .filter((target) => target.alive && target.team !== p.team && !p.grayHammerHitIds?.[target.id])
          .forEach((target) => {
            const dx = centerX(target) - centerX(p);
            const dy = centerY(target) - centerY(p);
            if (Math.sqrt(dx * dx + dy * dy) <= hammerRadius) {
              p.grayHammerHitIds = p.grayHammerHitIds || {};
              p.grayHammerHitIds[target.id] = true;
              applyDamage(p, target, "grayhammer", {
                attackHeight: "mid",
                knockbackDir: dx < 0 ? -1 : 1,
              });
            }
          });
        if (p.grayHammerTimer <= 0) {
          p.grayHammerTimer = 0;
          p.grayHammerRotation = 0;
          p.grayHammerHitIds = {};
        }
      }

      if (p.transparentPoundChargeTimer > 0) {
        p.transparentPoundChargeTimer--;
        p.vx = 0;
        p.blocking = false;
        p.ducking = false;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.transparentPoundChargeTimer <= 0) {
          p.transparentPoundActiveTimer = 18;
          p.transparentPoundHitIds = {};
          playSfx("white_drop");
        }
      }

      if (p.transparentPoundActiveTimer > 0) {
        p.transparentPoundActiveTimer--;
        fighters
          .filter((target) => target.alive && target.team !== p.team && target.grounded && !p.transparentPoundHitIds?.[target.id])
          .forEach((target) => {
            p.transparentPoundHitIds = p.transparentPoundHitIds || {};
            p.transparentPoundHitIds[target.id] = true;
            applyDamage(p, target, "transparentpound", {
              attackHeight: "unblockable",
              knockbackDir: 0,
            });
          });
        if (p.transparentPoundActiveTimer <= 0) {
          p.transparentPoundActiveTimer = 0;
          p.transparentPoundHitIds = {};
        }
      }

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

      if (p.brownStunned && !p.frozen) {
        p.brownStunTimer--;
        p.vx = 0;
        p.attacking = false;
        p.attackTimer = 0;
        p.attackType = "";
        p.attackHeight = "";
        if (p.brownStunTimer <= 0) {
          p.brownStunned = false;
          p.brownStunTimer = 0;
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
        if (p.healTickTimer <= 0 && p.health < (p.maxHealth || 100)) {
          p.health = Math.min(p.maxHealth || 100, p.health + 1);
          p.healTickTimer = 20;
        }
      }

      if (p.poisoned && p.poisonTicksLeft > 0) {
        p.poisonTickTimer--;
        if (p.poisonTickTimer <= 0) {
          if (!(p.type === "rainbow" && p.rainbowTurretTimer > 0) && p.brownInvulnTimer <= 0) {
            if (p.brownOriginalForm) {
              p.brownMorphHealth -= 1;
              if (p.brownMorphHealth <= 0) restoreBrownForm(p);
            } else {
              p.health -= 1;
            }
            const poisonOwner = fighters.find((other) => other.id === p.poisonOwnerId && other.alive);
            if (poisonOwner) poisonOwner.health = Math.min(poisonOwner.maxHealth || 100, poisonOwner.health + 1);
          }
          p.poisonTicksLeft--;
          p.poisonTickTimer = 60;
          if (p.poisonTicksLeft <= 0) {
            p.poisoned = false;
            p.poisonTicksLeft = 0;
            p.poisonOwnerId = null;
          }
        }
      }

      if (p.frozen) {
        p.frozenTimer--;
        if (p.monochromeStunTimer > 0) p.monochromeStunTimer--;
        if (p.transparentStunTimer > 0) p.transparentStunTimer--;
        if (p.brownStunTimer > 0) p.brownStunTimer--;
        if (p.frozenTimer <= 0) {
          p.frozen = false;
          p.frozenTimer = 0;
          p.monochromeStunned = false;
          p.monochromeStunTimer = 0;
          p.transparentStunned = false;
          p.transparentStunTimer = 0;
          p.brownStunned = false;
          p.brownStunTimer = 0;
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
        p.airJumpsUsed = 0;
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
          endRound(2, `${teamDisplayName(2)} won the round`);
          return true;
        }
        if (t2Alive === 0) {
          endRound(1, `${teamDisplayName(1)} won the round`);
          return true;
        }
        return false;
      }

      if (t1Alive === 0 && t2Alive === 0) {
        tieRedoRound();
        return true;
      }
      if (t1Alive === 0) {
        endRound(2, `${teamDisplayName(2)} won the round`);
        return true;
      }
      if (t2Alive === 0) {
        endRound(1, `${teamDisplayName(1)} won the round`);
        return true;
      }
      return false;
    };

    const endRoundByTimer = () => {
      if (mode === "practice") return false;

      const t1 = teamTotalHP(1);
      const t2 = teamTotalHP(2);

      if (t1 > t2) {
        endRound(1, `${teamDisplayName(1)} won the round by time`);
        return true;
      }
      if (t2 > t1) {
        endRound(2, `${teamDisplayName(2)} won the round by time`);
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

      if (proj.type === "greenresidue") {
        ctx.fillStyle = "rgba(22,163,74,0.62)";
        ctx.beginPath();
        ctx.ellipse(proj.x, proj.y - 3, proj.radius || 60, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#14532d";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (proj.type === "graypeak") {
        ctx.fillStyle = "#6b7280";
        ctx.strokeStyle = "#1f2937";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(proj.x, proj.y + proj.height);
        ctx.lineTo(proj.x + proj.width * 0.18, proj.y + proj.height * 0.35);
        ctx.lineTo(proj.x + proj.width * 0.42, proj.y + proj.height * 0.58);
        ctx.lineTo(proj.x + proj.width * 0.62, proj.y);
        ctx.lineTo(proj.x + proj.width, proj.y + proj.height);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (proj.type === "snowflake") {
        ctx.fillStyle = "rgba(96,165,250,0.22)";
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, proj.radius + 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 7;
        for (let angle = 0; angle < Math.PI; angle += Math.PI / 3) {
          ctx.beginPath();
          ctx.moveTo(proj.x - Math.cos(angle) * proj.radius, proj.y - Math.sin(angle) * proj.radius);
          ctx.lineTo(proj.x + Math.cos(angle) * proj.radius, proj.y + Math.sin(angle) * proj.radius);
          ctx.stroke();
        }
        ctx.strokeStyle = "#dbeafe";
        ctx.lineWidth = 4;
        for (let angle = 0; angle < Math.PI; angle += Math.PI / 3) {
          ctx.beginPath();
          ctx.moveTo(proj.x - Math.cos(angle) * proj.radius, proj.y - Math.sin(angle) * proj.radius);
          ctx.lineTo(proj.x + Math.cos(angle) * proj.radius, proj.y + Math.sin(angle) * proj.radius);
          ctx.stroke();
        }
        ctx.restore();
        return;
      }

      if (proj.type === "yellowwave") {
        const waveWidth = proj.width || 44;
        const waveHeight = proj.height || 92;
        const gradient = ctx.createLinearGradient(proj.x, proj.y - waveHeight, proj.x, proj.y);
        gradient.addColorStop(0, "rgba(254,240,138,0.12)");
        gradient.addColorStop(0.45, "rgba(250,204,21,0.76)");
        gradient.addColorStop(1, "rgba(202,138,4,0.95)");
        ctx.fillStyle = gradient;
        ctx.fillRect(proj.x - waveWidth / 2, proj.y - waveHeight, waveWidth, waveHeight);
        ctx.strokeStyle = "#a16207";
        ctx.lineWidth = 3;
        ctx.strokeRect(proj.x - waveWidth / 2, proj.y - waveHeight, waveWidth, waveHeight);
        ctx.restore();
        return;
      }

      if (proj.type === "rainbowgrenade" || proj.type === "rainbowblast") {
        const colors = RAINBOW_COLORS;
        colors.forEach((color, index) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(2, proj.radius / colors.length);
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, Math.max(2, proj.radius - index * (proj.radius / colors.length)), 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.restore();
        return;
      }

      if (proj.type === "orangeharpoon") {
        const direction = Math.sign(proj.vx || 1);
        ctx.strokeStyle = "#7c2d12";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(proj.x - direction * 18, proj.y);
        ctx.lineTo(proj.x + direction * 14, proj.y);
        ctx.stroke();
        ctx.fillStyle = "#fb923c";
        ctx.beginPath();
        ctx.moveTo(proj.x + direction * 18, proj.y);
        ctx.lineTo(proj.x + direction * 8, proj.y - 7);
        ctx.lineTo(proj.x + direction * 8, proj.y + 7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
      }

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

      if (proj.type === "rainbowball") {
        const colors = RAINBOW_COLORS;
        for (let i = colors.length - 1; i >= 0; i--) {
          ctx.fillStyle = colors[(i + Math.floor(Date.now() / 90)) % colors.length];
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, Math.max(2, proj.radius - i * 0.7), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (proj.type === "monochromeball") {
        const colors = MONOCHROME_COLORS;
        for (let i = colors.length - 1; i >= 0; i--) {
          ctx.fillStyle = colors[(i + Math.floor(Date.now() / 110)) % colors.length];
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, Math.max(2, proj.radius - i * 1.1), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "#020617";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (proj.type === "monochromewave") {
        const gradient = ctx.createLinearGradient(proj.x - proj.radius * 1.7, proj.y, proj.x + proj.radius * 1.7, proj.y);
        gradient.addColorStop(0, "rgba(2,6,23,0.95)");
        gradient.addColorStop(0.45, "rgba(156,163,175,0.78)");
        gradient.addColorStop(1, "rgba(248,250,252,0.9)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(proj.x, proj.y, proj.radius * 1.8, proj.radius * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#020617";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(proj.x, proj.y, proj.radius * 1.8, proj.radius * 0.8, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (proj.type === "pinkplus") {
        ctx.fillStyle = "#ec4899";
        ctx.strokeStyle = "#831843";
        ctx.lineWidth = 2;
        ctx.fillRect(proj.x - 3, proj.y - proj.radius, 6, proj.radius * 2);
        ctx.fillRect(proj.x - proj.radius, proj.y - 3, proj.radius * 2, 6);
        ctx.strokeRect(proj.x - 3, proj.y - proj.radius, 6, proj.radius * 2);
        ctx.strokeRect(proj.x - proj.radius, proj.y - 3, proj.radius * 2, 6);
        ctx.restore();
        return;
      }

      if (proj.type === "graywind") {
        const swirl = Math.floor(Date.now() / 70) % 3;
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(proj.x, proj.y, proj.radius + i * 5, Math.max(4, proj.radius - i * 2), (swirl + i) * 0.8, 0, Math.PI * 1.7);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(156,163,175,0.45)";
        ctx.beginPath();
        ctx.ellipse(proj.x, proj.y, proj.radius * 1.5, proj.radius * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      if (proj.type === "brownshift") {
        ctx.fillStyle = "#92400e";
        ctx.fillRect(proj.x - 10, proj.y - 15, 20, 30);
        ctx.strokeStyle = "#1c0a00";
        ctx.lineWidth = 3;
        ctx.strokeRect(proj.x - 10, proj.y - 15, 20, 30);
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
        proj.type === "tripleball" ||
        proj.type === "purpleball" ||
        proj.type === "orangeball" ||
        proj.type === "orangeorb"
          ? "#000000"
          : "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth =
        proj.type === "whiteball" ||
        proj.type === "whitedrop" ||
        proj.type === "tripleball" ||
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
      if (p.brownPhasing) return;
      ctx.save();

      const drawHeight = p.ducking ? p.height * 0.6 : p.height;
      const drawY = p.ducking ? p.y + p.height * 0.4 : p.y;

      if (p.pinkTeleportMarker) {
        ctx.globalAlpha = 0.66;
        ctx.fillStyle = "#f9a8d4";
        ctx.fillRect(p.pinkTeleportMarker.x, p.pinkTeleportMarker.y, p.width, p.height);
        ctx.strokeStyle = "#ec4899";
        ctx.lineWidth = 5;
        ctx.strokeRect(p.pinkTeleportMarker.x, p.pinkTeleportMarker.y, p.width, p.height);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.pinkTeleportMarker.x + 5, p.pinkTeleportMarker.y + 5, p.width - 10, p.height - 10);
        ctx.globalAlpha = 1;
      }

      if (p.harpoonTargetId) {
        const tethered = fighters.find((other) => other.id === p.harpoonTargetId && other.alive);
        if (tethered) {
          ctx.strokeStyle = "#f97316";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(centerX(p), centerY(p));
          ctx.lineTo(centerX(tethered), centerY(tethered));
          ctx.stroke();
        }
      }

      if (p.special3VisualTimer > 0) {
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(centerX(p), p.y + 4, 78, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
      }

      if (p.yellowWaveChargeTimer > 0) {
        ctx.globalAlpha = 0.35 + Math.sin(Date.now() / 45) * 0.12;
        ctx.fillStyle = "#fde047";
        ctx.fillRect(p.x - 7, drawY - 7, p.width + 14, drawHeight + 14);
        ctx.globalAlpha = 1;
      }

      if (p.pinkTeleportExplosionTimer > 0) {
        ctx.globalAlpha = p.pinkTeleportExplosionTimer / 18;
        ctx.fillStyle = "rgba(236,72,153,0.5)";
        ctx.beginPath();
        ctx.arc(centerX(p), centerY(p), 72, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (p.transparentBurrowing) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "rgba(15,23,42,0.7)";
        ctx.beginPath();
        ctx.ellipse(p.x + p.width / 2, groundLevel - 6, p.width * 0.8, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        return;
      }

      if (p.transparentStrikeTimer > 0) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = "rgba(229,231,235,0.75)";
        ctx.fillRect(p.x - 8, 0, p.width + 16, groundLevel);
        ctx.globalAlpha = 1;
      }

      if (p.blackCharging) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = "#020617";
        ctx.lineWidth = 6;
        const chargeSize = Math.min(p.blackChargeTimer / 3, 20);
        ctx.strokeRect(p.x - chargeSize / 2, drawY - chargeSize / 2, p.width + chargeSize, drawHeight + chargeSize);
        ctx.globalAlpha = 1;
      }

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

      if (p.type === "rainbow") {
        const pulse = Math.floor(Date.now() / 120);
        for (let i = 0; i < RAINBOW_COLORS.length; i++) {
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = RAINBOW_COLORS[(pulse + i) % RAINBOW_COLORS.length];
          const grow = 8 + i * 2;
          ctx.fillRect(p.x - grow / 2, drawY - grow / 2, p.width + grow, drawHeight + grow);
        }
        ctx.globalAlpha = 1;
      }

      if (p.type === "monochrome") {
        const pulse = Math.floor(Date.now() / 150);
        for (let i = 0; i < MONOCHROME_COLORS.length; i++) {
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = MONOCHROME_COLORS[(pulse + i) % MONOCHROME_COLORS.length];
          const grow = 8 + i * 3;
          ctx.fillRect(p.x - grow / 2, drawY - grow / 2, p.width + grow, drawHeight + grow);
        }
        ctx.globalAlpha = 1;
      }

      if (p.rainbowTurretTimer > 0) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = RAINBOW_COLORS[Math.floor(Date.now() / 90) % RAINBOW_COLORS.length];
        ctx.lineWidth = 5;
        ctx.strokeRect(p.x - 10, drawY - 10, p.width + 20, drawHeight + 20);
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

      if (p.monochromeStunned) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = MONOCHROME_COLORS[Math.floor(Date.now() / 120) % MONOCHROME_COLORS.length];
        ctx.lineWidth = 5;
        ctx.strokeRect(p.x - 8, drawY - 8, p.width + 16, drawHeight + 16);
        ctx.globalAlpha = 1;
      }

      if (p.transparentStunned) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = TRANSPARENT_COLORS[Math.floor(Date.now() / 100) % TRANSPARENT_COLORS.length];
        ctx.lineWidth = 5;
        ctx.setLineDash([6, 5]);
        ctx.strokeRect(p.x - 8, drawY - 8, p.width + 16, drawHeight + 16);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      if (p.brownStunned) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = "#92400e";
        ctx.lineWidth = 5;
        ctx.strokeRect(p.x - 8, drawY - 8, p.width + 16, drawHeight + 16);
        ctx.globalAlpha = 1;
      }

      if (p.purpleCharging) {
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = "#a855f7";
        const chargeSize = Math.min(p.purpleChargeTimer / 3, 20);
        ctx.fillRect(p.x - chargeSize / 2, drawY - chargeSize / 2, p.width + chargeSize, drawHeight + chargeSize);
        ctx.globalAlpha = 1;
      }

      if (p.orangeCharging) {
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = "#fb923c";
        const chargeSize = Math.min(p.orangeChargeTimer / 3, 20);
        ctx.fillRect(p.x - chargeSize / 2, drawY - chargeSize / 2, p.width + chargeSize, drawHeight + chargeSize);
        ctx.globalAlpha = 1;
      }

      if (p.brownCharging) {
        ctx.globalAlpha = 0.62;
        ctx.strokeStyle = "#92400e";
        ctx.lineWidth = 6;
        const chargeSize = Math.min(p.brownChargeTimer / 3, 20);
        ctx.strokeRect(p.x - chargeSize / 2, drawY - chargeSize / 2, p.width + chargeSize, drawHeight + chargeSize);
        ctx.globalAlpha = 1;
      }

      if (p.brownInvulnTimer > 0) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = "#92400e";
        ctx.lineWidth = 5;
        ctx.strokeRect(p.x - 10, drawY - 10, p.width + 20, drawHeight + 20);
        ctx.globalAlpha = 1;
      }

      if (p.transparentPoundChargeTimer > 0) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 6]);
        const pulse = 24 + (60 - p.transparentPoundChargeTimer) * 2;
        ctx.beginPath();
        ctx.arc(p.x + p.width / 2, drawY + drawHeight / 2, pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      if (p.transparentPoundActiveTimer > 0) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = "rgba(229,231,235,0.8)";
        ctx.fillRect(0, groundLevel - 12, WORLD_W, 12);
        ctx.globalAlpha = 1;
      }

      if (p.grayHammerTimer > 0) {
        const cx = p.x + p.width / 2;
        const cy = drawY + drawHeight / 2;
        const pulse = 108 + Math.sin(Date.now() / 70) * 4;
        ctx.fillStyle = "rgba(107,114,128,0.18)";
        ctx.beginPath();
        ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(248,250,252,0.82)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(75,85,99,0.45)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, pulse - 16, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (p.pinkParrying) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = "#ec4899";
        ctx.lineWidth = 6;
        ctx.strokeRect(p.x - 10, drawY - 10, p.width + 20, drawHeight + 20);
        ctx.globalAlpha = 1;
      }

      if (p.speedBoostTimer > 0) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#e879f9";
        ctx.fillRect(p.x - 10, drawY - 10, p.width + 20, drawHeight + 20);
        ctx.globalAlpha = 1;
      }

      if (p.cooldownBoostTimer > 0) {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = "#020617";
        ctx.lineWidth = 5;
        ctx.strokeRect(p.x - 10, drawY - 10, p.width + 20, drawHeight + 20);
        ctx.globalAlpha = 1;
      }

      if (p.damageReducedTimer > 0) {
        ctx.globalAlpha = 0.72;
        ctx.strokeStyle = "rgba(226,232,240,0.72)";
        ctx.lineWidth = 5;
        ctx.setLineDash([7, 5]);
        ctx.strokeRect(p.x - 9, drawY - 9, p.width + 18, drawHeight + 18);
        ctx.setLineDash([]);
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

if (p.type === "rainbow") {
  const bodyGradient = ctx.createLinearGradient(p.x, drawY, p.x + p.width, drawY + drawHeight);
  const shift = Math.floor(Date.now() / 140) % RAINBOW_COLORS.length;
  RAINBOW_COLORS.forEach((color, index) => {
    bodyGradient.addColorStop(index / (RAINBOW_COLORS.length - 1), RAINBOW_COLORS[(index + shift) % RAINBOW_COLORS.length]);
  });
  ctx.fillStyle = bodyGradient;
} else if (p.type === "monochrome") {
  const bodyGradient = ctx.createLinearGradient(p.x, drawY, p.x + p.width, drawY + drawHeight);
  const shift = Math.floor(Date.now() / 160) % MONOCHROME_COLORS.length;
  MONOCHROME_COLORS.forEach((color, index) => {
    bodyGradient.addColorStop(index / (MONOCHROME_COLORS.length - 1), MONOCHROME_COLORS[(index + shift) % MONOCHROME_COLORS.length]);
  });
  ctx.fillStyle = bodyGradient;
} else if (p.type === "pink" && p.color !== "#ec4899") {
  const bodyGradient = ctx.createLinearGradient(p.x, drawY, p.x + p.width, drawY + drawHeight);
  bodyGradient.addColorStop(0, "#831843");
  bodyGradient.addColorStop(0.5, "#be185d");
  bodyGradient.addColorStop(1, "#f9a8d4");
  ctx.fillStyle = bodyGradient;
} else if (p.type === "brown" && p.color !== "#92400e") {
  const bodyGradient = ctx.createLinearGradient(p.x, drawY, p.x + p.width, drawY + drawHeight);
  bodyGradient.addColorStop(0, "#451a03");
  bodyGradient.addColorStop(0.5, "#78350f");
  bodyGradient.addColorStop(1, "#d97706");
  ctx.fillStyle = bodyGradient;
} else {
  ctx.fillStyle = p.color;
}
ctx.fillRect(p.x, drawY, p.width, drawHeight);

if ((p.snowflakeExpiries || []).length > 0) {
  const markX = p.x + p.width / 2;
  const markY = drawY + drawHeight / 2;
  ctx.fillStyle = "rgba(96,165,250,0.22)";
  ctx.beginPath();
  ctx.arc(markX, markY, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 5;
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 3) {
    ctx.beginPath();
    ctx.moveTo(markX - Math.cos(angle) * 13, markY - Math.sin(angle) * 13);
    ctx.lineTo(markX + Math.cos(angle) * 13, markY + Math.sin(angle) * 13);
    ctx.stroke();
  }
  ctx.strokeStyle = "#bfdbfe";
  ctx.lineWidth = 3;
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 3) {
    ctx.beginPath();
    ctx.moveTo(markX - Math.cos(angle) * 13, markY - Math.sin(angle) * 13);
    ctx.lineTo(markX + Math.cos(angle) * 13, markY + Math.sin(angle) * 13);
    ctx.stroke();
  }
}

if (p.brownOriginalForm) {
  ctx.fillStyle = "#92400e";
  ctx.beginPath();
  ctx.arc(p.x + p.width / 2, drawY + drawHeight / 2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#451a03";
  ctx.lineWidth = 2;
  ctx.stroke();
}

if (p.shotgunVisualTimer > 0) {
  ctx.save();
  const downward = !!p.shotgunVisualDownward;
  const scale = p.facing > 0 ? 1 : -1;
  ctx.translate(downward ? centerX(p) : p.x + (p.facing > 0 ? p.width + 5 : -5), downward ? drawY + drawHeight + 6 : drawY + drawHeight * 0.5);
  if (downward) {
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.scale(scale, 1);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#111827";
  ctx.fillStyle = "#c2410c";
  ctx.beginPath();
  ctx.moveTo(-46, -11);
  ctx.lineTo(-22, -16);
  ctx.lineTo(-16, -9);
  ctx.lineTo(13, -9);
  ctx.lineTo(13, 8);
  ctx.lineTo(-18, 8);
  ctx.lineTo(-25, 15);
  ctx.lineTo(-42, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f97316";
  ctx.fillRect(-22, -14, 36, 19);
  ctx.strokeRect(-22, -14, 36, 19);
  ctx.fillStyle = "#475569";
  ctx.fillRect(12, -11, 42, 7);
  ctx.strokeRect(12, -11, 42, 7);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(18, 1, 32, 7);
  ctx.strokeRect(18, 1, 32, 7);
  ctx.fillStyle = "#ea580c";
  for (let i = 0; i < 4; i++) ctx.fillRect(-13 + i * 6, -10, 3, 8);
  for (let i = 0; i < 5; i++) ctx.fillRect(22 + i * 5, 1, 3, 8);
  ctx.fillStyle = "#111827";
  ctx.fillRect(-4, -8, 16, 8);
  ctx.fillRect(-9, 7, 8, 18);
  ctx.fillRect(47, -16, 8, 5);
  ctx.restore();
}

if (p.type === "transparent") {
  const square = 10;
  for (let yy = 0; yy < drawHeight; yy += square) {
    for (let xx = 0; xx < p.width; xx += square) {
      ctx.fillStyle = ((xx / square + yy / square) % 2 === 0) ? "#f8fafc" : "#cbd5e1";
      ctx.fillRect(p.x + xx, drawY + yy, Math.min(square, p.width - xx), Math.min(square, drawHeight - yy));
    }
  }
}

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

  if (p.attackType === "monochromegrab") {
    const dir = p.facing > 0 ? 1 : -1;
    const armStartX = p.facing > 0 ? p.x + p.width - 2 : p.x + 2;
    const armY = drawY + drawHeight * 0.42;
    const armEndX = armStartX + dir * 104;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#020617";
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(armStartX, armY);
    ctx.lineTo(armEndX, armY);
    ctx.stroke();
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(armStartX, armY);
    ctx.lineTo(armEndX, armY);
    ctx.stroke();
    ctx.fillStyle = "#020617";
    ctx.beginPath();
    ctx.arc(armEndX, armY, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 4;
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = p.lightColor;
    ctx.fillRect(p.hitbox.x, p.hitbox.y, p.hitbox.width, p.hitbox.height);

    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.hitbox.x, p.hitbox.y, p.hitbox.width, p.hitbox.height);
  }

  ctx.restore();
}

      if (p.blocking) {
        ctx.strokeStyle = "rgba(251,191,36,0.95)";
        ctx.lineWidth = 4;
        ctx.strokeRect(p.x - 5, drawY - 5, p.width + 10, drawHeight + 10);
      }

      if (p.isSummon) {
        const barW = 44;
        const barH = 5;
        const hpPct = Math.max(0, Math.min(1, p.health / (p.maxHealth || 15)));
        ctx.fillStyle = "rgba(17,24,39,0.85)";
        ctx.fillRect(p.x - 2, p.y + p.height + 6, barW, barH);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y + p.height + 6, barW * hpPct, barH);
      }

      if (p.brownOriginalForm) {
        const barW = 44;
        const barH = 5;
        const hpPct = Math.max(0, Math.min(1, p.brownMorphHealth / 5));
        ctx.fillStyle = "rgba(17,24,39,0.85)";
        ctx.fillRect(p.x - 2, p.y + p.height + 6, barW, barH);
        ctx.fillStyle = "#92400e";
        ctx.fillRect(p.x - 2, p.y + p.height + 6, barW * hpPct, barH);
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

      const isOnlineMatch = (mode === "online" || mode === "online2v2") && !!onlineMatchRef.current?.matchId;
      const isOnlineHost = isOnlineMatch && onlineMatchRef.current?.host === true;
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
          if (!p.isHuman && !p.dummy) updateAI(p);
        }

        for (const p of fighters) updatePerFrame(p);
        resolveSolidFighterCollisions();

        for (const attacker of fighters) {
          if (!attacker.alive) continue;
          if (!attacker.attacking) continue;

          const hitPeakIndex = attacker.hitbox?.width > 0
            ? projectiles.current.findIndex((peak) => peak.type === "graypeak" && peak.lifeFrames > 0 && rectOverlap(attacker.hitbox, peak))
            : -1;
          if (hitPeakIndex >= 0) {
            const wasRoll = attacker.attackType === "purpleroll";
            destroyGrayPeakAt(hitPeakIndex);
            attacker.attacking = false;
            attacker.attackTimer = 0;
            attacker.attackType = "";
            attacker.attackHeight = "";
            attacker.dashTimer = 0;
            attacker.special3RollTimer = 0;
            attacker.vx = 0;
            if (wasRoll) attacker.ducking = false;
            continue;
          }

          if (attacker.attackType === "dash") {
            for (const defender of fighters) {
              if (!defender.alive) continue;
              if (defender.team === attacker.team) continue;
              if (tryDashHit(attacker, defender)) {
                markKOIfNeeded(defender);
              }
            }
          } else if (attacker.attackType === "purpleroll") {
            for (const defender of fighters) {
              if (!defender.alive || defender.team === attacker.team || attacker.special3HasHit) continue;
              if (checkHitboxCollision(attacker, defender)) {
                applyDamage(attacker, defender, "purpleroll", { attackHeight: "low" });
                attacker.special3HasHit = true;
                attacker.special3RollTimer = 0;
                attacker.attackTimer = 0;
                attacker.attacking = false;
                attacker.ducking = false;
                attacker.vx = 0;
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
          if (proj.type === "greenresidue") {
            proj.lifeFrames--;
            proj.residueTickFrames = proj.residueTickFrames || {};
            fighters.filter((target) => target.alive && target.team !== proj.team).forEach((target) => {
              const standingInPuddle = Math.abs(centerX(target) - proj.x) <= (proj.radius || 60) && Math.abs(target.y + target.height - proj.y) <= 24;
              if (!standingInPuddle) return;
              const nextTick = proj.residueTickFrames[target.id] || 0;
              if (nextTick <= 0) {
                applyDamage(proj.owner, target, "greenresidue", { attackHeight: "unblockable", isProjectile: true, knockbackDir: 0 });
                markKOIfNeeded(target);
                proj.residueTickFrames[target.id] = 60;
              } else {
                proj.residueTickFrames[target.id] = nextTick - 1;
              }
            });
            if (proj.lifeFrames <= 0) projectiles.current.splice(i, 1);
            continue;
          }

          if (proj.type === "graypeak" || proj.type === "rainbowblast") {
            proj.lifeFrames--;
            if (proj.lifeFrames <= 0) {
              if (proj.type === "graypeak" && proj.owner) proj.owner.grayPeakId = null;
              projectiles.current.splice(i, 1);
            }
            continue;
          }

          if (proj.trackXOnly && proj.owner?.alive) {
            const realTarget = getNearestEnemy(proj.owner);
            const target = !proj.owner.isHuman && realTarget ? getAiPerceivedTarget(proj.owner, realTarget) : realTarget;
            if (target) {
              const targetX = target.x + target.width / 2;
              proj.x += (targetX - proj.x) * 0.18;
            }
          } else if (proj.homing && proj.owner?.alive) {
            const realTarget = getNearestEnemy(proj.owner);
            const target = !proj.owner.isHuman && realTarget ? getAiPerceivedTarget(proj.owner, realTarget) : realTarget;
            if (target) {
              const dx = target.x + target.width / 2 - proj.x;
              const dy = target.y + target.height / 2 - proj.y;
              const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
              const speed = proj.speed || 12;
              proj.vx = (dx / distance) * speed;
              proj.vy = (dy / distance) * speed;
            }
          }
          const previousX = proj.x;
          const previousY = proj.y;
          if (proj.gravity) proj.vy = (proj.vy || 0) + proj.gravity;
          proj.x += proj.vx;
          proj.y += proj.vy || 0;

          if (!proj.passesPlatforms && (proj.type === "greenarc" || proj.type === "rainbowgrenade")) {
            const surface = platforms.find((platform) => {
              const withinX = proj.x + proj.radius >= platform.x && proj.x - proj.radius <= platform.x + platform.width;
              const crossedTop = previousY + proj.radius <= platform.y && proj.y + proj.radius >= platform.y;
              const crossedSide = previousX !== proj.x && proj.y >= platform.y && proj.y <= platform.y + platform.height && ((previousX < platform.x && proj.x >= platform.x) || (previousX > platform.x + platform.width && proj.x <= platform.x + platform.width));
              return withinX && (crossedTop || crossedSide);
            });
            if (surface) {
              if (proj.type === "greenarc") {
                explodeGreenArc(proj, proj.x, surface.y);
                projectiles.current.splice(i, 1);
                continue;
              }
              proj.bounceCount = (proj.bounceCount || 0) + 1;
              if (proj.bounceCount >= 3) {
                explodeRainbowGrenade(proj);
                projectiles.current.splice(i, 1);
                continue;
              }
              proj.y = surface.y - proj.radius - 1;
              proj.vy = -Math.max(5, Math.abs(proj.vy) * 0.58);
              proj.vx = Math.sign(proj.vx || proj.owner?.facing || 1) * (proj.bounceCount === 1 ? 4.2 : 3.4);
              playSfx("block");
            }
          }

          const blockingPeakIndex = projectiles.current.findIndex((peak) => peak.type === "graypeak" && peak.lifeFrames > 0 && proj.x + proj.radius >= peak.x && proj.x - proj.radius <= peak.x + peak.width && proj.y + proj.radius >= peak.y && proj.y - proj.radius <= peak.y + peak.height);
          if (blockingPeakIndex >= 0) {
            const peak = projectiles.current[blockingPeakIndex];
            if (proj.type === "brownshift") {
              const phaseOwner = proj.phaseOwner || fighters.find((p) => p.id === proj.phaseOwnerId) || proj.owner;
              popBrownShiftOffPeak(phaseOwner, peak, proj);
            }
            if (proj.type === "greenarc") explodeGreenArc(proj, proj.x, proj.y);
            destroyGrayPeakAt(blockingPeakIndex);
            if (blockingPeakIndex < i) i--;
            const currentIndex = projectiles.current.indexOf(proj);
            if (currentIndex >= 0) projectiles.current.splice(currentIndex, 1);
            continue;
          }

          let handledProjectile = false;
          for (const target of fighters) {
            if (!target.alive) continue;
            if (target.team === proj.team) continue;
            if (target.brownPhasing) continue;
            if (target.transparentBurrowing) continue;

            if (proj.attackHeight === "high" && target.ducking) continue;

            if (proj.type === "yellowwave") {
              const waveRect = {
                x: proj.x - (proj.width || 44) / 2,
                y: proj.y - (proj.height || 92),
                width: proj.width || 44,
                height: proj.height || 92,
              };
              if (!rectOverlap(waveRect, target.hurtbox)) continue;
              applyDamage(proj.owner, target, "yellowwave", {
                attackHeight: proj.attackHeight,
                isProjectile: true,
                knockbackDir: proj.knockbackDir ?? (target.x + target.width / 2 >= proj.x ? 1 : -1),
                ignoreRainbowInvulnerable: !!proj.reflected,
              });
              markKOIfNeeded(target);
              projectiles.current.splice(i, 1);
              handledProjectile = true;
              break;
            }

            const dx = target.x + target.width / 2 - proj.x;
            const dy = target.y + target.height / 2 - proj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < target.width / 2 + proj.radius) {
              if (target.type === "rainbow" && target.rainbowTurretTimer > 0 && !proj.reflected) {
                if (proj.type === "yellowspear" && proj.owner) proj.owner.spearLocked = false;
                projectiles.current.splice(i, 1);
                handledProjectile = true;
                break;
              }

              if (target.brownInvulnTimer > 0) {
                if (proj.type === "yellowspear" && proj.owner) proj.owner.spearLocked = false;
                projectiles.current.splice(i, 1);
                handledProjectile = true;
                break;
              }

              if (target.reflecting && proj.type !== "rainbowgrenade") {
                if (proj.type === "yellowspear" && proj.owner) proj.owner.spearLocked = false;

                const oldVx = proj.vx || 0;
                const newDir = oldVx === 0 ? (target.facing || 1) : -Math.sign(oldVx);

                proj.owner = target;
                proj.team = target.team;
                proj.x = target.x + (newDir > 0 ? target.width + proj.radius + 4 : -proj.radius - 4);
                proj.y = target.y + target.height / 2;
                proj.vx = newDir * Math.max(8, Math.abs(oldVx) || 8);
                proj.vy = 0;
                proj.reflected = true;
                if (proj.type === "brownshift") {
                  proj.team = target.team;
                  proj.owner = target;
                }

                handledProjectile = true;
                break;
              }

              if (proj.type === "rainbowgrenade") {
                explodeRainbowGrenade(proj, target);
              } else if (proj.type === "greenarc") {
                explodeGreenArc(proj, proj.x, Math.min(groundLevel, target.y + target.height), target);
              } else if (proj.type === "orangeharpoon") {
                const blocked = canBlockAttack(proj.owner, target, "harpoon", proj.attackHeight);
                applyDamage(proj.owner, target, "harpoon", {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
                  knockbackDir: 0,
                });
                if (!blocked && proj.owner?.type === "explosion") proj.owner.harpoonTargetId = target.id;
              } else if (proj.type === "browncolorball") {
                const blocked = canBlockAttack(proj.owner, target, "browncolorball", proj.attackHeight);
                applyDamage(proj.owner, target, "browncolorball", {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
                  knockbackDir: Math.sign(proj.vx) || 1,
                });
                if (!blocked && proj.owner?.type === "brown") morphBrownInto(proj.owner, target);
              } else if (proj.type === "chargeball") {
                breakSpearStunIfNeeded(target);
                breakFreezeIfNeeded(target);

                const blocked = canBlockAttack(proj.owner, target, "chargeball", proj.attackHeight);
                let actualDamage = target.damageAmpTimer > 0 ? proj.damage * 2 : proj.damage;
                if (proj.owner?.damageReducedTimer > 0) actualDamage = Math.ceil(actualDamage * 0.5);
                let knockback = Math.min(24, 6 + Math.floor((proj.damage || 1) / 2));
                if (target.brownCharging) {
                  target.brownCharging = false;
                  target.brownChargeTimer = 0;
                }
                if (target.brownInvulnTimer > 0) actualDamage = 0;

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
              } else if (proj.type === "brownshift") {
                const phaseOwner = proj.phaseOwner || fighters.find((p) => p.id === proj.phaseOwnerId) || proj.owner;
                applyDamage(phaseOwner, target, "brownshift", {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
                  knockbackDir: proj.knockbackDir ?? (Math.sign(proj.vx) || 1),
                  ignoreRainbowInvulnerable: !!proj.reflected,
                });
                landBrownShift(phaseOwner, target.x + target.width / 2 - (phaseOwner?.width || 40) / 2);
              } else if (proj.type === "monochromeball") {
                applyDamage(proj.owner, target, "monochromeball", {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
                  knockbackDir: proj.knockbackDir ?? (Math.sign(proj.vx) || 1),
                  ignoreRainbowInvulnerable: !!proj.reflected,
                });
              } else if (proj.type === "yellowspear") {
                const blocked = canBlockAttack(proj.owner, target, "yellowspear", proj.attackHeight);
                applyDamage(proj.owner, target, "yellowspear", {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
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
                  target.airJumpsUsed = 0;
                  target.spearStunned = true;
                  target.spearStunTimer = 180;
                  target.frozen = false;
                  target.frozenTimer = 0;
                  target.monochromeStunned = false;
                  target.monochromeStunTimer = 0;
                  target.brownStunned = false;
                  target.brownStunTimer = 0;
                  target.hitstun = false;
                  target.hitstunTimer = 0;
                }
              } else if (proj.type === "pinkplus") {
                applyDamage(proj.owner, target, "pinkplus", {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
                  knockbackDir: proj.knockbackDir ?? (Math.sign(proj.vx) || 1),
                  ignoreRainbowInvulnerable: !!proj.reflected,
                });
              } else if (proj.type === "poisonorb") {
                applyDamage(proj.owner, target, "poisonorb", {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
                  knockbackDir: proj.knockbackDir ?? (Math.sign(proj.vx) || 1),
                  ignoreRainbowInvulnerable: !!proj.reflected,
                });
              } else {
                applyDamage(proj.owner, target, proj.type, {
                  attackHeight: proj.attackHeight,
                  isProjectile: true,
                  knockbackDir: proj.knockbackDir ?? (Math.sign(proj.vx) || 1),
                  ignoreRainbowInvulnerable: !!proj.reflected,
                  additiveKnockback: !!proj.additiveKnockback,
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
            if (proj.type === "orangeharpoon" && proj.owner) {
              proj.owner.harpoonTargetId = null;
              proj.owner.harpoonPullTimer = 0;
            }
            if (proj.type === "brownshift") {
              const phaseOwner = proj.phaseOwner || fighters.find((p) => p.id === proj.phaseOwnerId) || proj.owner;
              landBrownShift(phaseOwner, proj.x < -50 ? 0 : WORLD_W - (phaseOwner?.width || 40));
            }
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

      const fighterBarColor = (fighter) => fighter.type === "rainbow" ? "rainbow" : fighter.type === "monochrome" ? "monochrome" : fighter.type === "transparent" ? "#e5e7eb" : fighter.color;

      if (!is2v2) {
        const f1 = fighters.find((f) => f.team === 1);
        const f2 = fighters.find((f) => f.team === 2);
        const f1Tag = mode === "online" ? f1.playerName || "Player 1" : "You";
        const f2Tag = mode === "online" ? f2.playerName || "Player 2" : f2.isHuman ? "P2" : gameConfig.practiceDummy ? "Dummy" : "AI";
        drawHealthBarSmall(`${f1.name} (${f1Tag})`, f1.alive ? f1.health : 0, 30, 20, fighterBarColor(f1), team1Rounds, false, f1.maxHealth || 100);
        drawHealthBarSmall(`${f2.name} (${f2Tag})`, f2.alive ? f2.health : 0, WORLD_W - 250, 20, fighterBarColor(f2), team2Rounds, true, f2.maxHealth || 100);
      } else {
        const p1 = fighters.find((f) => f.id === "p1");
        const p2 = fighters.find((f) => f.id === "p2");
        const e1 = fighters.find((f) => f.id === "ai1");
        const e2 = fighters.find((f) => f.id === "ai2");

        drawHealthBarSmall(`${p1.name} (P1)`, p1.alive ? p1.health : 0, 20, 18, fighterBarColor(p1), team1Rounds, false, p1.maxHealth || 100);
        drawHealthBarSmall(`${p2.name} (P2)`, p2.alive ? p2.health : 0, 20, 86, fighterBarColor(p2), null, false, p2.maxHealth || 100);

        drawHealthBarSmall(`${e1.name} (E1)`, e1.alive ? e1.health : 0, WORLD_W - 250, 18, fighterBarColor(e1), team2Rounds, true, e1.maxHealth || 100);
        drawHealthBarSmall(`${e2.name} (E2)`, e2.alive ? e2.health : 0, WORLD_W - 250, 86, fighterBarColor(e2), null, true, e2.maxHealth || 100);
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

    primeNewRound();
  }, 1800);

  return () => window.clearTimeout(id);
}, [gameOver, matchWinnerText, menuStep, mode]);

useEffect(() => {
  const match = onlineMatchRef.current;
  const socket = socketRef.current;
  const isOnlineMatch = (mode === "online" || mode === "online2v2") && menuStep === "playing" && match?.matchId;
  if (!isOnlineMatch || !socket || !gameOver || !matchWinnerText) return;
  if (onlineMatchEndSentRef.current) return;

  const p1Rounds = matchWinnerText === "Team 1" ? Math.max(team1Rounds, 2) : team1Rounds;
  const p2Rounds = matchWinnerText === "Team 2" ? Math.max(team2Rounds, 2) : team2Rounds;
  const winnerId = mode === "online2v2" ? null : matchWinnerText === "Team 1" ? match.p1UserId : matchWinnerText === "Team 2" ? match.p2UserId : null;

  onlineMatchEndSentRef.current = true;
  const finishOnlineMatch = () => {
    refreshOnlineUser();
    refreshAchievements();
    clearOnlineSession({ disconnectSocket: true, keepLobby: false });
    setSettingsOpen(false);
    setMode("home");
    setMenuStep("idle");
    resetAll();
  };
  if (onlineReturnScheduledRef.current) return;
  onlineReturnScheduledRef.current = true;
  window.setTimeout(finishOnlineMatch, 2000);

  const resultPayload = {
    matchId: match.matchId,
    p1Rounds,
    p2Rounds,
    winnerId,
  };
  const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("rgb_token") : null);

  if (authToken) {
    fetch(`${apiBaseUrl}/api/match/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: authToken, ...resultPayload }),
      keepalive: true,
    }).catch(() => {});
  }

  socket.emit("match:end", resultPayload);
}, [gameOver, matchWinnerText, team1Rounds, team2Rounds, mode, menuStep, token]);

  if (!tailwindLoaded) return <div style={{ padding: 20, textAlign: "center" }}>Loading…</div>;

  const CharSelectModal = () => {
    if (!charSelect) return null;
    const matchId = charSelect.matchId || (matched && matched.matchId) || (onlineMatchRef.current && onlineMatchRef.current.matchId);
    const lockedSecretColor = charSelect.lockedSecretColor || getLockedSecretColor(user?.username);
    const lockedSecretName = lockedSecretColor === "monochrome" ? "Monochrome" : lockedSecretColor === "transparent" ? "Transparent" : "Rainbow";
    return (
      <div className="fixed inset-0 bg-black/10 backdrop-blur-[2px] z-50 flex items-start justify-center overflow-y-auto px-3 py-3 sm:py-6">
        <div className="bg-white/95 rounded-2xl p-4 sm:p-6 max-w-4xl w-full mx-auto shadow-2xl">
          <h3 className="text-xl mb-3">Character Select — {Math.ceil((charSelect.timeLeft || 20000) / 1000)}s</h3>
          {lockedSecretColor ? (
            <div className="rounded-3xl border border-gray-300 bg-gray-50 p-5 sm:p-8 text-center">
              <div className="text-3xl font-light text-gray-900 mb-2">{lockedSecretName} selected</div>
              <div className="text-sm text-gray-600 font-light">This username is locked into the secret {lockedSecretName} fighter.</div>
            </div>
          ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
            {ONLINE_FIGHTER_COLORS.map((c) => {
              const locked = !canUseColor(c);
              return (
              <ColorCard
                key={c}
                color={c}
                selected={charSelect.me === c}
                onClick={() => {
                  if (locked) return;
                  if (!socketRef.current) return;
                  setCharSelect((prev) => prev ? { ...prev, me: c } : prev);
                  try {
                    const slot = matched?.slot || onlineMatchRef.current?.slot;
                    const side = matched?.side || (onlineMatchRef.current && onlineMatchRef.current.side) || 'left';
                    if (slot === "p2") setP2Color(c);
                    else if (side === 'left') setP1Color(c);
                    else setP2Color(c);
                  } catch (e) {}
                  socketRef.current.emit('char:selected', { matchId, character: c });
                }}
                locked={locked}
                lockText={lockTextForColor(c)}
              />
            );
            })}
          </div>
          )}
          <div className="mt-5">
            <div className="text-sm text-gray-600 mb-2">Map Vote — required</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {ONLINE_STAGE_CHOICES.map((stageChoice) => (
                <button
                  key={stageChoice.key}
                  onClick={() => sendOnlineMapVote(stageChoice.key)}
                  className={`rounded-xl border px-3 py-3 text-sm transition ${
                    charSelect.map === stageChoice.key
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-800 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {stageChoice.name}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Opponent: {matched?.opponent?.username} {charSelect.opponent ? `(selected: ${charSelect.opponent})` : ''}
            {charSelect.opponentMap ? " • map voted" : ""}
          </div>
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
      className={`${menuStep === "playing" ? "fixed bottom-6 right-6" : "fixed top-6 right-6"} z-40 bg-white/90 backdrop-blur border border-gray-200 rounded-2xl px-4 py-3 hover:bg-white transition flex items-center gap-2`}
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
        (!listeningFor?.type || listeningFor?.type === "keyboard") &&
        listeningFor?.player === player &&
        listeningFor?.action === action;

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
                const next = { type: "keyboard", player, action };
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

    const ControllerRow = ({ title, action, currentInput }) => {
      const active = listeningFor?.type === "controller" && listeningFor?.action === action;

      return (
        <div
          className={`flex items-center justify-between gap-3 p-4 rounded-2xl border transition ${
            active
              ? "border-orange-600 bg-orange-50"
              : "border-gray-100 bg-white"
          }`}
        >
          <div>
            <div className="text-sm text-gray-900 font-light">{title}</div>
            <div className="text-xs text-gray-500 font-light mt-1">
              Current:{" "}
              <span className="font-medium text-gray-700">
                {prettyControllerInput(currentInput)}
              </span>
            </div>
          </div>

          <button
            type="button"
            className={`rounded-2xl px-4 py-2 border transition text-sm font-light ${
              active
                ? "border-orange-600 bg-orange-600 text-white"
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
                const next = { type: "controller", player: "p1", action };
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
        <Row title="Special Move 3" player={player} action="special3" currentKey={binds.special3} />
      </>
    );

    const renderControllerRows = (binds) => (
      <>
        <ControllerRow title="Move Left" action="moveLeft" currentInput={binds.moveLeft} />
        <ControllerRow title="Move Right" action="moveRight" currentInput={binds.moveRight} />
        <ControllerRow title="Jump" action="jump" currentInput={binds.jump} />
        <ControllerRow title="Duck" action="duck" currentInput={binds.duck} />
        <ControllerRow title="Block" action="block" currentInput={binds.block} />
        <ControllerRow title="Punch" action="punch" currentInput={binds.punch} />
        <ControllerRow title="Kick" action="kick" currentInput={binds.kick} />
        <ControllerRow title="Special Move 1" action="special1" currentInput={binds.special1} />
        <ControllerRow title="Special Move 2" action="special2" currentInput={binds.special2} />
        <ControllerRow title="Special Move 3" action="special3" currentInput={binds.special3} />
      </>
    );

    const listeningLabel = listeningFor
      ? `${listeningFor.type === "controller" ? "Player 1 Controller" : listeningFor.player === "p1" ? "Player 1" : "Player 2"} ${
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
              {listeningFor.type === "controller"
                ? "Press a Microsoft/Xbox controller button or move a stick for "
                : "Press a key for "}
              <span className="font-medium text-gray-900">{listeningLabel}</span>.
              <span className="text-gray-500">
                {listeningFor.type === "controller" ? " Click Change again to cancel." : " Esc cancels."}
              </span>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {[
              ["keyboard", "Keyboard + Audio"],
              ["controller", "Controller (P1)"],
            ].map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className={`rounded-2xl px-4 py-2 border transition text-sm font-light ${
                  settingsTab === tab
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 hover:bg-gray-50 text-gray-800"
                }`}
                onClick={() => {
                  listeningForRef.current = null;
                  setListeningFor(null);
                  keysPressed.current = {};
                  setSettingsTab(tab);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {settingsTab === "keyboard" && (
            <>
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
            </>
          )}

          {settingsTab === "controller" && (
            <div className="mt-6 rounded-3xl border border-orange-100 bg-orange-50/40 p-5">
              <div>
                <div className="text-sm font-light text-gray-800">Player 1 Controller</div>
                <div className="text-xs text-gray-500 font-light mt-1">
                  Microsoft/Xbox layout only. Player 2 stays keyboard only.
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {renderControllerRows(p1ControllerBinds)}
              </div>
            </div>
          )}

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
                setP1ControllerBinds(DEFAULT_P1_CONTROLLER);
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
            {settingsTab === "controller"
              ? "Tip: Connect an Xbox controller, click Change, then press a button or move a stick. Controller binds only affect Player 1."
              : "Tip: Click Change, press one key, and it will automatically save. Duplicate keys are removed from the other player so controls do not overlap."}
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

  const PasswordResetPanel = () => {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [message, setMessage] = useState("");
    const [saving, setSaving] = useState(false);

    const submit = (event) => {
      event.preventDefault();
      playSfx("menu_select");
      const authToken = getAuthToken();
      if (!authToken || saving) return;
      if (!currentPassword || !newPassword || !confirmPassword) {
        setMessage("Fill out all password fields.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setMessage("New passwords do not match.");
        return;
      }

      setSaving(true);
      setMessage("");
      api.resetPassword(authToken, currentPassword, newPassword).then(() => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordResetOpen(false);
        goHome();
      }).catch((err) => {
        setMessage(err?.error || `Could not reset password${err?.status ? ` (${err.status})` : ""}.`);
      }).finally(() => setSaving(false));
    };

    return (
      <form onSubmit={submit} className="mx-auto mt-5 max-w-md text-left border border-gray-200 rounded-2xl p-5 space-y-3">
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900" />
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" autoComplete="new-password" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900" />
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900" />
        {message && <div className="text-sm text-red-600">{message}</div>}
        <button type="submit" disabled={saving} className="w-full bg-green-600 text-white rounded-2xl px-6 py-3 disabled:opacity-60">{saving ? "Updating..." : "Update Password"}</button>
      </form>
    );
  };

  const FriendAddForm = () => {
    const [username, setUsername] = useState("");
    const [sending, setSending] = useState(false);

    const submit = (event) => {
      event.preventDefault();
      playSfx("menu_select");
      const authToken = getAuthToken();
      const cleanUsername = username.trim();
      if (!authToken || !cleanUsername || sending) return;

      setSending(true);
      api.sendFriendRequest(authToken, cleanUsername).then((data) => {
        setUsername("");
        setFriendsMessage(`Friend request sent to ${data?.username || "player"}.`);
        refreshFriends();
      }).catch((err) => {
        setFriendsMessage(err?.error || "Could not send friend request.");
      }).finally(() => setSending(false));
    };

    return (
      <form onSubmit={submit} className="flex gap-2">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-gray-900" />
        <button type="submit" disabled={sending} className="rounded-xl bg-gray-900 text-white px-4 py-3 disabled:opacity-60">{sending ? "Sending" : "Send"}</button>
      </form>
    );
  };

  const ColorCard = ({ color, selected, onClick, locked = false, lockText = "" }) => {
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
        : color === "gray"
        ? "rgba(107, 114, 128, 0.22)"
        : color === "brown"
        ? "rgba(146, 64, 14, 0.24)"
        : color === "pink"
        ? "rgba(236, 72, 153, 0.24)"
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
        : color === "gray"
        ? "#6b7280"
        : color === "brown"
        ? "#92400e"
        : color === "pink"
        ? "#ec4899"
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
        : color === "gray"
        ? "bg-gray-500 border-gray-300"
        : color === "brown"
        ? "bg-amber-900 border-amber-950"
        : color === "pink"
        ? "bg-pink-500 border-pink-700"
        : "bg-gray-800 border-black";

    return (
      <button
        onClick={locked ? undefined : onClick}
        disabled={locked}
        className={`group relative bg-white border rounded-3xl p-10 transition-all duration-150 ${
          locked ? "opacity-70 cursor-not-allowed" : "hover:scale-[0.98] active:scale-95"
        }`}
        style={{
          boxShadow: selected ? `0 15px 40px ${glow}` : "0 10px 30px rgba(0, 0, 0, 0.05)",
          borderColor: selected ? border : "#f3f4f6",
        }}
      >
        <div className="mb-6">
          <div className={`w-24 h-32 rounded-2xl mx-auto border-4 ${bodyClass}`} />
        </div>
        <h2 className="text-2xl font-light text-gray-900 mb-2 capitalize">{color}</h2>
        {locked && (
          <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-gray-900/90 text-white text-[11px] font-light px-3 py-2">
            {lockText}
          </div>
        )}
      </button>
    );
  };

  const Medal = ({ filled, color, label }) => (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`w-8 h-8 rounded-full border-2 ${filled ? "" : "bg-white border-gray-300"}`}
        style={filled ? { background: color, borderColor: color, boxShadow: `0 0 16px ${color}` } : {}}
        title={label}
      />
      <div className="text-[10px] text-gray-500 font-light">{label}</div>
    </div>
  );

  const AchievementScreen = () => {
    const hasAchievement = (key) => achievements.includes(key);
    const onlineWins = Number(user?.wins) || 0;

    return (
      <Layout>
        <div className="bg-white rounded-3xl p-10 text-center max-w-5xl w-full border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-3">Achievements</h1>
          {!user ? (
            <>
              <p className="text-lg font-light text-gray-600 mb-8">Sign in from the Login tab to view and earn achievements.</p>
              <button onClick={goHome} className="rounded-2xl px-6 py-3 bg-gray-900 text-white">Return Home</button>
            </>
          ) : (
            <>
              <p className="text-sm font-light text-gray-500 mb-4">Logged in as {user.username}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 text-sm">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                  <div className="text-gray-500 font-light">Record</div>
                  <div className="text-gray-900">{currentRecord}</div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                  <div className="text-gray-500 font-light">Wins Rank</div>
                  <div className="text-gray-900">#{userRank?.winsRank || "?"} · {Number(user?.wins) || 0} wins</div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                  <div className="text-gray-500 font-light">WLR Rank</div>
                  <div className="text-gray-900">#{userRank?.wlrRank || "?"} · {currentWlr} WLR</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                {FIGHTER_COLORS.map((color) => (
                  <div key={color} className="rounded-3xl border border-gray-100 bg-gray-50 p-5 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-lg text-gray-900 font-light capitalize">{color} Ladder</div>
                      <div className="text-xs text-gray-500 font-light">Beat the hard ladder with {color}</div>
                    </div>
                    <div className="flex gap-3">
                      <Medal filled={hasAchievement(`ladder:${color}:hard`)} color="#facc15" label="Hard" />
                    </div>
                  </div>
                ))}
                <div className="rounded-3xl border border-gray-100 bg-gray-50 p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-lg text-gray-900 font-light">Online Wins</div>
                    <div className="text-xs text-gray-500 font-light">{onlineWins} wins earned</div>
                  </div>
                  <div className="flex gap-3">
                    <Medal filled={onlineWins >= 1} color="#cd7f32" label="1" />
                    <Medal filled={onlineWins >= 10} color="#9ca3af" label="10" />
                    <Medal filled={onlineWins >= 50} color="#facc15" label="50" />
                  </div>
                </div>
                <div className="rounded-3xl border border-gray-100 bg-gray-50 p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-lg text-gray-900 font-light">Rainbow Slayer</div>
                    <div className="text-xs text-gray-500 font-light">Beat Rainbow in 1v1 Online</div>
                  </div>
                  <div
                    className={`text-4xl ${hasAchievement("online:rainbow") ? "" : "grayscale opacity-25"}`}
                    style={hasAchievement("online:rainbow") ? { filter: "drop-shadow(0 0 12px rgba(168,85,247,0.8))" } : {}}
                  >
                    🌟
                  </div>
                </div>
              </div>
              <button onClick={goHome} className="mt-8 rounded-2xl px-6 py-3 bg-gray-900 text-white">Return Home</button>
            </>
          )}
        </div>
      </Layout>
    );
  };

  if (menuStep === "achievements") {
    return <AchievementScreen />;
  }

  if (mode === "friends" && menuStep === "friends") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-8 max-w-6xl w-full border border-black/5 text-gray-900" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="text-5xl font-light">Friends List</h1>
              <p className="text-gray-500 mt-2">Signed in as <strong>{user?.username}</strong></p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { playSfx("menu_select"); refreshFriends(); }} className="rounded-2xl px-5 py-3 bg-gray-900 text-white">Refresh</button>
              <button onClick={goHome} className="rounded-2xl px-5 py-3 bg-gray-200 text-gray-900">Return Home</button>
            </div>
          </div>

          {friendsMessage && <div className="mb-5 rounded-2xl bg-gray-100 px-5 py-3 text-sm text-gray-700">{friendsMessage}</div>}
          {friendsLoading && <div className="mb-5 text-sm text-gray-500">Loading friends...</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <section className="rounded-3xl border border-gray-100 p-5">
              <h2 className="text-2xl font-light mb-4">Inbox</h2>
              {friendsData.incoming.length === 0 ? (
                <p className="text-sm text-gray-500">No friend requests.</p>
              ) : friendsData.incoming.map((request) => (
                <div key={request.id} className="flex items-center justify-between gap-3 border-t border-gray-100 py-3">
                  <span>{request.username}</span>
                  <div className="flex gap-2">
                    <button onClick={() => { playSfx("menu_select"); respondToFriendRequest(request.id, "accept"); }} className="rounded-xl bg-green-600 text-white px-3 py-2 text-sm">Accept</button>
                    <button onClick={() => { playSfx("menu_back"); respondToFriendRequest(request.id, "decline"); }} className="rounded-xl bg-red-600 text-white px-3 py-2 text-sm">Decline</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="rounded-3xl border border-gray-100 p-5">
              <h2 className="text-2xl font-light mb-4">Add</h2>
              <FriendAddForm />
              {friendsData.outgoing.length > 0 && (
                <div className="mt-4 text-sm text-gray-500">Pending: {friendsData.outgoing.map((request) => request.username).join(", ")}</div>
              )}
            </section>

            <section className="rounded-3xl border border-gray-100 p-5">
              <h2 className="text-2xl font-light mb-4">Friends</h2>
              {friendsData.friends.length === 0 ? (
                <p className="text-sm text-gray-500">No friends added yet.</p>
              ) : friendsData.friends.map((friend) => (
                <div key={friend.id} className="border-t border-gray-100 py-3">
                  <div className="font-medium">{friend.username}</div>
                  <div className="text-xs text-gray-500 mb-2">{friend.wins || 0}W - {friend.losses || 0}L</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => { playSfx("menu_select"); sendInviteToFriend(friend.id, friend.username, "private1v1"); }} className="rounded-xl bg-blue-600 text-white px-3 py-2 text-sm">Private 1v1</button>
                    <button onClick={() => { playSfx("menu_select"); sendInviteToFriend(friend.id, friend.username, "private2v2"); }} className="rounded-xl bg-purple-600 text-white px-3 py-2 text-sm">Private 2v2</button>
                    <button onClick={() => { playSfx("menu_select"); sendInviteToFriend(friend.id, friend.username, "online2v2"); }} className="rounded-xl bg-green-600 text-white px-3 py-2 text-sm">Invite 2v2 Online</button>
                    <button onClick={() => { playSfx("menu_back"); unfriendUser(friend.id, friend.username); }} className="rounded-xl bg-red-600 text-white px-3 py-2 text-sm">Unadd</button>
                  </div>
                </div>
              ))}
            </section>

            {[
              ["Private 1v1 Request", friendsData.private1v1Requests],
              ["Private 2v2 Request", friendsData.private2v2Requests],
              ["2v2 Online Request", friendsData.online2v2Requests],
            ].map(([title, requests]) => (
              <section key={title} className="rounded-3xl border border-gray-100 p-5">
                <h2 className="text-2xl font-light mb-4">{title}</h2>
                {requests.length === 0 ? (
                  <p className="text-sm text-gray-500">No active requests.</p>
                ) : requests.map((request) => (
                  <div key={request.id} className="flex items-center justify-between gap-3 border-t border-gray-100 py-3">
                    <span>{request.username}</span>
                    <div className="flex gap-2">
                      <button onClick={() => { playSfx("menu_select"); respondToGameInvite(request.id, "accept"); }} className="rounded-xl bg-green-600 text-white px-3 py-2 text-sm">Accept</button>
                      <button onClick={() => { playSfx("menu_back"); respondToGameInvite(request.id, "decline"); }} className="rounded-xl bg-red-600 text-white px-3 py-2 text-sm">Decline</button>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (mode === "online2v2" && menuStep === "online2v2") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-10 text-center max-w-3xl w-full border border-black/5 text-gray-900" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light mb-4">2v2 Online</h1>
          <p className="text-gray-500 mb-6">Invite a friend from the Friends List, then queue together as a team.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button onClick={() => startModeFlow("friends")} className="bg-gray-900 text-white rounded-2xl px-6 py-3">Open Friends List</button>
            <button onClick={goHome} className="bg-gray-200 text-gray-900 rounded-2xl px-6 py-3">Return Home</button>
          </div>
        </div>
      </Layout>
    );
  }

  if (mode === "home") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-12 text-center max-w-7xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <div className="mb-4 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <img src={rgbLogoUrl} alt="RGB Fighters logo" className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
            <h1 className="text-6xl font-light text-gray-900">RGB Fighters</h1>
          </div>
          <p className="text-4xl font-light text-gray-500 mb-12">Choose a Mode</p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { key: "login", title: "Login", desc: user ? `Signed in as ${user.username}` : "Sign in for online and achievements" },
              { key: "practice", title: "Practice", desc: "100-HP dummy (KO disappears) + Refresh button" },
              { key: "single", title: "Single Player", desc: "Fight an AI (best of 3)" },
              { key: "coop", title: "Multi Player", desc: "2v2: P1+P2 vs AI team (pick both enemies)" },
              { key: "ladder", title: "Ladder", desc: "Face all the colors" },
              { key: "offline", title: "1v1 Offline", desc: "Local PvP (P1 vs P2)" },
              { key: "online", title: "1v1 Online", desc: "Play against real players online" },
              // { key: "online2v2", title: "2v2 Online", desc: "Invite a friend and queue as a team" },
                //  { key: "friends", title: "Friends List", desc: "Requests, friends, and private invites" },
              { key: "achievements", title: "Achievements", desc: "Collect them all" },
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
                  {m.key === "login" && <div className="text-sm font-light text-gray-500 mt-2">{m.desc}</div>}
                </button>
              );
            })}
          </div>

          <div className="mt-10 text-sm text-gray-500 font-light"></div>
        </div>
      </Layout>
    );
  }

  if (mode === "login" && menuStep === "login") {
    return (
      <Layout>
        <div className="bg-white rounded-3xl p-10 text-center max-w-3xl w-full border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">Login</h1>
          {user ? (
            <div className="space-y-5">
              <p className="text-lg font-light text-gray-600">Signed in as <strong>{user.username}</strong></p>
              <div className="flex justify-center gap-3 flex-wrap">
                <button onClick={() => startModeFlow("online")} className="bg-green-600 text-white rounded-2xl px-6 py-3">Play Online</button>
                <button onClick={() => { playSfx("menu_back"); localStorage.removeItem('rgb_token'); setToken(null); setUser(null); setAchievements([]); setUserRank(null); }} className="bg-red-600 text-white rounded-2xl px-6 py-3">Logout</button>
                <button onClick={() => { playSfx("menu_select"); setPasswordResetOpen((open) => !open); }} className="bg-gray-900 text-white rounded-2xl px-6 py-3">Password Reset</button>
                <button onClick={goHome} className="bg-gray-200 text-gray-900 rounded-2xl px-6 py-3">Return Home</button>
              </div>
              {passwordResetOpen && <PasswordResetPanel />}
            </div>
          ) : (
            <div className="space-y-6">
              <Login onLogin={(u, t) => { setUser(u); setToken(t); refreshAchievements(); }} />
              <button onClick={goHome} className="bg-gray-200 text-gray-900 rounded-2xl px-6 py-3">Return Home</button>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  if ((mode === "online" || mode === "online2v2") && menuStep !== "playing") {
    return (
      <Layout>
        <CharSelectModal />
        <div className="bg-white rounded-3xl p-8 text-center max-w-4xl border border-black/5" style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.06)" }}>
          <h1 className="text-5xl font-light text-gray-900 mb-4">{mode === "online2v2" ? "Online 2v2" : "Online 1v1"}</h1>

          {!user ? (
            <div className="space-y-6">
              <p className="text-lg font-light text-gray-500">Log in from the home screen to play online.</p>
              <div className="pt-4">
                <button onClick={() => startModeFlow("login")} className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition mr-3">Go to Login</button>
                <button onClick={goHome} className="bg-gray-200 text-gray-900 rounded-2xl px-6 py-3 hover:opacity-90 transition">Return Home</button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3">
                <p className="text-lg font-light text-gray-500">Logged in as <strong>{user.username}</strong></p>
                <table className="text-sm border border-gray-200 rounded-2xl overflow-hidden">
                  <tbody>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 font-medium text-gray-600 border-r border-gray-200">Record</th>
                      <td className="px-4 py-2 text-gray-900">{currentRecord}</td>
                      <th className="px-4 py-2 font-medium text-gray-600 border-x border-gray-200">WLR</th>
                      <td className="px-4 py-2 text-gray-900">{currentWlr}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col items-center gap-4">
                {matched && (
                  <div className="p-4 border rounded-md w-full max-w-md">
                    <div className="text-sm text-gray-600 mb-2">Match Found</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">You ({user.username})</div>
                        <div className="text-xs">Record: {currentRecord}</div>
                        <div className="text-xs">Side: {matched.side === 'left' ? 'Left' : 'Right'}</div>
                      </div>
                      <div>
                        <div className="font-medium">Opponent: {matched.opponent?.username}</div>
                        <div className="text-xs">Record: {matched.opponent?.wins ?? 0}W - {matched.opponent?.losses ?? 0}L</div>
                      </div>
                    </div>
                  </div>
                )}
                {!(queueing || charSelect || matched || onlineMatchRef.current?.matchId) ? (
                <button
                  onClick={() => {
                    setOnlineError("");
                    if (socketRef.current) socketRef.current.disconnect();
                    const privateInvite = pendingPrivateInviteRef.current;
                    const teamInvite = pendingTeamInviteRef.current;
                    if (mode === "online2v2" && !teamInvite?.inviteId) {
                      setOnlineError("Invite a friend from Friends List first, then accept/join the 2v2 request.");
                      return;
                    }
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
                      if (teamInvite?.inviteId) {
                        s.emit('team:join', { inviteId: teamInvite.inviteId });
                      } else if (privateInvite?.inviteId) {
                        s.emit('private:join', { inviteId: privateInvite.inviteId });
                      } else {
                        s.emit('queue:join', { side: 'left' });
                      }
                    });

                    s.on('private:waiting', () => {
                      setQueueing(true);
                      setOnlineError("Waiting for your friend to join the private match...");
                    });

                    s.on('match:error', (payload) => {
                      setQueueing(false);
                      setOnlineError(payload?.error || "Matchmaking error.");
                    });

                    s.on('team:waiting', () => {
                      setQueueing(true);
                      setOnlineError("Waiting for your friend to join the 2v2 team...");
                    });

                    s.on('team:queued', () => {
                      setQueueing(true);
                      setOnlineError("Team ready. Searching for opponents... bot team starts after 15 seconds if nobody is found.");
                    });

                    s.on('queue:matched', (d) => {
                      setMatched(d);
                      setQueueing(false);
                      setOnlineError("");
                    });

                    s.on('char:selectStart', (d) => {
                      const lockedSecretColor = getLockedSecretColor(user?.username);
                      const nextMatchId = d.matchId || (matched && matched.matchId) || (d && d.matchId);
                      if (d?.matchId) {
                        setMatched((prev) => {
                          if (prev && prev.matchId === d.matchId) return prev;
                          return { ...(prev || {}), matchId: d.matchId, side: d.side || prev?.side, slot: d.slot || prev?.slot, mode: d.mode || prev?.mode };
                        });
                      }
                      setCharSelect({
                        timeLeft: d.timeLimit || 20000,
                        matchId: nextMatchId,
                        me: lockedSecretColor,
                        opponent: null,
                        map: null,
                        opponentMap: false,
                        lockedSecretColor,
                      });
                      if (lockedSecretColor && nextMatchId) {
                        try {
                          const slot = matched?.slot || onlineMatchRef.current?.slot;
                          const side = matched?.side || onlineMatchRef.current?.side || "left";
                          if (slot === "p2") setP2Color(lockedSecretColor);
                          else if (side === "left") setP1Color(lockedSecretColor);
                          else setP2Color(lockedSecretColor);
                        } catch {}
                        s.emit('char:selected', { matchId: nextMatchId, character: lockedSecretColor });
                      }
                    });

                    s.on('opponent:charSelected', (payload) => {
                      const c = payload?.character;
                      setCharSelect((prev) => {
                        if (!prev) return prev;
                        return { ...prev, opponent: c || prev.opponent };
                      });

                      if (payload?.slot === "p1") setP1Color((prev) => c || prev);
                      else if (payload?.slot === "p2") setP2Color((prev) => c || prev);
                      else {
                        const side = payload?.side || matched?.side || (onlineMatchRef.current && onlineMatchRef.current.side) || 'right';
                        if (side === 'left') {
                          setP2Color((prev) => c || prev);
                        } else {
                          setP1Color((prev) => c || prev);
                        }
                      }
                    });

                    s.on('opponent:mapSelected', () => {
                      setCharSelect((prev) => prev ? { ...prev, opponentMap: true } : prev);
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
                      pendingPrivateInviteRef.current = null;
                      pendingTeamInviteRef.current = null;
                      resetAll();
                      if (d?.matchId) {
                        setMatched((prev) => (prev && prev.matchId === d.matchId ? prev : { ...(prev || {}), matchId: d.matchId, side: d.side }));
                      }
                      const isHost = d.host === true;
                      onlineMatchRef.current = {
                        matchId: d.matchId || (matched && matched.matchId),
                        side: d.side,
                        host: isHost,
                        bot: !!d.bot,
                        botDifficulty: d.botDifficulty || null,
                        p1UserId: d.p1UserId,
                        p2UserId: d.p2UserId,
                        p1Username: d.p1Username,
                        p2Username: d.p2Username,
                        mode: d.mode || mode,
                        slot: d.slot,
                        p1Char: d.p1Char,
                        p2Char: d.p2Char,
                        e1Char: d.e1Char,
                        e2Char: d.e2Char,
                        e1Username: d.e1Username,
                        e2Username: d.e2Username,
                      };
                      onlineIsHostRef.current = isHost;
                      onlineMatchEndSentRef.current = false;
                      onlineReturnScheduledRef.current = false;
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
                      if (d.e1Char) setOpp1Color(d.e1Char);
                      if (d.e2Char) setOpp2Color(d.e2Char);
                      setStage(d.stage || "default");
                      setCharSelect(null);
                      setMode(d.mode === "online2v2" ? "online2v2" : "online");
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
                        if (payload?.slot) {
                          onlineRemoteInputsRef.current = {
                            ...onlineRemoteInputsRef.current,
                            [payload.slot]: { ...(inputs || {}) },
                          };
                        } else {
                          onlineRemoteInputsRef.current = { ...(inputs || {}) };
                        }
                      });

                      s.on('state:sync', (payload) => {
                        const m = onlineMatchRef.current;
                        if (!m || m.host) return;
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
      const finish = () => {
        refreshOnlineUser();
        refreshAchievements();
        clearOnlineSession({ disconnectSocket: true, keepLobby: false });
        setSettingsOpen(false);
        setMode("home");
        setMenuStep("idle");
        resetAll();
      };
      if (onlineReturnScheduledRef.current) return;
      if (menuStepRef.current === "playing") {
        onlineReturnScheduledRef.current = true;
        setManagedTimeout(finish, 2000);
      } else {
        finish();
      }
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
                  {mode === "online2v2" ? "Join Team Queue" : pendingPrivateInviteRef.current ? "Join Private Match" : "Search For Opponent"}
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
                <button onClick={() => { goHome(); localStorage.removeItem('rgb_token'); setToken(null); setUser(null); setAchievements([]); }} className="bg-red-600 text-white rounded-2xl px-6 py-3">Logout</button>
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
            {selectableColorsForCurrentMode().map((c) => {
              const locked = !canUseColor(c);
              return (
              <ColorCard
                key={c}
                color={c}
                selected={p1Color === c}
                onClick={() => {
                  if (locked) return;
                  playSfx("menu_select");
                  setP1Color(c);

                  if (mode === "ladder") {
                    setLadderOppOrder(shuffle(LADDER_POOL_COLORS).slice(0, 8));
                  }

                  setManagedTimeout(() => proceedAfterP1(), 0);
                }}
                locked={locked}
                lockText={lockTextForColor(c)}
              />
            );
            })}
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
            {selectableColorsForCurrentMode().map((c) => {
              const locked = !canUseColor(c);
              return (
              <ColorCard
                key={c}
                color={c}
                selected={opp1Color === c}
                onClick={() => {
                  if (locked) return;
                  playSfx("menu_select");
                  setOpp1Color(c);
                  setManagedTimeout(() => proceedAfterOpp1(), 0);
                }}
                locked={locked}
                lockText={lockTextForColor(c)}
              />
            );
            })}
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
            {selectableColorsForCurrentMode().map((c) => {
              const locked = !canUseColor(c);
              return (
              <ColorCard
                key={c}
                color={c}
                selected={opp2Color === c}
                onClick={() => {
                  if (locked) return;
                  playSfx("menu_select");
                  setOpp2Color(c);
                  setManagedTimeout(() => proceedAfterOpp2(), 0);
                }}
                locked={locked}
                lockText={lockTextForColor(c)}
              />
            );
            })}
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
            {selectableColorsForCurrentMode().map((c) => {
              const locked = !canUseColor(c);
              return (
              <ColorCard
                key={c}
                color={c}
                selected={p2Color === c}
                onClick={() => {
                  if (locked) return;
                  playSfx("menu_select");
                  setP2Color(c);
                  setManagedTimeout(() => proceedAfterP2(), 0);
                }}
                locked={locked}
                lockText={lockTextForColor(c)}
              />
            );
            })}
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
    const ladderLabel = mode === "ladder" ? `Ladder Match ${ladderIndex + 1} / ${LADDER_TOTAL_MATCHES}` : null;

    const onExit = () => {
      if (mode === "ladder") {
        setLadderExitConfirmOpen(true);
        return;
      }
      goHome();
    };

    const confirmLadderExit = () => {
      setLadderExitConfirmOpen(false);
      goHome();
    };

    const onNextMatchLadder = () => {
      if (!matchWinnerText) return;

      if (matchWinnerText === "Team 1") {
        const next = ladderIndex + 1;
        if (next >= LADDER_TOTAL_MATCHES) {
          setLadderWin(true);
          setMenuStep("ladder_result");
          return;
        }
        setLadderIndex(next);
        setStage(randStage());
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
        setLadderLoss(false);
        setTeam1Rounds(0);
        setTeam2Rounds(0);
        setGameOver(false);
        setRoundWinnerText(null);
        setMatchWinnerText(null);
        keysPressed.current = {};
        projectiles.current = [];
        primeNewRound();
        setMenuStep("playing");
      }
    };

    const winnerDisplayName = matchWinnerText === "Team 1"
      ? mode === "online" ? onlinePlayerNames.p1 || "Player 1" : "Team 1"
      : matchWinnerText === "Team 2"
      ? mode === "online" ? onlinePlayerNames.p2 || "Player 2" : "Team 2"
      : "";
    const showOverlay = gameOver;

    return (
      <div className="fixed inset-0 overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}>
        <canvas ref={canvasRef} className="absolute inset-0" />

        <GlobalSettingsButton />
        <SettingsModal />

        {ladderExitConfirmOpen && mode === "ladder" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/35">
            <div className="bg-white/95 backdrop-blur rounded-3xl p-8 border border-gray-200 text-center max-w-md mx-6">
              <div className="text-2xl font-light text-gray-900 mb-3">Are you sure you want to return home?</div>
              <div className="text-sm text-gray-600 font-light mb-7">Leaving now resets your ladder run.</div>
              <div className="flex gap-3 justify-center">
                <button onClick={confirmLadderExit} className="rounded-2xl px-6 py-3 bg-red-600 text-white hover:opacity-90 transition">
                  Return Home
                </button>
                <button onClick={() => setLadderExitConfirmOpen(false)} className="rounded-2xl px-6 py-3 border border-gray-200 hover:bg-gray-50 transition font-light text-gray-800">
                  Keep Playing
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-6 left-6 z-40 flex items-center gap-3">
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
              <div className="text-3xl font-light text-gray-900 mb-2">{matchWinnerText ? `${winnerDisplayName} won the game` : `${roundWinnerText || "Round complete"}`}</div>
              <div className="text-sm text-gray-600 font-light mb-6">{matchWinnerText ? "Best of 3 complete." : "Next round starting..."}</div>

              <div className="flex gap-3 justify-center flex-wrap">
                {mode === "online" && matchWinnerText ? (
                  <div className="bg-gray-900 text-white rounded-2xl px-6 py-3">
                    Returning to lobby...
                  </div>
                ) : !matchWinnerText ? (
                  <div className="bg-gray-900 text-white rounded-2xl px-6 py-3">
  Next round starting...
</div>
                ) : mode === "ladder" ? (
                  <button onClick={onNextMatchLadder} className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition">
                    {matchWinnerText === "Team 1" ? "Next Ladder Match" : "Try Again"}
                  </button>
                ) : (
                  <button onClick={() => startModeFlow(mode)} className="bg-gray-900 text-white rounded-2xl px-6 py-3 hover:opacity-90 transition">
                    Back to Mode Menu
                  </button>
                )}

                {mode !== "online" && (
                  <button onClick={onExit} className="rounded-2xl px-6 py-3 border border-gray-200 hover:bg-gray-50 transition font-light text-gray-800">
                    Home
                  </button>
                )}
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
                    setTeam1Rounds(0);
                    setTeam2Rounds(0);
                    setGameOver(false);
                    setRoundWinnerText(null);
                    setMatchWinnerText(null);
                    keysPressed.current = {};
                    projectiles.current = [];
                    primeNewRound();
                    setMenuStep("playing");
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
