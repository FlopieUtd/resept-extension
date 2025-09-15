// Configuration
const CONFIG = {
  backendUrl: "http://localhost:8787",
  tokenBuffer: 5 * 60 * 1000, // 5 minutes
  buttonResetDelay: 2000,
  buttonColors: {
    success: "#45a049",
    error: "#f44336",
    default: "#4caf50",
  },
};

// DOM elements
const elements = {
  authSection: document.getElementById("authSection"),
  recipeSection: document.getElementById("recipeSection"),
  loginBtn: document.getElementById("loginBtn"),
  openRecipeBtn: document.getElementById("openRecipeBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  status: document.getElementById("status"),
};

// State
let state = {
  jwtToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  lastCreatedRecipeId: null,
};

// Helper functions
const updateStatus = (message) => {
  if (elements.status) elements.status.textContent = message;
};

const showSection = (section) => {
  const isAuth = section === "auth";
  elements.authSection.style.display = isAuth ? "block" : "none";
  elements.recipeSection.style.display = isAuth ? "none" : "block";
};

const updateButton = (button, text, color, disabled = false) => {
  if (button) {
    button.textContent = text;
    button.style.backgroundColor = color;
    button.disabled = disabled;
  }
};

const resetButton = (button, text = "Open recipe in Resept") => {
  updateButton(button, text, CONFIG.buttonColors.default, false);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handleButtonState = async (button, states) => {
  const { loading, success, error } = states;

  if (loading) {
    updateButton(button, loading.text, loading.color, true);
  }

  if (success) {
    updateButton(button, success.text, success.color);
    setTimeout(() => {
      resetButton(button);
    }, CONFIG.buttonResetDelay);
  }

  if (error) {
    updateButton(button, error.text, error.color);
    setTimeout(() => resetButton(button), CONFIG.buttonResetDelay);
  }
};

// Initialize the popup
const init = async () => {
  try {
    updateStatus("Initializing...");
    await sleep(100);

    // Setup global message listener for auth success
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "EXTENSION_AUTH_SUCCESS") {
        // Store the tokens
        browser.storage.local
          .set({
            jwtToken: message.tokens.jwtToken,
            refreshToken: message.tokens.refreshToken,
            tokenExpiresAt: message.tokens.tokenExpiresAt,
          })
          .then(() => {
            updateStatus("Authentication successful!");
            checkAuthState();
            // Close any open auth tabs (disabled for debugging)
            // browser.tabs.query({}).then((tabs) => {
            //   tabs.forEach((tab) => {
            //     if (
            //       tab.url &&
            //       (tab.url.includes("/auth/extension") ||
            //         tab.url.includes("auth-success.html"))
            //     ) {
            //       browser.tabs.remove(tab.id);
            //     }
            //   });
            // });
          });
      }
    });

    try {
      await browser.runtime.sendMessage({ action: "checkTokenStatus" });
    } catch (error) {}

    await checkAuthState();
    setupEventListeners();
    updateStatus("Ready!");
  } catch (error) {
    updateStatus("Error: " + error.message);
  }
};

// Check if user is authenticated
const checkAuthState = async () => {
  try {
    updateStatus("Checking auth state...");

    const result = await browser.storage.local.get([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);

    Object.assign(state, result);

    if (state.jwtToken) {
      if (isTokenExpired()) {
        updateStatus("Token expired, refreshing...");
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          updateStatus("Token refresh failed, please login again");
          await handleLogout();
          return;
        }
      }
      updateStatus("✅ Authenticated! Showing recipe section");
      showSection("recipe");
    } else {
      updateStatus("❌ Not authenticated - showing login");
      showSection("auth");
    }
  } catch (error) {
    updateStatus("Error: " + error.message);
    showSection("auth");
  }
};

// Setup event listeners
const setupEventListeners = () => {
  const listeners = [
    [elements.loginBtn, handleLogin],
    [elements.openRecipeBtn, handleOpenRecipe],
    [elements.logoutBtn, handleLogout],
  ];

  listeners.forEach(([element, handler]) => {
    if (element) element.addEventListener("click", handler);
  });
};

// Handle login
const handleLogin = async () => {
  updateStatus("Opening auth page...");

  try {
    const redirectUri = `moz-extension://${browser.runtime.id}/auth-success.html`;
    const authUrl = `${
      CONFIG.backendUrl
    }/auth/extension?redirect_uri=${encodeURIComponent(redirectUri)}`;

    const tab = await browser.tabs.create({ url: authUrl, active: true });
  } catch (error) {
    updateStatus("Login failed: " + error.message);
  }
};

// Check if token is expired or will expire soon
const isTokenExpired = () => {
  if (!state.tokenExpiresAt) return true;
  const expiresAt = new Date(parseInt(state.tokenExpiresAt) * 1000);
  const fiveMinutesFromNow = new Date(Date.now() + CONFIG.tokenBuffer);
  return expiresAt <= fiveMinutesFromNow;
};

// Refresh the access token using the refresh token
const refreshAccessToken = async () => {
  try {
    if (!state.refreshToken) throw new Error("No refresh token available");

    const response = await fetch(`${CONFIG.backendUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refreshToken }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    Object.assign(state, {
      jwtToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: data.expires_at?.toString(),
    });

    await browser.storage.local.set(state);
    return true;
  } catch (error) {
    return false;
  }
};

// Ensure we have a valid token before making API calls
const ensureValidToken = async () => {
  if (!state.jwtToken || isTokenExpired()) {
    updateStatus("Token expired, refreshing...");

    try {
      const response = await browser.runtime.sendMessage({
        action: "refreshToken",
      });
      if (response?.success) {
        const result = await browser.storage.local.get([
          "jwtToken",
          "refreshToken",
          "tokenExpiresAt",
        ]);
        Object.assign(state, result);
        if (state.jwtToken) {
          updateStatus("Token refreshed successfully");
          return true;
        }
      }
    } catch (error) {}

    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      updateStatus("Token refresh failed, please login again");
      await handleLogout();
      return false;
    }
    updateStatus("Token refreshed successfully");
  }
  return true;
};

// Handle logout
const handleLogout = async () => {
  try {
    await browser.storage.local.remove([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);
    Object.assign(state, {
      jwtToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    });
    showSection("auth");
  } catch (error) {}
};

// Send recipe to endpoint
const sendToEndpoint = async (data) => {
  try {
    const hasValidToken = await ensureValidToken();
    if (!hasValidToken)
      throw new Error("Authentication failed - please login again");

    const response = await fetch(`${CONFIG.backendUrl}/extract-from-html`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.jwtToken}`,
      },
      body: JSON.stringify({
        html: data.html,
        url: data.url,
        metadata: {
          userAgent: data.userAgent,
          timestamp: data.timestamp,
          extensionVersion: "1.0",
        },
      }),
    });

    const responseText = await response.text();

    if (response.status === 401 || response.status === 403) {
      throw new Error("API authentication failed. Check console for details.");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    let responseData = null;
    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {}

    return { success: true, status: response.status, data: responseData };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Handle opening recipe (save + open)
const handleOpenRecipe = async () => {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    await handleButtonState(elements.openRecipeBtn, {
      loading: { text: "⏳ Capturing...", color: CONFIG.buttonColors.default },
    });

    const response = await new Promise((resolve, reject) => {
      browser.tabs.sendMessage(
        tab.id,
        { action: "captureHTML" },
        (response) => {
          if (browser.runtime.lastError) {
            reject(new Error(browser.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });

    if (response?.success) {
      updateButton(
        elements.openRecipeBtn,
        "⏳ Saving...",
        CONFIG.buttonColors.default,
        true
      );
      const sendResult = await sendToEndpoint(response.data);

      if (sendResult.success) {
        state.lastCreatedRecipeId = sendResult.data?.id;
        updateButton(
          elements.openRecipeBtn,
          "⏳ Opening...",
          CONFIG.buttonColors.default,
          true
        );

        await openRecipeInWebapp();

        await handleButtonState(elements.openRecipeBtn, {
          success: {
            text: "✅ Opened!",
            color: CONFIG.buttonColors.success,
          },
        });
      } else {
        await handleButtonState(elements.openRecipeBtn, {
          error: { text: "❌ Failed", color: CONFIG.buttonColors.error },
        });
      }
    } else {
      await handleButtonState(elements.openRecipeBtn, {
        error: { text: "❌ Failed", color: CONFIG.buttonColors.error },
      });
    }
  } catch (error) {
    await handleButtonState(elements.openRecipeBtn, {
      error: { text: "❌ Error", color: CONFIG.buttonColors.error },
    });
  }
};

// Open recipe in webapp
const openRecipeInWebapp = async () => {
  if (!state.lastCreatedRecipeId) {
    throw new Error("No recipe to open");
  }

  const [currentTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  const isDev =
    currentTab?.url?.includes("localhost") ||
    currentTab?.url?.includes("127.0.0.1");
  const webappUrl = isDev
    ? `http://localhost:5173/recipes/${state.lastCreatedRecipeId}`
    : `https://flopieutd.github.io/resept/recipes/${state.lastCreatedRecipeId}`;

  await browser.tabs.create({ url: webappUrl, active: true });
  updateStatus("Recipe opened in webapp!");
};

// Initialize when popup opens
document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    updateStatus("Failed to initialize: " + error.message);
  });
});
