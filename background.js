// Background script for automatic token refresh
const REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes - check more frequently
const TOKEN_BUFFER = 10 * 60 * 1000; // 10 minutes before expiration
let refreshTimer = null;

// Initialize background script
const init = async () => {
  await checkAndRefreshToken();
  setupPeriodicRefresh();
};

// Check if token needs refresh and refresh if necessary
const checkAndRefreshToken = async () => {
  try {
    console.log("🔄 [BACKGROUND] Checking token status");
    const result = await browser.storage.local.get([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);

    const { jwtToken, refreshToken, tokenExpiresAt } = result;

    if (!jwtToken || !refreshToken) {
      console.log("❌ [BACKGROUND] No tokens found, skipping refresh");
      return; // No tokens to refresh
    }

    const isExpired = isTokenExpired(tokenExpiresAt);
    console.log("⏰ [BACKGROUND] Token status:", {
      hasToken: !!jwtToken,
      hasRefresh: !!refreshToken,
      expiresAt: new Date(parseInt(tokenExpiresAt) * 1000).toISOString(),
      isExpired: isExpired,
    });

    if (isExpired) {
      console.log("🔄 [BACKGROUND] Token needs refresh, refreshing...");
      const success = await refreshAccessToken(refreshToken);
      if (success) {
        console.log("✅ [BACKGROUND] Token refreshed successfully");
      } else {
        console.log("❌ [BACKGROUND] Token refresh failed");
      }
    } else {
      console.log("✅ [BACKGROUND] Token is still valid");
    }
  } catch (error) {
    console.error("💥 [BACKGROUND] Token check failed:", error);
  }
};

// Check if token is expired or will expire soon (within buffer time)
const isTokenExpired = (expiresAt) => {
  if (!expiresAt) return true;
  const expirationTime = new Date(parseInt(expiresAt) * 1000);
  const now = new Date();
  const bufferTime = new Date(now.getTime() + TOKEN_BUFFER);
  return expirationTime <= bufferTime;
};

// Refresh the access token
const refreshAccessToken = async (refreshToken) => {
  try {
    console.log("🌐 [BACKGROUND] Making refresh request to backend");
    const backendUrl = "http://localhost:8787";
    const response = await fetch(`${backendUrl}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    });

    console.log("📡 [BACKGROUND] Refresh response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(
        "❌ [BACKGROUND] Refresh failed:",
        response.status,
        errorText
      );
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    console.log("📦 [BACKGROUND] Refresh response data:", {
      hasAccessToken: !!data.access_token,
      hasRefreshToken: !!data.refresh_token,
      expiresAt: data.expires_at,
    });

    // Update tokens in storage
    await browser.storage.local.set({
      jwtToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: data.expires_at?.toString(),
    });

    console.log("✅ [BACKGROUND] Tokens updated in storage");
    return true;
  } catch (error) {
    console.error("💥 [BACKGROUND] Token refresh failed:", error);
    // Clear invalid tokens
    await browser.storage.local.remove([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);
    console.log("🗑️ [BACKGROUND] Cleared invalid tokens from storage");
    return false;
  }
};

// Setup periodic token refresh
const setupPeriodicRefresh = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(async () => {
    await checkAndRefreshToken();
  }, REFRESH_INTERVAL);
};

// Handle extension startup
browser.runtime.onStartup.addListener(init);
browser.runtime.onInstalled.addListener(init);

// Handle messages from popup
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refreshToken") {
    console.log("📨 [BACKGROUND] Received refresh request from popup");
    checkAndRefreshToken().then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep message channel open for async response
  }

  if (request.action === "checkTokenStatus") {
    console.log("📨 [BACKGROUND] Received token status check from popup");
    checkAndRefreshToken().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Handle popup opening - ensure tokens are fresh
browser.browserAction.onClicked.addListener(async () => {
  console.log("🖱️ [BACKGROUND] Popup opened, checking token status");
  await checkAndRefreshToken();
});

// Initialize on script load
init();
