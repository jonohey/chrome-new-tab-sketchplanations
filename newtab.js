// Configuration
const API = "https://sketchplanations.com/api/extension/v1/new-tab";

// Gradient color sets for smooth transitions
const gradientColorSets = [
  { c1: "#2e2f33", c2: "#3c4a63", c3: "#6a5b76" },
  { c1: "#212282", c2: "#79329c", c3: "#773061" },
  { c1: "#4e5d94", c2: "#657fad", c3: "#9d7bbd" },
  { c1: "#1a237e", c2: "#283593", c3: "#1e3a8a" },
  { c1: "#064e3b", c2: "#166534", c3: "#155e75" },
];

// Gradient rotation interval (5 minutes in milliseconds)
const GRADIENT_ROTATION_INTERVAL_MS = 300000;

// Frequency control constants
const FREQUENCY_DAILY = "daily";
const FREQUENCY_HOURLY = "hourly";
const FREQUENCY_EACH_TAB = "each-tab";
const DEFAULT_FREQUENCY = FREQUENCY_DAILY;

// Test offline mode toggle
let isTestOfflineMode = false;

// Track if a fetch is in progress to prevent race conditions
let isFetching = false;

// Konami code sequence tracker for test mode toggle
const konamiCode = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
];
let konamiIndex = 0;

const storage = {
  async get(key, defaultValue = null) {
    // Fallback for when not running as Chrome extension
    if (typeof chrome === "undefined" || !chrome.storage) {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    }
    const obj = await chrome.storage.local.get([key]);
    return obj[key] ?? defaultValue;
  },
  async set(key, val) {
    // Fallback for when not running as Chrome extension
    if (typeof chrome === "undefined" || !chrome.storage) {
      localStorage.setItem(key, JSON.stringify(val));
      return;
    }
    await chrome.storage.local.set({ [key]: val });
  },
};

// Konami code to toggle test offline mode
// Sequence: ↑ ↑ ↓ ↓ ← → ← →
document.addEventListener("keydown", async (e) => {
  // Check if the key matches the next key in the Konami code sequence
  if (e.key === konamiCode[konamiIndex]) {
    konamiIndex++;

    // If the full sequence is complete
    if (konamiIndex === konamiCode.length) {
      e.preventDefault();
      // Reset the index
      konamiIndex = 0;

      // Read current state from storage and toggle it
      const currentState = await storage.get("testOfflineMode", false);
      isTestOfflineMode = !currentState;
      console.log(`🎮 Test offline mode: ${isTestOfflineMode ? "ON" : "OFF"}`);

      // Persist the new state before reloading
      await storage.set("testOfflineMode", isTestOfflineMode);
      window.location.reload();
    }
  } else {
    // Reset if wrong key is pressed
    konamiIndex = 0;
  }
});

// Frequency control functions
function shouldFetchNewSketch(frequency, lastFetchTime) {
  if (!lastFetchTime) return true;

  const now = new Date();
  const lastFetch = new Date(lastFetchTime);

  switch (frequency) {
    case FREQUENCY_DAILY:
      // Check if it's a new calendar day
      return (
        now.getDate() !== lastFetch.getDate() ||
        now.getMonth() !== lastFetch.getMonth() ||
        now.getFullYear() !== lastFetch.getFullYear()
      );

    case FREQUENCY_HOURLY:
      // Check if it's been an hour
      return now.getTime() - lastFetch.getTime() >= 60 * 60 * 1000;

    case FREQUENCY_EACH_TAB:
      // Always fetch new sketch
      return true;

    default:
      return true;
  }
}

async function getFrequency() {
  return await storage.get("frequency", DEFAULT_FREQUENCY);
}

async function setFrequency(frequency) {
  await storage.set("frequency", frequency);
}

async function getLastFetchTime() {
  return await storage.get("lastFetchTime", null);
}

async function setLastFetchTime(time) {
  await storage.set("lastFetchTime", time);
}

async function fetchSketchData(retryCount = 0) {
  const maxRetries = 2;
  const url = API + "?t=" + Date.now();

  // Add timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error("Failed to fetch sketch data: " + res.status);
    const data = await res.json();
    if (!data || !data.uid) {
      throw new Error("Unexpected response: " + JSON.stringify(data));
    }

    // Map the new API response to the expected format
    return {
      uid: data.uid,
      title: data.title || data.uid.replace(/-/g, " "),
      image: data.imageUrlOptimised || data.imageUrl || null,
      url: data.pageUrl || `https://sketchplanations.com/${data.uid}`,
      description: data.description || "",
      prints: data.redbubbleUrl || null,
      imageAlt: data.imageAlt || data.title || "",
      publishedAt: data.publishedAt || null,
      podcastUrl: data.podcastUrl || null,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    // Retry logic for transient failures
    if (retryCount < maxRetries) {
      const isTransientError =
        err.name === "AbortError" ||
        err.message.includes("Failed to fetch") ||
        (err.message.includes("status") && err.message.match(/50[0-9]/)); // 5xx errors

      if (isTransientError) {
        const backoffDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s
        console.log(
          `Retrying fetch after ${backoffDelay}ms (attempt ${
            retryCount + 1
          }/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        return fetchSketchData(retryCount + 1);
      }
    }

    if (err.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err;
  }
}

function prefetch(url) {
  const l = document.createElement("link");
  l.rel = "prefetch";
  l.href = url;
  document.head.appendChild(l);
}

async function nextUniqueSketch() {
  const frequency = await getFrequency();
  const lastFetchTime = await getLastFetchTime();

  // Check if we should fetch a new sketch based on frequency
  if (!shouldFetchNewSketch(frequency, lastFetchTime)) {
    // Return the last sketch if we don't need a new one
    const lastSketch = await storage.get("lastSketch", null);
    if (lastSketch) {
      return lastSketch;
    }
  }

  // Fetch new sketch
  return await fetchNewSketch();
}

async function fetchNewSketch() {
  const recent = await storage.get("recent", []);
  for (let i = 0; i < 5; i++) {
    const data = await fetchSketchData();
    if (!recent.includes(data.uid)) {
      // Update last fetch time and store the sketch
      await setLastFetchTime(new Date().toISOString());
      await storage.set("lastSketch", data);
      return data;
    }
  }
  const data = await fetchSketchData();
  await setLastFetchTime(new Date().toISOString());
  await storage.set("lastSketch", data);
  return data;
}

async function rememberSketch(uid) {
  const size = 24; // expanded no-repeat window
  const recent = await storage.get("recent", []);
  recent.unshift(uid);
  while (recent.length > size) recent.pop();
  await storage.set("recent", recent);
}

async function render(sketchData) {
  renderV2(sketchData);
}

function renderV2(sketchData) {
  const app = document.getElementById("app");
  const url = sketchData.url;

  // Create small text links for share, prints, and podcast
  const extraLinks = [];

  // Add share link with notification (wrap only the share button)
  const shareButton = `<div class="v2-share-container">
    <div id="v2CopiedNotification" class="v2-copied-notification">
      Link copied!
    </div>
    <button id="v2CopyBtn" class="small-link share-link" title="Copy a link to this sketch">Share</button>
  </div>`;

  extraLinks.push(shareButton);

  if (sketchData.prints) {
    extraLinks.push(
      `<a href="${sketchData.prints}" target="_blank" rel="noopener" class="small-link">Buy prints</a>`
    );
  }
  if (sketchData.podcastUrl) {
    extraLinks.push(
      `<a href="${sketchData.podcastUrl}" target="_blank" rel="noopener" class="small-link">Listen to podcast</a>`
    );
  }

  const extraLinksHtml =
    extraLinks.length > 0
      ? `<div class="extra-links">${extraLinks.join(" • ")}</div>`
      : "";

  app.innerHTML = `
    <h1 class="sr-only">${sketchData.title}</h1>
    <div class="v2-layout">
      <div class="v2-sketch-container">
        ${
          sketchData.image
            ? `<a href="${url}" target="_blank" rel="noopener" class="v2-image-link">
                <img class="v2-sketch-img" src="${sketchData.image}" alt="${
                sketchData.imageAlt || sketchData.title
              }" loading="lazy">
               </a>`
            : ""
        }
        ${extraLinksHtml}
      </div>
    </div>
  `;

  setupV2Interactions(sketchData, url);
}

function setupV2Interactions(sketchData, url) {
  // fade-in when image loads
  const img = document.querySelector(".v2-sketch-img");
  if (img) {
    if (img.complete) img.classList.add("is-loaded");
    else img.addEventListener("load", () => img.classList.add("is-loaded"));
  }

  const refreshBtn = document.getElementById("refreshBtn");

  const handleRefresh = async () => {
    if (isFetching) return; // Prevent concurrent fetches

    try {
      isFetching = true;
      refreshBtn.style.opacity = "0.5";
      refreshBtn.style.pointerEvents = "none";

      loading("Getting a new sketch…");
      const sketchData = await fetchNewSketch();
      await rememberSketch(sketchData.uid);
      await renderOrRedirect(sketchData);
    } catch (err) {
      showError(err);
    } finally {
      isFetching = false;
      refreshBtn.style.opacity = "";
      refreshBtn.style.pointerEvents = "";
    }
  };

  refreshBtn.onclick = handleRefresh;

  // Add keyboard support for refresh button (div element)
  refreshBtn.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      await handleRefresh();
    }
  });

  // Add copy functionality for V2
  const copyBtn = document.getElementById("v2CopyBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);

        // Show copied notification
        const notification = document.getElementById("v2CopiedNotification");
        notification.classList.add("show");

        // Hide after 2 seconds
        setTimeout(() => {
          notification.classList.remove("show");
        }, 2000);
      } catch (err) {
        console.error("Failed to copy to clipboard:", err);
        // Fallback: show error message briefly
        const notification = document.getElementById("v2CopiedNotification");
        notification.textContent = "Copy failed";
        notification.classList.add("show");
        setTimeout(() => {
          notification.classList.remove("show");
          notification.textContent = "Link copied!";
        }, 2000);
      }
    };
  }

  // Simplified keyboard shortcuts for V2 (now with copy button)
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "n" || e.key === "ArrowRight") {
      document.getElementById("refreshBtn").click();
    } else if (k === "v") {
      // Open the main sketch link
      const a = document.querySelector(".v2-image-link");
      if (a) a.click();
    } else if (k === "c") {
      // Copy link
      const copyBtn = document.getElementById("v2CopyBtn");
      if (copyBtn) copyBtn.click();
    } else if (e.key === "Escape") {
      // Close any open menus
      document.getElementById("themeMenu").classList.add("hidden");
      document.getElementById("frequencyMenu").classList.add("hidden");
      document.getElementById("bottomMenu").classList.add("hidden");

      // Reset ARIA expanded states
      const paletteBtn = document.getElementById("paletteBtn");
      const frequencyBtn = document.getElementById("frequencyBtn");
      const bottomMenuBtn = document.getElementById("bottomMenuBtn");
      if (paletteBtn) paletteBtn.setAttribute("aria-expanded", "false");
      if (frequencyBtn) frequencyBtn.setAttribute("aria-expanded", "false");
      if (bottomMenuBtn) bottomMenuBtn.setAttribute("aria-expanded", "false");
    }
  });
}

function loading() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner" role="status" aria-label="Loading sketch">
        <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
      </div>
    </div>
  `;
}

function showError(err) {
  const app = document.getElementById("app");

  // Check if in test mode and add banner if so
  const testModeBanner = isTestOfflineMode
    ? `<div class="test-mode-banner">
         Testing mode! Use Konami code to return: <kbd>↑</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>←</kbd> <kbd>→</kbd>
       </div>`
    : "";

  app.innerHTML = `
    ${testModeBanner}
    <div class="error-container">
      <div class="error-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12.409 5.824c-.702.792-1.15 1.496-1.415 2.166l2.153 2.156a.5.5 0 0 1 0 .707l-2.293 2.293a.5.5 0 0 0 0 .707L12 15"/>
          <path d="M13.508 20.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 9.591-3.677.6.6 0 0 0 .818.001A5.5 5.5 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5z"/>
        </svg>
      </div>
      <h2 class="error-title">No Internet Connection</h2>
      <p class="error-message">I couldn't load a fresh sketch right now. Check your connection and try again.</p>
      <button class="error-button" id="retry">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M23 4v6h-6"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Try Again
      </button>
      <div class="error-sketch">
        <img 
          src="images/bad-internet-is-worse-than-no-internet-sketchplanations.jpg" 
          alt="Bad internet is worse than no internet - Sketchplanations"
          class="error-sketch-img"
        />
      </div>
    </div>
  `;
  document.getElementById("retry").onclick = async () => {
    try {
      loading("Testing connection…");
      const sketchData = await fetchNewSketch();
      await rememberSketch(sketchData.uid);
      await renderOrRedirect(sketchData);
    } catch (err) {
      showError(err);
    }
  };
}

async function renderOrRedirect(sketchData) {
  render(sketchData);
  try {
    const nextSketchData = await fetchSketchData();
    prefetch(nextSketchData.url);
  } catch (err) {
    // Prefetch is non-critical, log but don't show error to user
    console.warn("Prefetch failed:", err.message);
  }
}

// ---- Theme toggle ----
async function initTheme() {
  // Use saved theme or default to system preference
  const saved = await storage.get("theme", null);
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  applyTheme(theme);
  updateThemeMenu(theme);

  // Listen for OS theme changes (only if no saved preference)
  if (!saved && window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", async (e) => {
      // Only update if user hasn't manually set a preference
      const currentSaved = await storage.get("theme", null);
      if (!currentSaved) {
        const newTheme = e.matches ? "dark" : "light";
        applyTheme(newTheme);
        updateThemeMenu(newTheme);
      }
    });
  }

  // Initialize frequency menu
  const frequency = await getFrequency();
  updateFrequencyMenu(frequency);

  // Setup palette menu for theme selection (light/dark/gradient)
  const paletteBtn = document.getElementById("paletteBtn");
  const themeMenu = document.getElementById("themeMenu");
  const themeOptions = document.querySelectorAll(".theme-option");

  // Toggle menu on palette button click
  paletteBtn.onclick = (e) => {
    e.stopPropagation();
    // Close frequency menu when opening theme menu
    const frequencyMenu = document.getElementById("frequencyMenu");
    frequencyMenu.classList.add("hidden");
    const isHidden = themeMenu.classList.toggle("hidden");
    paletteBtn.setAttribute("aria-expanded", !isHidden);
  };

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-palette")) {
      themeMenu.classList.add("hidden");
      paletteBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Handle theme option clicks
  themeOptions.forEach((option) => {
    option.onclick = async (e) => {
      e.preventDefault();
      const selectedTheme = option.dataset.theme;
      applyTheme(selectedTheme);
      await storage.set("theme", selectedTheme);
      updateThemeMenu(selectedTheme);
      themeMenu.classList.add("hidden");
      paletteBtn.setAttribute("aria-expanded", "false");
    };
  });

  // Setup frequency menu
  const frequencyBtn = document.getElementById("frequencyBtn");
  const frequencyMenu = document.getElementById("frequencyMenu");
  const frequencyOptions = document.querySelectorAll(".frequency-option");

  // Toggle frequency menu on button click
  frequencyBtn.onclick = (e) => {
    e.stopPropagation();
    // Close theme menu when opening frequency menu
    const themeMenu = document.getElementById("themeMenu");
    themeMenu.classList.add("hidden");
    const isHidden = frequencyMenu.classList.toggle("hidden");
    frequencyBtn.setAttribute("aria-expanded", !isHidden);
  };

  // Close frequency menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".frequency-palette")) {
      frequencyMenu.classList.add("hidden");
      frequencyBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Setup bottom menu
  const bottomMenuBtn = document.getElementById("bottomMenuBtn");
  const bottomMenu = document.getElementById("bottomMenu");

  // Toggle bottom menu on button click
  bottomMenuBtn.onclick = (e) => {
    e.stopPropagation();
    // Close other menus when opening bottom menu
    const themeMenu = document.getElementById("themeMenu");
    themeMenu.classList.add("hidden");
    frequencyMenu.classList.add("hidden");
    const isHidden = bottomMenu.classList.toggle("hidden");
    bottomMenuBtn.setAttribute("aria-expanded", !isHidden);
  };

  // Close bottom menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".bottom-menu")) {
      bottomMenu.classList.add("hidden");
      bottomMenuBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Handle frequency option clicks
  frequencyOptions.forEach((option) => {
    option.onclick = async (e) => {
      e.preventDefault();
      const selectedFrequency = option.dataset.frequency;
      await setFrequency(selectedFrequency);
      updateFrequencyMenu(selectedFrequency);
      frequencyMenu.classList.add("hidden");
      frequencyBtn.setAttribute("aria-expanded", "false");
    };
  });
}

function updateThemeMenu(activeTheme) {
  const themeOptions = document.querySelectorAll(".theme-option");
  themeOptions.forEach((option) => {
    option.classList.remove("active");
    if (option.dataset.theme === activeTheme) {
      option.classList.add("active");
    }
  });
}

function updateFrequencyMenu(activeFrequency) {
  const frequencyOptions = document.querySelectorAll(".frequency-option");
  frequencyOptions.forEach((option) => {
    option.classList.remove("active");
    if (option.dataset.frequency === activeFrequency) {
      option.classList.add("active");
    }
  });
}

function applyTheme(mode) {
  document.body.classList.remove("theme-dark");
  document.body.classList.remove("theme-gradient");

  if (mode === "dark") {
    document.body.classList.add("theme-dark");
  } else if (mode === "gradient") {
    document.body.classList.add("theme-gradient");
    startGradientRotation();
  }

  // Update logo based on theme
  const logoImg = document.getElementById("logoImg");
  if (logoImg) {
    if (mode === "dark" || mode === "gradient") {
      logoImg.src = "images/sketchplanations-logo-white-transparent.png";
    } else {
      logoImg.src = "images/sketchplanations-logo-black-transparent.png";
    }
  }
}

function startGradientRotation() {
  // Only start rotation if we're in gradient mode
  if (!document.body.classList.contains("theme-gradient")) return;

  // Calculate current gradient index based on time of day
  function getCurrentGradientIndex() {
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0
    );
    const elapsed = now - midnight; // milliseconds since midnight
    return (
      Math.floor(elapsed / GRADIENT_ROTATION_INTERVAL_MS) %
      gradientColorSets.length
    );
  }

  // Apply gradient colors for a given index
  function applyGradient(index, skipTransition = false) {
    const colors = gradientColorSets[index];
    const transitionDurationSeconds = GRADIENT_ROTATION_INTERVAL_MS / 1000;

    if (skipTransition) {
      // Temporarily disable transition for instant gradient change
      document.body.style.transition = "none";

      document.body.style.setProperty("--gradient-color-1", colors.c1);
      document.body.style.setProperty("--gradient-color-2", colors.c2);
      document.body.style.setProperty("--gradient-color-3", colors.c3);

      // Re-enable transition after the paint
      requestAnimationFrame(() => {
        document.body.style.transition = `--gradient-color-1 ${transitionDurationSeconds}s ease-in-out, --gradient-color-2 ${transitionDurationSeconds}s ease-in-out, --gradient-color-3 ${transitionDurationSeconds}s ease-in-out`;
      });
    } else {
      // Set transition duration to match rotation interval
      document.body.style.transition = `--gradient-color-1 ${transitionDurationSeconds}s ease-in-out, --gradient-color-2 ${transitionDurationSeconds}s ease-in-out, --gradient-color-3 ${transitionDurationSeconds}s ease-in-out`;

      document.body.style.setProperty("--gradient-color-1", colors.c1);
      document.body.style.setProperty("--gradient-color-2", colors.c2);
      document.body.style.setProperty("--gradient-color-3", colors.c3);
    }
  }

  // Schedule next gradient transition
  function scheduleNextTransition() {
    if (!document.body.classList.contains("theme-gradient")) return;

    // Calculate time until next gradient boundary
    const now = new Date();
    const elapsed =
      now - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const msUntilNext =
      GRADIENT_ROTATION_INTERVAL_MS - (elapsed % GRADIENT_ROTATION_INTERVAL_MS);

    setTimeout(() => {
      // Recalculate index from midnight (prevents drift)
      const currentIndex = getCurrentGradientIndex();
      applyGradient(currentIndex);

      // Schedule the next transition
      scheduleNextTransition();
    }, msUntilNext);
  }

  // Set initial gradient based on current time (skip transition for instant application)
  const initialIndex = getCurrentGradientIndex();
  applyGradient(initialIndex, true);

  // Schedule first transition
  scheduleNextTransition();
}

async function init() {
  await initTheme();

  // Check if test offline mode is enabled (read from storage)
  isTestOfflineMode = await storage.get("testOfflineMode", false);
  if (isTestOfflineMode) {
    showError(new Error("Testing offline mode"));
    return;
  }

  try {
    loading("Loading a fresh Sketchplanation…");
    const sketchData = await nextUniqueSketch();
    await rememberSketch(sketchData.uid);
    await renderOrRedirect(sketchData);
  } catch (err) {
    showError(err);
  }
}

init();
