// Configuration - uncomment the line you want to use
const API = "https://sketchplanations.com/api/extension/new-tab";
//const API = "http://localhost:3000/api/extension/new-tab";

// Version control constants
const VERSION_V1 = "v1";
const VERSION_V2 = "v2";
const DEFAULT_VERSION = VERSION_V1;

// Frequency control constants
const FREQUENCY_DAILY = "daily";
const FREQUENCY_HOURLY = "hourly";
const FREQUENCY_EACH_TAB = "each-tab";
const DEFAULT_FREQUENCY = FREQUENCY_DAILY;

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

// Version control functions
async function getVersion() {
  return await storage.get("version", DEFAULT_VERSION);
}

async function setVersion(version) {
  await storage.set("version", version);
}

async function fetchSketchData() {
  const url = API + "?t=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
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

function firstSentence(str) {
  if (!str) return "";
  const s = str.trim();
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  if (m) return m[1];
  return s;
}

async function render(sketchData) {
  const version = await getVersion();

  // Add body class for V2 styling
  if (version === VERSION_V2) {
    document.body.classList.add("v2-active");
    document.body.classList.remove("v1-active");
    renderV2(sketchData);
  } else {
    document.body.classList.add("v1-active");
    document.body.classList.remove("v2-active");
    renderV1(sketchData);
  }
}

function renderV1(sketchData) {
  const app = document.getElementById("app");
  const url = sketchData.url;
  const desc = firstSentence(sketchData.description || "");
  const printsBtn = sketchData.prints
    ? `<a class="btn" href="${sketchData.prints}" target="_blank" rel="noopener" tabindex="3">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
        Buy prints
      </a>`
    : "";

  const podcastBtn = sketchData.podcastUrl
    ? `<a class="btn" href="${sketchData.podcastUrl}" target="_blank" rel="noopener" tabindex="4">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>
        </svg>
        Listen
      </a>`
    : "";

  app.innerHTML = `
    <h1 class="sr-only">${sketchData.title}</h1>
    <div class="museum-layout">
      <div class="artwork-section">
        ${
          sketchData.image
            ? `<a href="${url}" target="_blank" rel="noopener" class="image-link"><img class="sketch-img" src="${
                sketchData.image
              }" alt="${
                sketchData.imageAlt || sketchData.title
              }" loading="lazy"></a>`
            : ""
        }
      </div>
      <div class="info-card">
        ${desc ? `<p class="desc">${desc}</p>` : ``}
        <div class="actions">
          <div class="relative">
            <div id="copiedNotification" class="copied-notification">
              Link copied!
            </div>
            <button id="copyBtn" title="Copy a link to this sketch" tabindex="2">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16,6 12,2 8,6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              Share
            </button>
           </div>
           ${printsBtn}
           ${podcastBtn}
         </div>
      </div>
    </div>
  `;

  setupV1Interactions(sketchData, url);
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

function setupV1Interactions(sketchData, url) {
  // fade-in when image loads
  const img = document.querySelector(".sketch-img");
  if (img) {
    if (img.complete) img.classList.add("is-loaded");
    else img.addEventListener("load", () => img.classList.add("is-loaded"));
  }

  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn.onclick = async () => {
    try {
      loading("Getting a new sketch…");
      const sketchData = await fetchNewSketch();
      await rememberSketch(sketchData.uid);
      await renderOrRedirect(sketchData);
    } catch (err) {
      showError(err);
    }
  };

  // Add keyboard support for refresh button (div element)
  refreshBtn.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      try {
        loading("Getting a new sketch…");
        const sketchData = await fetchNewSketch();
        await rememberSketch(sketchData.uid);
        await renderOrRedirect(sketchData);
      } catch (err) {
        showError(err);
      }
    }
  });

  document.getElementById("copyBtn").onclick = async () => {
    await navigator.clipboard.writeText(url);

    // Show copied notification
    const notification = document.getElementById("copiedNotification");
    notification.classList.add("show");

    // Hide after 2 seconds
    setTimeout(() => {
      notification.classList.remove("show");
    }, 2000);
  };

  // Keyboard shortcuts
  window.onkeydown = (e) => {
    const k = e.key.toLowerCase();
    if (k === "n" || e.key === "ArrowRight") {
      document.getElementById("refreshBtn").click();
    } else if (k === "v") {
      // Open the main sketch link (image)
      const a = document.querySelector(".image-link");
      if (a) a.click();
    } else if (k === "c") {
      document.getElementById("copyBtn").click();
    } else if (k === "p") {
      const p = document.querySelector(
        '.actions a[href][target="_blank"]:nth-child(2)'
      );
      if (p && p.textContent.trim().toLowerCase() === "prints") p.click();
    }
  };
}

function setupV2Interactions(sketchData, url) {
  // fade-in when image loads
  const img = document.querySelector(".v2-sketch-img");
  if (img) {
    if (img.complete) img.classList.add("is-loaded");
    else img.addEventListener("load", () => img.classList.add("is-loaded"));
  }

  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn.onclick = async () => {
    try {
      loading("Getting a new sketch…");
      const sketchData = await fetchNewSketch();
      await rememberSketch(sketchData.uid);
      await renderOrRedirect(sketchData);
    } catch (err) {
      showError(err);
    }
  };

  // Add keyboard support for refresh button (div element)
  refreshBtn.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      try {
        loading("Getting a new sketch…");
        const sketchData = await fetchNewSketch();
        await rememberSketch(sketchData.uid);
        await renderOrRedirect(sketchData);
      } catch (err) {
        showError(err);
      }
    }
  });

  // Add copy functionality for V2
  const copyBtn = document.getElementById("v2CopyBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(url);

      // Show copied notification
      const notification = document.getElementById("v2CopiedNotification");
      notification.classList.add("show");

      // Hide after 2 seconds
      setTimeout(() => {
        notification.classList.remove("show");
      }, 2000);
    };
  }

  // Simplified keyboard shortcuts for V2 (now with copy button)
  window.onkeydown = (e) => {
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
    }
  };
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
  app.innerHTML = `
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
  } catch (_) {}
}

// ---- Theme toggle ----
async function initTheme() {
  const version = await getVersion();

  // Set body class for version-specific styling
  if (version === VERSION_V2) {
    document.body.classList.add("v2-active");
    document.body.classList.remove("v1-active");
    // V2: Always respect system preferences
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = prefersDark ? "dark" : "light";
    applyTheme(theme);

    // Listen for OS theme changes in V2
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaQuery.addEventListener("change", (e) => {
        const newTheme = e.matches ? "dark" : "light";
        applyTheme(newTheme);
      });
    }
  } else {
    // V1: Use saved theme or default to system preference
    document.body.classList.add("v1-active");
    document.body.classList.remove("v2-active");
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
  }

  // Initialize frequency menu
  const frequency = await getFrequency();
  updateFrequencyMenu(frequency);

  // Setup version toggle
  await setupVersionToggle();

  // Setup palette menu (only for V1)
  if (version === VERSION_V1) {
    const paletteBtn = document.getElementById("paletteBtn");
    const themeMenu = document.getElementById("themeMenu");
    const themeOptions = document.querySelectorAll(".theme-option");

    // Toggle menu on palette button click
    paletteBtn.onclick = (e) => {
      e.stopPropagation();
      // Close frequency menu when opening theme menu
      const frequencyMenu = document.getElementById("frequencyMenu");
      frequencyMenu.classList.add("hidden");
      themeMenu.classList.toggle("hidden");
    };

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".theme-palette")) {
        themeMenu.classList.add("hidden");
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
      };
    });
  }

  // Setup frequency menu
  const frequencyBtn = document.getElementById("frequencyBtn");
  const frequencyMenu = document.getElementById("frequencyMenu");
  const frequencyOptions = document.querySelectorAll(".frequency-option");

  // Toggle frequency menu on button click
  frequencyBtn.onclick = (e) => {
    e.stopPropagation();
    // Close theme menu when opening frequency menu (only if V1)
    if (version === VERSION_V1) {
      const themeMenu = document.getElementById("themeMenu");
      themeMenu.classList.add("hidden");
    }
    frequencyMenu.classList.toggle("hidden");
  };

  // Close frequency menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".frequency-palette")) {
      frequencyMenu.classList.add("hidden");
    }
  });

  // Setup bottom menu
  const bottomMenuBtn = document.getElementById("bottomMenuBtn");
  const bottomMenu = document.getElementById("bottomMenu");

  // Toggle bottom menu on button click
  bottomMenuBtn.onclick = (e) => {
    e.stopPropagation();
    // Close other menus when opening bottom menu
    if (version === VERSION_V1) {
      const themeMenu = document.getElementById("themeMenu");
      themeMenu.classList.add("hidden");
    }
    frequencyMenu.classList.add("hidden");
    bottomMenu.classList.toggle("hidden");
  };

  // Close bottom menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".bottom-menu")) {
      bottomMenu.classList.add("hidden");
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
    };
  });

  // Update UI visibility based on version
  updateUIForVersion(version);
}

async function setupVersionToggle() {
  const version = await getVersion();

  const v1Link = document.getElementById("v1Link");
  const v2Link = document.getElementById("v2Link");

  // Update active states
  v1Link.classList.toggle("active", version === VERSION_V1);
  v2Link.classList.toggle("active", version === VERSION_V2);

  // Add click handlers
  v1Link.onclick = async (e) => {
    e.preventDefault();
    await setVersion(VERSION_V1);
    location.reload(); // Reload to apply changes
  };

  v2Link.onclick = async (e) => {
    e.preventDefault();
    await setVersion(VERSION_V2);
    location.reload(); // Reload to apply changes
  };
}

function updateUIForVersion(version) {
  const themeControls = document.querySelector(".theme-palette");

  if (version === VERSION_V2) {
    // Hide theme controls in V2
    if (themeControls) {
      themeControls.style.display = "none";
    }
  } else {
    // Show theme controls in V1
    if (themeControls) {
      themeControls.style.display = "block";
    }
  }
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
  document.body.classList.remove(
    "gradient-1",
    "gradient-2",
    "gradient-3",
    "gradient-4",
    "gradient-5"
  );

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

  const gradients = [
    "gradient-1",
    "gradient-2",
    "gradient-3",
    "gradient-4",
    "gradient-5",
  ];
  let currentIndex = 0;

  // Set initial gradient
  document.body.classList.add(gradients[currentIndex]);

  // Rotate every 30 seconds
  setInterval(() => {
    if (!document.body.classList.contains("theme-gradient")) return;

    // Remove current gradient
    document.body.classList.remove(gradients[currentIndex]);

    // Move to next gradient
    currentIndex = (currentIndex + 1) % gradients.length;

    // Add new gradient
    document.body.classList.add(gradients[currentIndex]);
  }, 300000); // 5 minutes
}

async function init() {
  await initTheme();

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
