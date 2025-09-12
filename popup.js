// DOM elements
const authSection = document.getElementById("authSection");
const recipeSection = document.getElementById("recipeSection");
const loginBtn = document.getElementById("loginBtn");
const addRecipeBtn = document.getElementById("addRecipeBtn");
const viewRecipeBtn = document.getElementById("viewRecipeBtn");
const logoutBtn = document.getElementById("logoutBtn");

// Auth state
let jwtToken = null;
let refreshToken = null;
let tokenExpiresAt = null;

// Recipe state
let lastCreatedRecipeId = null;

// Initialize the popup
const init = async () => {
  try {
    updateDebugStatus("Initializing...");

    // Small delay to ensure any recent token storage has completed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Ask background script to check and refresh tokens proactively
    try {
      await browser.runtime.sendMessage({ action: "checkTokenStatus" });
    } catch (error) {}

    await checkAuthState();

    setupEventListeners();

    updateDebugStatus("Ready!");
  } catch (error) {
    updateDebugStatus("Error: " + error.message);
  }
};

// Update debug status
const updateDebugStatus = (message) => {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = message;
  }
};

// Check if user is authenticated
const checkAuthState = async () => {
  try {
    updateDebugStatus("Checking auth state...");

    // Check extension storage
    const result = await browser.storage.local.get([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);

    jwtToken = result.jwtToken;
    refreshToken = result.refreshToken;
    tokenExpiresAt = result.tokenExpiresAt;

    if (jwtToken) {
      // Check if token needs refresh
      if (isTokenExpired()) {
        updateDebugStatus("Token expired, refreshing...");
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          updateDebugStatus("Token refresh failed, please login again");
          await handleLogout();
          return;
        }
      } else {
      }
      updateDebugStatus("✅ Authenticated! Showing recipe section");
      showRecipeSection();
    } else {
      updateDebugStatus("❌ Not authenticated - showing login");
      showAuthSection();
    }
  } catch (error) {
    updateDebugStatus("Error: " + error.message);
    showAuthSection();
  }
};

// Show login section
const showAuthSection = () => {
  if (authSection) {
    authSection.style.display = "block";
  }
  if (recipeSection) {
    recipeSection.style.display = "none";
  }
};

// Show recipe section
const showRecipeSection = () => {
  if (authSection) {
    authSection.style.display = "none";
  }
  if (recipeSection) {
    recipeSection.style.display = "block";
  }
};

// Setup event listeners
const setupEventListeners = () => {
  if (loginBtn) {
    loginBtn.addEventListener("click", handleLogin);
  }
  if (addRecipeBtn) {
    addRecipeBtn.addEventListener("click", handleAddRecipe);
  }
  if (viewRecipeBtn) {
    viewRecipeBtn.addEventListener("click", handleViewRecipe);
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }
};

// Handle login
const handleLogin = async () => {
  updateDebugStatus("Opening auth page...");

  try {
    const redirectUri =
      "moz-extension://" + browser.runtime.id + "/auth-success.html";
    const backendUrl = "http://localhost:8787";
    const authUrl = `${backendUrl}/auth/extension?redirect_uri=${encodeURIComponent(
      redirectUri
    )}`;

    // Create a new tab with the auth URL
    const tab = await browser.tabs.create({
      url: authUrl,
      active: true,
    });

    // Monitor for authentication completion
    updateDebugStatus("Monitoring auth tab...");
    setTimeout(() => {
      let attempts = 0;
      const maxAttempts = 30; // 60 seconds timeout
      const checkInterval = setInterval(async () => {
        attempts++;

        try {
          // Check if tokens were stored by the frontend
          const tabResult = await browser.tabs.executeScript(tab.id, {
            code: `
              ({
                jwtToken: localStorage.getItem('jwtToken') || localStorage.getItem('extension_token'),
                refreshToken: localStorage.getItem('extension_refresh_token'),
                expiresAt: localStorage.getItem('extension_expires_at'),
                allLocalStorage: Object.keys(localStorage).reduce((acc, key) => {
                  if (key.includes('token') || key.includes('extension') || key.includes('jwt')) {
                    acc[key] = localStorage.getItem(key);
                  }
                  return acc;
                }, {}),
                currentUrl: window.location.href
              })
            `,
          });

          if (tabResult && tabResult[0] && tabResult[0].jwtToken) {
            const tokenData = tabResult[0];

            // Store tokens in extension storage
            await browser.storage.local.set({
              jwtToken: tokenData.jwtToken,
              refreshToken: tokenData.refreshToken,
              tokenExpiresAt: tokenData.expiresAt,
            });

            updateDebugStatus("Authentication successful!");
            await checkAuthState();
            clearInterval(checkInterval);
            try {
              await browser.tabs.remove(tab.id);
            } catch (e) {}
            return;
          } else {
          }
        } catch (e) {}

        if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          updateDebugStatus("OAuth timeout - please try again");
          try {
            await browser.tabs.remove(tab.id);
          } catch (e) {}
        }
      }, 2000);
    }, 2000);
  } catch (error) {
    updateDebugStatus("Login failed: " + error.message);
  }
};

// Check if token is expired or will expire soon (within 5 minutes)
const isTokenExpired = () => {
  if (!tokenExpiresAt) {
    return true;
  }
  const expiresAt = new Date(parseInt(tokenExpiresAt) * 1000);
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
  const isExpired = expiresAt <= fiveMinutesFromNow;

  return isExpired;
};

// Refresh the access token using the refresh token
const refreshAccessToken = async () => {
  try {
    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    const backendUrl = "http://localhost:8787";
    const refreshUrl = `${backendUrl}/auth/refresh`;

    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();

    // Update tokens
    jwtToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiresAt = data.expires_at?.toString();

    // Store updated tokens
    await browser.storage.local.set({
      jwtToken: jwtToken,
      refreshToken: refreshToken,
      tokenExpiresAt: tokenExpiresAt,
    });

    return true;
  } catch (error) {
    return false;
  }
};

// Ensure we have a valid token before making API calls
const ensureValidToken = async () => {
  if (!jwtToken || isTokenExpired()) {
    updateDebugStatus("Token expired, refreshing...");

    // Ask background script to refresh token
    try {
      const response = await browser.runtime.sendMessage({
        action: "refreshToken",
      });

      if (response && response.success) {
        // Reload tokens from storage
        const result = await browser.storage.local.get([
          "jwtToken",
          "refreshToken",
          "tokenExpiresAt",
        ]);
        jwtToken = result.jwtToken;
        refreshToken = result.refreshToken;
        tokenExpiresAt = result.tokenExpiresAt;

        if (jwtToken) {
          updateDebugStatus("Token refreshed successfully");
          return true;
        } else {
        }
      } else {
      }
    } catch (error) {}

    // Fallback to direct refresh
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      updateDebugStatus("Token refresh failed, please login again");
      await handleLogout();
      return false;
    }
    updateDebugStatus("Token refreshed successfully");
  } else {
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
    jwtToken = null;
    refreshToken = null;
    tokenExpiresAt = null;
    showAuthSection();
  } catch (error) {}
};

// Send recipe to endpoint
const sendToEndpoint = async (data) => {
  try {
    // Ensure we have a valid token before making the request
    const hasValidToken = await ensureValidToken();
    if (!hasValidToken) {
      throw new Error("Authentication failed - please login again");
    }

    const backendUrl = "http://localhost:8787";
    const apiUrl = `${backendUrl}/extract-from-html`;

    // Transform data to match API expectations
    const requestData = {
      html: data.html,
      url: data.url,
      metadata: {
        userAgent: data.userAgent,
        timestamp: data.timestamp,
        extensionVersion: "1.0",
      },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(requestData),
    });

    // Log the response body for debugging
    const responseText = await response.text();

    if (response.status === 401 || response.status === 403) {
      // Token expired or invalid
      // TEMPORARY: Don't auto-logout until we debug the API issue
      // await handleLogout();
      throw new Error("API authentication failed. Check console for details.");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse the response data
    let responseData = null;
    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {}

    return { success: true, status: response.status, data: responseData };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Handle adding recipe
const handleAddRecipe = async () => {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    addRecipeBtn.textContent = "Capturing...";
    addRecipeBtn.disabled = true;

    // Hide the View Recipe button when starting a new capture
    if (viewRecipeBtn) {
      viewRecipeBtn.style.display = "none";
    }

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

    if (response && response.success) {
      addRecipeBtn.textContent = "Sending...";

      const sendResult = await sendToEndpoint(response.data);

      if (sendResult.success) {
        // Store the recipe ID for the View Recipe button
        lastCreatedRecipeId = sendResult.data?.id;

        addRecipeBtn.textContent = "✅ Sent!";
        addRecipeBtn.style.backgroundColor = "#45a049";

        // Show the View Recipe button
        if (lastCreatedRecipeId && viewRecipeBtn) {
          viewRecipeBtn.style.display = "block";
        }

        setTimeout(() => {
          addRecipeBtn.textContent = "Add this recipe to Resept";
          addRecipeBtn.style.backgroundColor = "#4caf50";
          addRecipeBtn.disabled = false;

          // Hide the View Recipe button after 10 seconds
          if (viewRecipeBtn) {
            viewRecipeBtn.style.display = "none";
          }
        }, 2000);
      } else {
        addRecipeBtn.textContent = "❌ Failed";
        addRecipeBtn.style.backgroundColor = "#f44336";
        setTimeout(() => {
          addRecipeBtn.textContent = "Add this recipe to Resept";
          addRecipeBtn.style.backgroundColor = "#4caf50";
          addRecipeBtn.disabled = false;
        }, 2000);
      }
    } else {
      addRecipeBtn.textContent = "❌ Failed";
      addRecipeBtn.style.backgroundColor = "#f44336";
      setTimeout(() => {
        addRecipeBtn.textContent = "Add this recipe to Resept";
        addRecipeBtn.style.backgroundColor = "#4caf50";
        addRecipeBtn.disabled = false;
      }, 2000);
    }
  } catch (error) {
    addRecipeBtn.textContent = "❌ Error";
    addRecipeBtn.style.backgroundColor = "#f44336";
    setTimeout(() => {
      addRecipeBtn.textContent = "Add this recipe to Resept";
      addRecipeBtn.style.backgroundColor = "#4caf50";
      addRecipeBtn.disabled = false;
    }, 2000);
  }
};

// Handle viewing recipe
const handleViewRecipe = async () => {
  if (!lastCreatedRecipeId) {
    updateDebugStatus("No recipe to view");
    return;
  }

  try {
    // Construct the webapp URL
    // Switch between dev and production based on environment
    // Check if we're in development by looking for localhost in the current tab
    const [currentTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const isDev =
      currentTab?.url?.includes("localhost") ||
      currentTab?.url?.includes("127.0.0.1");
    const webappUrl = isDev
      ? `http://localhost:5173/recipes/${lastCreatedRecipeId}`
      : `https://flopieutd.github.io/resept/recipes/${lastCreatedRecipeId}`;

    // Open the recipe in a new tab
    await browser.tabs.create({
      url: webappUrl,
      active: true,
    });

    updateDebugStatus("Recipe opened in webapp!");

    // Hide the View Recipe button after opening
    if (viewRecipeBtn) {
      viewRecipeBtn.style.display = "none";
    }
  } catch (error) {
    updateDebugStatus("Error opening recipe: " + error.message);
  }
};

// Initialize when popup opens
document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    updateDebugStatus("Failed to initialize: " + error.message);
  });
});
