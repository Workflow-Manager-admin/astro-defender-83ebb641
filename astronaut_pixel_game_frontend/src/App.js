import React, { useRef, useEffect, useState } from "react";
import "./App.css";

/**
 * Constants - some adjusted to ensure longer initial gameplay session and an easier opening difficulty:
 */
const GAME_WIDTH = 480;
const GAME_HEIGHT = 320;
const PLAYER_SIZE = 24;
const PLAYER_COLOR = "#bedfdf";
const ALIEN_COLOR = "#132efb";
const ASTEROID_COLOR = "#7B5F27";
const LASER_COLOR = "#ff2020";
const STRUCTURE_BAR_COLOR = "#e87a41";
const ZONE_COLOR = "#25334F88";
const STRUCTURE_BAR_BG = "#162124";
const STRUCTURE_BAR_HEIGHT = 12;
const PLAYER_SPEED = 3;
const GRAVITY = 0.22;
const LASER_SPEED = 9;
const ITEM_SIZE = 20;
const FPS = 60;

/**
 * Sound effect hook that plays a sound only after a user gesture
 * enforced by the browser's media playback policies.
 *
 * Usage: 
 *   const playSfx = useSound(url);
 *   ...on user gesture: playSfx();
 */
function useSound(url, volume = 0.23) {
  const soundRef = useRef();
  // Track if unlocking has occurred after user input
  const unlockedRef = useRef(false);

  // Attach Audio element
  useEffect(() => {
    if (url) {
      soundRef.current = new Audio(url);
      soundRef.current.volume = volume;
      soundRef.current.preload = "auto";
    }
    return () => {
      if (soundRef.current) soundRef.current.pause();
    };
  }, [url, volume]);

  // Function to unlock audio on user gesture
  const unlockAudio = () => {
    if (!soundRef.current) return;
    // Play and immediately pause to enable programmatic play later
    const promise = soundRef.current.play();
    if (promise !== undefined) {
      promise
        .then(() => {
          soundRef.current.pause();
          soundRef.current.currentTime = 0;
          unlockedRef.current = true;
        })
        .catch(() => {
          // Some browsers may still block, but will succeed on next real gesture
          unlockedRef.current = false;
        });
    } else {
      unlockedRef.current = true; // Edge case
    }
  };

  // Return function for use in event handler
  return () => {
    if (!soundRef.current) return;
    if (!unlockedRef.current) {
      // First real trigger attempt: unlock (should be called from user gesture)
      unlockAudio();
    } else {
      soundRef.current.currentTime = 0;
      soundRef.current.play().catch(() => {}); // ignore play error
    }
  };
}

// Utility
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// Entity Sprite Renderers (pure pixel shapes)
function drawPlayer(ctx, x, y, left) {
  // Head
  ctx.fillStyle = PLAYER_COLOR;
  ctx.fillRect(x, y, PLAYER_SIZE, PLAYER_SIZE);
  // Helmet shine
  ctx.fillStyle = "#fff";
  ctx.globalAlpha = 0.4;
  ctx.fillRect(x + 3, y + 3, 6, 7);
  ctx.globalAlpha = 1;
  // Visor
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 5, y + 8, 14, 6);
  // Body
  ctx.fillStyle = "#cccfea";
  ctx.fillRect(x + 7, y + 16, 10, 7);
  // Backpack
  ctx.fillStyle = "#6ea1ab";
  ctx.fillRect(x + (left ? 0 : PLAYER_SIZE-5), y + 8, 5, 11);
}

function drawAlien(ctx, x, y, type = 0) {
  ctx.save();
  ctx.fillStyle = ALIEN_COLOR;
  ctx.fillRect(x, y, PLAYER_SIZE, PLAYER_SIZE);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + 4, y + 5, 5, 3);
  ctx.fillRect(x + 15, y + 5, 5, 3); // eyes
  ctx.restore();
}

function drawAsteroid(ctx, x, y, r) {
  // Renders a retro pixel-style square asteroid
  ctx.save();
  ctx.fillStyle = ASTEROID_COLOR;
  // Draw a solid square, ignore the circle/arc
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(r * 2), Math.round(r * 2));
  // Optional: subtle lighter outline for pixel art effect
  ctx.strokeStyle = "#b79c62";
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(x), Math.round(y), Math.round(r * 2), Math.round(r * 2));
  ctx.restore();
}

function drawLaser(ctx, x, y, dir) {
  ctx.save();
  ctx.strokeStyle = LASER_COLOR;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + (dir === "right" ? 15 : -15), y);
  ctx.stroke();
  ctx.restore();
}

function drawZone(ctx, x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = ZONE_COLOR;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawStructureBar(ctx, integrity) {
  // BG
  ctx.save();
  ctx.fillStyle = STRUCTURE_BAR_BG;
  ctx.fillRect(12, 6, GAME_WIDTH - 24, STRUCTURE_BAR_HEIGHT);
  // Bar
  ctx.fillStyle = STRUCTURE_BAR_COLOR;
  ctx.fillRect(12, 6, (GAME_WIDTH - 24) * (integrity / 100), STRUCTURE_BAR_HEIGHT);
  // Outline
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 6, GAME_WIDTH - 24, STRUCTURE_BAR_HEIGHT);
  ctx.restore();
}

function useWindowScale(width, height) {
  // Returns canvas scaling factor for responsive layout
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function handleResize() {
      const maxW = window.innerWidth, maxH = window.innerHeight;
      setScale(Math.min(maxW / width, maxH / height, 1));
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [width, height]);
  return scale;
}

// Random helpers
function randomPosY() {
  return Math.random() * (GAME_HEIGHT - 50) + 30;
}
function randomVel() { 
  // Reduce speed range for slower movement (e.g. 0.7 to 1.1)
  return Math.random() * 0.4 + 0.7; 
}
function randomAsteroidSize() { return Math.random() * 15 + 13; }

// Task System
const TASKS = [
  { objective: "Download Ship Logs", time: 5 },
  { objective: "Refuel Oxygen", time: 6 },
  { objective: "Calibrate Lasers", time: 4 },
  { objective: "Scan for Signals", time: 5 },
];

/*
 * Main Game Component with Level Progression Mechanic (10 levels)
 * Level 1: Only slow, infrequent asteroids. No aliens.
 * Level 2+: Asteroids are faster/more frequent; aliens appear/increase with each level.
 * Level up occurs as player survives (every N seconds or score/criteria).
 * Displays current level to player in HUD.
 */
// PUBLIC_INTERFACE
function AstronautPixelGame() {
  const canvasRef = useRef();
  const requestRef = useRef();
  // --- Game State ---
  const [running, setRunning] = useState(true);
  const [paused, setPaused] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  // --- Level System State ---
  // Tracks level 1 through 10. Level increases every certain time interval or score/objective.
  const [level, setLevel] = useState(1);
  const [levelMsg, setLevelMsg] = useState(""); // flash level-up message

  // Main stats
  const [stats, setStats] = useState({
    integrity: 135,
    score: 0,
    tasksComplete: 0,
    playerHealth: 9,
    time: 0, // Frame counter
  });

  const [showZone, setShowZone] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [task, setTask] = useState(null);
  const [taskTimer, setTaskTimer] = useState(0);

  // Controls state
  const controlState = useRef({
    left: false,
    right: false,
    up: false,
    down: false,
    space: false,
    shoot: false,
  });

  // === NEW: require user gesture to unlock audio ===
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const fireSound = useSound("https://cdn.pixabay.com/audio/2022/10/16/audio_125b8360e3.mp3");
  const hitSound = useSound("https://cdn.pixabay.com/audio/2022/07/26/audio_124b478539.mp3");
  const taskSound = useSound("https://cdn.pixabay.com/audio/2022/07/26/audio_124b478539.mp3", 0.13);

  const unlockUserAudio = () => {
    fireSound();
    hitSound();
    taskSound();
    setAudioUnlocked(true);
  };

  // Entities
  const playerRef = useRef({
    x: 64, y: 180,
    vx: 0, vy: 0,
    dir: "right",
    cooldown: 0,
    health: 5,
  });
  const aliensRef = useRef([]);
  const asteroidsRef = useRef([]);
  const lasersRef = useRef([]);
  const zoneRef = useRef({
    x: 130, y: 44, w: 110, h: 140,
    lastShown: 0,
    cooldown: 0,
  });

  // --- Reset Game (also level back to 1) ---
  const resetGame = () => {
    setRunning(true);
    setGameOver(false);
    setStats({
      integrity: 100,
      score: 0,
      tasksComplete: 0,
      playerHealth: 5,
      time: 0,
    });
    setLevel(1);
    setLevelMsg("");
    playerRef.current = { x: 64, y: 180, vx: 0, vy: 0, dir: "right", cooldown: 0, health: 5 };
    aliensRef.current = [];
    asteroidsRef.current = [];
    lasersRef.current = [];
    setShowTask(false);
    setTask(null);
    setTaskTimer(0);
  };

  // --- Control handlers ---
  useEffect(() => {
    function handleKeyDown(e) {
      if (["ArrowLeft", "a"].includes(e.key)) controlState.current.left = true;
      if (["ArrowRight", "d"].includes(e.key)) controlState.current.right = true;
      if (["ArrowUp", "w"].includes(e.key)) controlState.current.up = true;
      if (["ArrowDown", "s"].includes(e.key)) controlState.current.down = true;
      if (e.code === "Space") controlState.current.space = true;
      if (e.key === "p") setPaused((v) => !v);
    }
    function handleKeyUp(e) {
      if (["ArrowLeft", "a"].includes(e.key)) controlState.current.left = false;
      if (["ArrowRight", "d"].includes(e.key)) controlState.current.right = false;
      if (["ArrowUp", "w"].includes(e.key)) controlState.current.up = false;
      if (["ArrowDown", "s"].includes(e.key)) controlState.current.down = false;
      if (e.code === "Space") controlState.current.space = false;
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // --- Mobile touch controls ---
  function mobileControlPress(dir) {
    controlState.current[dir] = true;
    setTimeout(() => { controlState.current[dir] = false; }, 120);
  }
  function fireLaser() {
    controlState.current.shoot = true;
    setTimeout(() => { controlState.current.shoot = false; }, 100);
  }

  // --- Level progression logic ---
  // Levels are time-based. Every LEVEL_DURATION_SECS, level up, up to max (10)
  const LEVEL_DURATION_SECS = 30; // 30 seconds per level
  const MAX_LEVEL = 10;
  useEffect(() => {
    // Check for level up (every LEVEL_DURATION_SECS)
    const seconds = Math.floor(stats.time / FPS);
    const calcLevel = Math.min(1 + Math.floor(seconds / LEVEL_DURATION_SECS), MAX_LEVEL);
    if (calcLevel > level) {
      setLevel(calcLevel);
      setLevelMsg(`LEVEL ${calcLevel}`);
      setTimeout(() => setLevelMsg(""), 1500);
    }
    // eslint-disable-next-line
  }, [stats.time, level]);

  // --- Main Game Loop (modified for 10-level logic) ---
  useEffect(() => {
    let lastAlien = 0, lastAsteroid = 0;
    function loop() {
      if (!running || paused) return;
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // Calculate current "seconds" and level
      const seconds = Math.floor(stats.time / FPS);

      // --- LEVEL SETTINGS ---
      // Tune parameters based on current level (1 to 10):
      // level 1: slow, rare asteroids; no aliens
      // level 2-10: increasing freq, speed, more/stronger aliens
      const levelSettings = [
        // lvl:      asteroidCooldown,     asteroidSpeed, alienCooldown, alienCount/min
        null, // 0 unused
        { asteroidCooldown: 120, asteroidMinV: 0.5, asteroidMaxV: 0.85, asteroidSize: [16, 22], aliensAllowed: false, alienCooldown: Infinity }, // Level 1
        { asteroidCooldown: 90,  asteroidMinV: 0.75, asteroidMaxV: 1.1, asteroidSize: [15, 23], aliensAllowed: true, alienCooldown: 180 }, // 1 alien/min
        { asteroidCooldown: 70,  asteroidMinV: 0.95, asteroidMaxV: 1.28, asteroidSize: [15, 23], aliensAllowed: true, alienCooldown: 140 }, // 1.3/min
        { asteroidCooldown: 60,  asteroidMinV: 1.1, asteroidMaxV: 1.35, asteroidSize: [14, 24], aliensAllowed: true, alienCooldown: 120 }, // 1.5/min
        { asteroidCooldown: 50,  asteroidMinV: 1.22, asteroidMaxV: 1.46, asteroidSize: [13, 24], aliensAllowed: true, alienCooldown: 95 },
        { asteroidCooldown: 42,  asteroidMinV: 1.28, asteroidMaxV: 1.55, asteroidSize: [13, 23], aliensAllowed: true, alienCooldown: 76 },
        { asteroidCooldown: 37,  asteroidMinV: 1.36, asteroidMaxV: 1.68, asteroidSize: [13, 22], aliensAllowed: true, alienCooldown: 63 },
        { asteroidCooldown: 31,  asteroidMinV: 1.47, asteroidMaxV: 1.81, asteroidSize: [13, 21], aliensAllowed: true, alienCooldown: 53 },
        { asteroidCooldown: 26,  asteroidMinV: 1.56, asteroidMaxV: 2.03, asteroidSize: [12, 20], aliensAllowed: true, alienCooldown: 47 },
        { asteroidCooldown: 22,  asteroidMinV: 1.65, asteroidMaxV: 2.22, asteroidSize: [12, 19], aliensAllowed: true, alienCooldown: 41 }, // Level 10
      ];
      const ls = levelSettings[level];

      // Draw structure bar
      drawStructureBar(ctx, stats.integrity);

      // Draw 'safe zone' for tasks
      if (showZone) {
        drawZone(ctx, zoneRef.current.x, zoneRef.current.y, zoneRef.current.w, zoneRef.current.h);
      }

      // Aliens
      aliensRef.current.forEach((alien) => {
        drawAlien(ctx, alien.x, alien.y, 0);
      });

      // Asteroids
      asteroidsRef.current.forEach((asteroid) => {
        drawAsteroid(ctx, asteroid.x, asteroid.y, asteroid.r);
      });

      // Lasers
      lasersRef.current.forEach((laser) => {
        drawLaser(ctx, laser.x, laser.y, laser.dir);
      });

      // Player
      drawPlayer(ctx, playerRef.current.x, playerRef.current.y, playerRef.current.dir === "left");

      // ============= GAME LOGIC ================
      // --- Player movement ---
      let px = playerRef.current.x, py = playerRef.current.y, vx = playerRef.current.vx, vy = playerRef.current.vy;
      if (controlState.current.left) { vx = -PLAYER_SPEED; playerRef.current.dir = "left"; }
      else if (controlState.current.right) { vx = PLAYER_SPEED; playerRef.current.dir = "right"; }
      else { vx = 0; }
      if (controlState.current.up) vy = -PLAYER_SPEED;
      vy += GRAVITY;
      if (vy > PLAYER_SPEED * 1.15) vy = PLAYER_SPEED * 1.15;

      px += vx; py += vy;

      px = clamp(px, 0, GAME_WIDTH - PLAYER_SIZE);
      py = clamp(py, 18, GAME_HEIGHT - PLAYER_SIZE);

      playerRef.current.x = px;
      playerRef.current.y = py;
      playerRef.current.vx = vx;
      playerRef.current.vy = vy;

      // --- Lasers ---
      if (playerRef.current.cooldown > 0) playerRef.current.cooldown--;
      if ((controlState.current.space || controlState.current.shoot) && playerRef.current.cooldown <= 0) {
        lasersRef.current.push({
          x: playerRef.current.x + PLAYER_SIZE / 2,
          y: playerRef.current.y + 8,
          dir: playerRef.current.dir,
          life: 40,
        });
        fireSound();
        playerRef.current.cooldown = 17;
      }
      lasersRef.current.forEach((l) => {
        l.x += l.dir === "right" ? LASER_SPEED : -LASER_SPEED;
        l.life--;
      });
      lasersRef.current = lasersRef.current.filter((l) => l.x > 0 && l.x < GAME_WIDTH && l.life > 0);

      // --- Asteroid Spawning + Behavior (depends on LEVEL) ---
      if (stats.time - lastAsteroid > ls.asteroidCooldown) {
        // Asteroids are always coming from the right
        const randRv = Math.random() * (ls.asteroidMaxV - ls.asteroidMinV) + ls.asteroidMinV;
        const randVy = (Math.random() - 0.5) * 0.93; // small vertical drift
        const size = Math.random() * (ls.asteroidSize[1] - ls.asteroidSize[0]) + ls.asteroidSize[0];
        asteroidsRef.current.push({
          x: GAME_WIDTH + 20,
          y: randomPosY(),
          r: size,
          vy: randVy,
          vx: -randRv,
          damage: 10 + level * 2,
          life: 110 + Math.floor(level * 10),
        });
        lastAsteroid = stats.time;
      }

      // --- Alien Spawning (Level 2+) ---
      if (ls.aliensAllowed && stats.time - lastAlien > ls.alienCooldown) {
        // Increase number of spawned aliens in high levels
        const alienCountPerSpawn = Math.max(1, Math.floor(level / 4));
        let alienHP = Math.min(1 + Math.floor(level / 3), 4);
        for (let i = 0; i < alienCountPerSpawn; ++i) {
          aliensRef.current.push({
            x: Math.random() > 0.5 ? -PLAYER_SIZE : GAME_WIDTH,
            y: randomPosY(),
            dir: Math.random() > 0.5 ? "right" : "left",
            alive: true,
            hp: alienHP,
          });
        }
        lastAlien = stats.time;
      }

      // --- Move Aliens, Asteroids ---
      aliensRef.current.forEach((alien) => {
        // Alien speed increases by level
        const alienV = 1.2 + level * 0.18;
        if (alien.dir === "right") alien.x += alienV;
        else alien.x -= alienV;
      });

      asteroidsRef.current.forEach((a) => {
        a.x += a.vx;
        a.y += a.vy;
        a.life--;
      });

      // --- Remove offscreen/dead objects ---
      aliensRef.current = aliensRef.current.filter(
        (alien) => alien.x > -PLAYER_SIZE && alien.x < GAME_WIDTH + PLAYER_SIZE && alien.alive
      );
      asteroidsRef.current = asteroidsRef.current.filter(
        (a) => a.x > -40 && a.x < GAME_WIDTH + 30 && a.y > -40 && a.y < GAME_HEIGHT + 40 && a.life > 0
      );

      // --- Collisions ---
      // Lasers -> aliens
      lasersRef.current.forEach((laser) => {
        aliensRef.current.forEach((alien) => {
          if (
            alien.x < laser.x &&
            laser.x < alien.x + PLAYER_SIZE &&
            alien.y < laser.y &&
            laser.y < alien.y + PLAYER_SIZE
          ) {
            alien.hp--;
            laser.x = -99;
            hitSound();
            if (alien.hp <= 0) {
              alien.alive = false;
              setStats((prev) => ({
                ...prev,
                score: prev.score + 50 + level * 8,
              }));
            }
          }
        });
      });
      // Lasers -> asteroids
      lasersRef.current.forEach((laser) => {
        asteroidsRef.current.forEach((asteroid) => {
          const dx = (asteroid.x + asteroid.r) - laser.x, dy = (asteroid.y + asteroid.r) - laser.y;
          if (Math.sqrt(dx * dx + dy * dy) < asteroid.r + 4) {
            asteroid.r -= 7;
            asteroid.vx *= 0.8;
            hitSound();
            laser.x = -99;
            if (asteroid.r < 11) asteroid.life = 0;
          }
        });
      });
      // Aliens -> player
      aliensRef.current.forEach((alien) => {
        if (
          Math.abs(alien.x - playerRef.current.x) < PLAYER_SIZE - 6 &&
          Math.abs(alien.y - playerRef.current.y) < PLAYER_SIZE - 8
        ) {
          // Slightly increase damage with level
          let pDmg = 0.5 + (level * 0.15);
          let structDmg = 0.5 + (level * 0.18);
          setStats((prev) => ({
            ...prev,
            playerHealth: Math.max(prev.playerHealth - pDmg, 0),
            integrity: Math.max(prev.integrity - 6 * structDmg, 0),
          }));
          alien.x = -99;
          hitSound();
        }
      });
      // Asteroids -> player
      asteroidsRef.current.forEach((a) => {
        const dx = (a.x + a.r) - (playerRef.current.x + PLAYER_SIZE / 2), dy = (a.y + a.r) - (playerRef.current.y + PLAYER_SIZE / 2);
        if (Math.abs(dx) < a.r + PLAYER_SIZE / 2 - 2 && Math.abs(dy) < a.r + PLAYER_SIZE / 2 - 2) {
          let pDmg = 1 + Math.floor(level / 3);
          let structDmg = a.damage * (0.56 + 0.05 * (level - 1));
          setStats((prev) => ({
            ...prev,
            playerHealth: Math.max(prev.playerHealth - pDmg, 0),
            integrity: Math.max(prev.integrity - structDmg, 0),
          }));
          a.life = 0;
          hitSound();
        }
      });
      // Asteroid -> structure (bottom edge)
      asteroidsRef.current.forEach((a) => {
        if (a.y + a.r > GAME_HEIGHT - 6) {
          let structDmg = a.damage * (0.53 + 0.04 * (level - 1));
          setStats((prev) => ({
            ...prev,
            integrity: Math.max(prev.integrity - structDmg, 0),
          }));
          a.life = 0;
          hitSound();
        }
      });

      // --- Game over ---
      if (stats.integrity <= 0 || stats.playerHealth <= 0) {
        setGameOver(true);
        setRunning(false);
      }

      // ==================== TASK ZONE ===================
      // Frequency unchanged for demo; zone cooldown shrinks a little with level
      const zoneBase = 420 - (level - 1) * 22;
      zoneRef.current.cooldown = Math.max(180, zoneBase);
      if ((stats.time % (zoneRef.current.cooldown) < 2) && !showZone && !showTask) {
        setShowZone(true);
        zoneRef.current.lastShown = stats.time;
      }
      if (showZone) {
        if (
          playerRef.current.x > zoneRef.current.x &&
          playerRef.current.x < zoneRef.current.x + zoneRef.current.w &&
          playerRef.current.y > zoneRef.current.y &&
          playerRef.current.y < zoneRef.current.y + zoneRef.current.h
        ) {
          setShowZone(false);
          setTask(TASKS[Math.floor(Math.random() * TASKS.length)]);
          setTaskTimer(0);
          setShowTask(true);
          taskSound();
        }
        if (stats.time - zoneRef.current.lastShown > 140) {
          setShowZone(false);
        }
      }
      // --- Task Logic ---
      if (showTask && task) {
        setTaskTimer((t) => t + 1);
        if (
          !(
            playerRef.current.x > zoneRef.current.x &&
            playerRef.current.x < zoneRef.current.x + zoneRef.current.w &&
            playerRef.current.y > zoneRef.current.y &&
            playerRef.current.y < zoneRef.current.y + zoneRef.current.h
          )
        ) {
          setShowTask(false);
          setTask(null);
          setTaskTimer(0);
        }
        if (taskTimer / FPS > task.time) {
          setStats((prev) => ({
            ...prev,
            integrity: clamp(prev.integrity + 14 + level, 0, 100),
            tasksComplete: prev.tasksComplete + 1,
            score: prev.score + 60 + level * 6,
          }));
          setShowTask(false);
          setTask(null);
          setTaskTimer(0);
          taskSound();
        }
      }

      // --- Game timer ---
      setStats((prev) => ({
        ...prev,
        time: prev.time + 1,
      }));

      // Next frame
      requestRef.current = requestAnimationFrame(loop);
    }
    if (running && !paused && !gameOver) {
      requestRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(requestRef.current);
    // eslint-disable-next-line
  }, [running, paused, gameOver, showZone, showTask, task, taskTimer, stats.time, level]);

  // --- Responsive scaling ---
  const scale = useWindowScale(GAME_WIDTH, GAME_HEIGHT);

  // --- Pixel font ---
  useEffect(() => {
    const font = document.createElement("style");
    font.innerHTML =
      "@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap'); html, body, .pixel { font-family:'Press Start 2P', monospace; }";
    document.head.appendChild(font);
    return () => document.head.removeChild(font);
  }, []);

  // --- UI Overlay ---
  function renderOverlay() {
    if (!audioUnlocked) {
      return (
        <div
          className="ui-overlay"
          style={{
            width: GAME_WIDTH * scale,
            height: GAME_HEIGHT * scale,
            zIndex: 50,
            position: "absolute",
            left: 0,
            top: 0,
            background: "rgba(16,18,24,0.96)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{textAlign: "center" }}>
            <h2 className="pixel" style={{ color: "#61dafb", margin: 18 }}>Astronaut Pixel Defender</h2>
            <div className="pixel" style={{ margin: "17px 0 24px 0", color: "#b1cece" }}>Tap/click <b>Start Game</b> to enable sound & play!</div>
            <button
              style={{
                fontSize: "1.19rem",
                fontFamily: "inherit",
                padding: "13px 34px",
                background: "#25334F",
                border: "2px solid #132efb",
                color: "#fff",
                borderRadius: "13px",
                cursor: "pointer",
                boxShadow: "0 1px 14px #25334faa",
                letterSpacing: "1px"
              }}
              className="pixel-btn"
              onClick={unlockUserAudio}
              onTouchStart={unlockUserAudio}
              autoFocus
            >
              Start Game / Enable Sound
            </button>
            <p style={{ color: "#cbcbfc", fontSize: "0.97rem", marginTop: 23 }}>
              <b>Why?</b> <span style={{ color: "#bedfdf" }}>Browsers require a first user gesture (e.g., click, tap) before allowing audio playback.</span>
            </p>
          </div>
        </div>
      );
    }

    // --- HUD with LEVEL display ---
    return (
      <div className="ui-overlay" style={{ width: GAME_WIDTH * scale }}>
        <div className="hud" style={{ left: 14 * scale }}>
          <span>🛰️ SCORE <b>{stats.score}</b></span>
          <span style={{ marginLeft: 8 * scale }}>
            🛡️ STRUCTURE <b>{stats.integrity}%</b>
          </span>
          <span style={{
            marginLeft: 12 * scale,
            color: "#ffd973",
            fontWeight: "bold",
            fontSize: "1.08rem"
          }}>
            LEVEL <b>{level}</b>
          </span>
        </div>
        <div className="hud-right" style={{ right: 14 * scale }}>
          <span>
            💀 HEALTH <b>{stats.playerHealth}</b>
          </span>
          <span style={{ marginLeft: 8 * scale }}>
            ✅ TASKS <b>{stats.tasksComplete}</b>
          </span>
        </div>
        {/* Show flashing level-up message */}
        {levelMsg && (
          <div
            className="overlay-msg pixel"
            style={{
              top: 70,
              left: 35,
              right: 35,
              background: "rgba(36,26,93,0.95)",
              color: "#ffebac",
              fontSize: "1.4rem",
              border: "2.7px solid #ffd973",
              textShadow: "1px 2px #1a182aaf"
            }}
          >
            <b>{levelMsg}</b>
          </div>
        )}
        <div className="bottom-controls" style={{ width: GAME_WIDTH * scale }}>
          <div className="mobile-btns">
            <button className="pixel-btn" aria-label="Move Left" onTouchStart={() => mobileControlPress("left")}>
              ◀️
            </button>
            <button className="pixel-btn" aria-label="Move Right" onTouchStart={() => mobileControlPress("right")}>
              ▶️
            </button>
            <button className="pixel-btn" aria-label="Move Up" onTouchStart={() => mobileControlPress("up")}>
              ⏫
            </button>
            <button className="pixel-btn pixel-fire" onTouchStart={fireLaser} aria-label="Fire Laser">
              🔫
            </button>
          </div>
        </div>
        {showTask && (
          <div className="task-zone-msg pixel" style={{ width: (GAME_WIDTH - 32) * scale }}>
            <b>📝 Task:</b> <span>{task?.objective}</span>
            <div className="progressbar">
              <div style={{
                background: "#61dafb",
                width: `${(taskTimer / (task?.time * FPS || 1)) * 100}%`,
              }}/>
            </div>
          </div>
        )}
        {gameOver && (
          <div className="overlay-msg pixel">
            <div>
              <h2>Game Over</h2>
              <div>Score: <b>{stats.score}</b></div>
              <div>Tasks completed: <b>{stats.tasksComplete}</b></div>
              <div>Achieved Level: <b>{level}</b></div>
              <button className="pixel-btn" onClick={resetGame}>Restart</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="game-container"
      style={{
        width: GAME_WIDTH * scale,
        height: GAME_HEIGHT * scale,
        maxWidth: "100vw",
        maxHeight: "98vh",
      }}
    >
      <canvas
        ref={canvasRef}
        width={GAME_WIDTH}
        height={GAME_HEIGHT}
        style={{
          width: GAME_WIDTH * scale,
          height: GAME_HEIGHT * scale,
          imageRendering: "pixelated",
          borderRadius: "10px",
          background: "#25334F",
          boxShadow: "0 0 64px 0 #162124c9, 0 1px 8px #090b11",
          margin: "0 auto",
          display: "block",
        }}
      />
      {renderOverlay()}
    </div>
  );
}

// PUBLIC_INTERFACE
function App() {
  return (
    <div className="App pixel" style={{ background: "#162124", minHeight: "100vh" }}>
      <header>
        <h1 className="title-pixel">🚀 Astronaut Pixel Defender</h1>
        <span className="subtitle">A pixel-style 2D side-scroller. Survive, defend, complete tasks!</span>
      </header>
      <AstronautPixelGame />
      <footer style={{ margin: "16px 0", color: "#b1cece", fontSize: 14 }}>
        <span>
          Touch controls available • Move: ◀️ ▶️ ⏫ | Fire: 🔫 | Desktop: Arrow/AWSD + Space • Pause: P
        </span>
      </footer>
    </div>
  );
}

export default App;
