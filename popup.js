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
    console.log("🚀 [INIT] Starting popup initialization");
    updateDebugStatus("Initializing...");

    // Small delay to ensure any recent token storage has completed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Ask background script to check and refresh tokens proactively
    console.log("🔄 [INIT] Asking background to check token status");
    try {
      await browser.runtime.sendMessage({ action: "checkTokenStatus" });
    } catch (error) {
      console.log("⚠️ [INIT] Background check failed:", error.message);
    }

    console.log("🔍 [INIT] Checking auth state");
    await checkAuthState();

    console.log("🎧 [INIT] Setting up event listeners");
    setupEventListeners();

    console.log("✅ [INIT] Popup initialization complete");
    updateDebugStatus("Ready!");
  } catch (error) {
    console.error("💥 [INIT] Initialization failed:", error);
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
    console.log("🔍 [AUTH] Starting auth state check");
    updateDebugStatus("Checking auth state...");

    // Check extension storage
    const result = await browser.storage.local.get([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);
    console.log("📦 [AUTH] Storage result:", result);

    jwtToken = result.jwtToken;
    refreshToken = result.refreshToken;
    tokenExpiresAt = result.tokenExpiresAt;

    console.log("🔑 [AUTH] Tokens loaded:", {
      hasJwt: !!jwtToken,
      hasRefresh: !!refreshToken,
      expiresAt: tokenExpiresAt,
    });

    if (jwtToken) {
      console.log("✅ [AUTH] JWT token found, checking expiration");
      // Check if token needs refresh
      if (isTokenExpired()) {
        console.log("⏰ [AUTH] Token expired, attempting refresh");
        updateDebugStatus("Token expired, refreshing...");
        const refreshed = await refreshAccessToken();
        console.log("🔄 [AUTH] Refresh result:", refreshed);
        if (!refreshed) {
          console.log("❌ [AUTH] Token refresh failed, logging out");
          updateDebugStatus("Token refresh failed, please login again");
          await handleLogout();
          return;
        }
      } else {
        console.log("✅ [AUTH] Token is still valid");
      }
      updateDebugStatus("✅ Authenticated! Showing recipe section");
      showRecipeSection();
    } else {
      console.log("❌ [AUTH] No JWT token found, showing login");
      updateDebugStatus("❌ Not authenticated - showing login");
      showAuthSection();
    }
  } catch (error) {
    console.error("💥 [AUTH] Error in checkAuthState:", error);
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
  console.log("🚀 [LOGIN] Starting login process");
  updateDebugStatus("Opening auth page...");

  try {
    const redirectUri =
      "moz-extension://" + browser.runtime.id + "/auth-success.html";
    const backendUrl = "http://localhost:8787";
    const authUrl = `${backendUrl}/auth/extension?redirect_uri=${encodeURIComponent(
      redirectUri
    )}`;

    console.log("🔗 [LOGIN] Auth URL:", authUrl);
    console.log("🔗 [LOGIN] Redirect URI:", redirectUri);

    // Create a new tab with the auth URL
    const tab = await browser.tabs.create({
      url: authUrl,
      active: true,
    });

    console.log("📱 [LOGIN] Created tab with ID:", tab.id);

    // Monitor for authentication completion
    updateDebugStatus("Monitoring auth tab...");
    setTimeout(() => {
      console.log("⏰ [LOGIN] Starting token monitoring");
      let attempts = 0;
      const maxAttempts = 30; // 60 seconds timeout
      const checkInterval = setInterval(async () => {
        attempts++;
        console.log(`🔍 [LOGIN] Check attempt ${attempts}/${maxAttempts}`);

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

          console.log("📊 [LOGIN] Tab localStorage check result:", tabResult);

          if (tabResult && tabResult[0] && tabResult[0].jwtToken) {
            const tokenData = tabResult[0];
            console.log("🎉 [LOGIN] Tokens found in localStorage:", tokenData);

            // Store tokens in extension storage
            await browser.storage.local.set({
              jwtToken: tokenData.jwtToken,
              refreshToken: tokenData.refreshToken,
              tokenExpiresAt: tokenData.expiresAt,
            });

            console.log("💾 [LOGIN] Tokens stored in extension storage");
            updateDebugStatus("Authentication successful!");
            await checkAuthState();
            clearInterval(checkInterval);
            try {
              await browser.tabs.remove(tab.id);
              console.log("🗑️ [LOGIN] Auth tab closed");
            } catch (e) {
              console.log("⚠️ [LOGIN] Could not close auth tab:", e.message);
            }
            return;
          } else {
            console.log(
              "⏳ [LOGIN] No tokens found yet, continuing to monitor"
            );
            console.log(
              "🔍 [LOGIN] Current tab URL:",
              tabResult[0]?.currentUrl
            );
            console.log(
              "🔍 [LOGIN] All localStorage keys with 'token':",
              tabResult[0]?.allLocalStorage
            );
          }
        } catch (e) {
          console.log(
            "❌ [LOGIN] Error accessing tab localStorage:",
            e.message
          );
          console.log("🔍 [LOGIN] Error details:", e);
        }

        if (attempts >= maxAttempts) {
          console.log("⏰ [LOGIN] Timeout reached, stopping monitoring");
          clearInterval(checkInterval);
          updateDebugStatus("OAuth timeout - please try again");
          try {
            await browser.tabs.remove(tab.id);
          } catch (e) {
            console.log(
              "⚠️ [LOGIN] Could not close auth tab on timeout:",
              e.message
            );
          }
        }
      }, 2000);
    }, 2000);
  } catch (error) {
    console.error("💥 [LOGIN] Login process failed:", error);
    updateDebugStatus("Login failed: " + error.message);
  }
};

// Check if token is expired or will expire soon (within 5 minutes)
const isTokenExpired = () => {
  if (!tokenExpiresAt) {
    console.log("⏰ [TOKEN] No expiration time found, considering expired");
    return true;
  }
  const expiresAt = new Date(parseInt(tokenExpiresAt) * 1000);
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
  const isExpired = expiresAt <= fiveMinutesFromNow;

  console.log("⏰ [TOKEN] Token expiration check:", {
    expiresAt: expiresAt.toISOString(),
    now: now.toISOString(),
    fiveMinutesFromNow: fiveMinutesFromNow.toISOString(),
    isExpired: isExpired,
  });

  return isExpired;
};

// Refresh the access token using the refresh token
const refreshAccessToken = async () => {
  try {
    console.log("🔄 [REFRESH] Starting token refresh");

    if (!refreshToken) {
      console.log("❌ [REFRESH] No refresh token available");
      throw new Error("No refresh token available");
    }

    const backendUrl = "http://localhost:8787";
    const refreshUrl = `${backendUrl}/auth/refresh`;

    console.log("🌐 [REFRESH] Making request to:", refreshUrl);
    console.log(
      "🔑 [REFRESH] Using refresh token:",
      refreshToken.substring(0, 10) + "..."
    );

    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    });

    console.log("📡 [REFRESH] Response status:", response.status);
    console.log(
      "📡 [REFRESH] Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log("❌ [REFRESH] Response error body:", errorText);
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    console.log("📦 [REFRESH] Response data:", data);

    // Update tokens
    jwtToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiresAt = data.expires_at?.toString();

    console.log("🔑 [REFRESH] New tokens:", {
      hasJwt: !!jwtToken,
      hasRefresh: !!refreshToken,
      expiresAt: tokenExpiresAt,
    });

    // Store updated tokens
    await browser.storage.local.set({
      jwtToken: jwtToken,
      refreshToken: refreshToken,
      tokenExpiresAt: tokenExpiresAt,
    });

    console.log("💾 [REFRESH] Tokens stored successfully");
    return true;
  } catch (error) {
    console.error("💥 [REFRESH] Token refresh failed:", error);
    return false;
  }
};

// Ensure we have a valid token before making API calls
const ensureValidToken = async () => {
  console.log("🔐 [TOKEN] Ensuring valid token");

  if (!jwtToken || isTokenExpired()) {
    console.log("⚠️ [TOKEN] Token invalid or expired, attempting refresh");
    updateDebugStatus("Token expired, refreshing...");

    // Ask background script to refresh token
    try {
      console.log("📡 [TOKEN] Asking background script to refresh token");
      const response = await browser.runtime.sendMessage({
        action: "refreshToken",
      });
      console.log("📡 [TOKEN] Background script response:", response);

      if (response && response.success) {
        console.log(
          "✅ [TOKEN] Background refresh successful, reloading tokens"
        );
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
          console.log("✅ [TOKEN] Tokens reloaded successfully");
          updateDebugStatus("Token refreshed successfully");
          return true;
        } else {
          console.log("❌ [TOKEN] No JWT token after background refresh");
        }
      } else {
        console.log(
          "❌ [TOKEN] Background refresh failed or no success response"
        );
      }
    } catch (error) {
      console.error("💥 [TOKEN] Background refresh failed:", error);
    }

    // Fallback to direct refresh
    console.log("🔄 [TOKEN] Falling back to direct refresh");
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      console.log("❌ [TOKEN] Direct refresh failed, logging out");
      updateDebugStatus("Token refresh failed, please login again");
      await handleLogout();
      return false;
    }
    console.log("✅ [TOKEN] Direct refresh successful");
    updateDebugStatus("Token refreshed successfully");
  } else {
    console.log("✅ [TOKEN] Token is valid, no refresh needed");
  }
  return true;
};

// Handle logout
const handleLogout = async () => {
  try {
    console.log("🚪 [LOGOUT] Clearing all tokens from storage");
    await browser.storage.local.remove([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);
    jwtToken = null;
    refreshToken = null;
    tokenExpiresAt = null;
    console.log("✅ [LOGOUT] Tokens cleared, showing auth section");
    showAuthSection();
  } catch (error) {
    console.error("💥 [LOGOUT] Error during logout:", error);
  }
};

// Send recipe to endpoint
const sendToEndpoint = async (data) => {
  try {
    console.log("📤 [API] Starting recipe send to endpoint");

    // Ensure we have a valid token before making the request
    const hasValidToken = await ensureValidToken();
    if (!hasValidToken) {
      console.log("❌ [API] No valid token available");
      throw new Error("Authentication failed - please login again");
    }

    const backendUrl = "http://localhost:8787";
    const apiUrl = `${backendUrl}/extract-from-html`;

    console.log("🌐 [API] Making request to:", apiUrl);
    console.log("🔑 [API] Using JWT token:", jwtToken.substring(0, 20) + "...");

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

    console.log("📦 [API] Request data:", {
      url: requestData.url,
      htmlLength: requestData.html.length,
      userAgent: requestData.metadata.userAgent,
      timestamp: requestData.metadata.timestamp,
    });

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(requestData),
    });

    console.log("📡 [API] Response status:", response.status);
    console.log(
      "📡 [API] Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    // Log the response body for debugging
    const responseText = await response.text();
    console.log("📄 [API] Response body:", responseText);

    if (response.status === 401 || response.status === 403) {
      console.log(
        "🔒 [API] Authentication failed with status:",
        response.status
      );
      // Token expired or invalid
      // TEMPORARY: Don't auto-logout until we debug the API issue
      // await handleLogout();
      throw new Error("API authentication failed. Check console for details.");
    }

    if (!response.ok) {
      console.log("❌ [API] Request failed with status:", response.status);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse the response data
    let responseData = null;
    try {
      responseData = JSON.parse(responseText);
      console.log("📦 [API] Parsed response data:", responseData);
    } catch (parseError) {
      console.log("⚠️ [API] Failed to parse response as JSON:", parseError);
    }

    console.log("✅ [API] Request successful");
    return { success: true, status: response.status, data: responseData };
  } catch (error) {
    console.error("💥 [API] Send to endpoint failed:", error);
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
    console.error("❌ [VIEW] No recipe ID available");
    updateDebugStatus("No recipe to view");
    return;
  }

  try {
    console.log("🌐 [VIEW] Opening recipe in webapp:", lastCreatedRecipeId);

    // Construct the webapp URL
    // Use local development URL for now - can be changed to production URL later
    const webappUrl = `http://localhost:5173/recipes/${lastCreatedRecipeId}`;

    // Open the recipe in a new tab
    await browser.tabs.create({
      url: webappUrl,
      active: true,
    });

    console.log("✅ [VIEW] Recipe opened successfully");
    updateDebugStatus("Recipe opened in webapp!");

    // Hide the View Recipe button after opening
    if (viewRecipeBtn) {
      viewRecipeBtn.style.display = "none";
    }
  } catch (error) {
    console.error("💥 [VIEW] Error opening recipe:", error);
    updateDebugStatus("Error opening recipe: " + error.message);
  }
};

// Initialize when popup opens
document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    updateDebugStatus("Failed to initialize: " + error.message);
  });
});
