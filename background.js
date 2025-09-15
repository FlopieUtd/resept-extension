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
    const result = await browser.storage.local.get([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);

    const { jwtToken, refreshToken, tokenExpiresAt } = result;

    if (!jwtToken || !refreshToken) {
      return; // No tokens to refresh
    }

    const isExpired = isTokenExpired(tokenExpiresAt);

    if (isExpired) {
      const success = await refreshAccessToken(refreshToken);
      if (success) {
      }
    }
  } catch (error) {}
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();

    // Update tokens in storage
    await browser.storage.local.set({
      jwtToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: data.expires_at?.toString(),
    });

    return true;
  } catch (error) {
    // Clear invalid tokens
    await browser.storage.local.remove([
      "jwtToken",
      "refreshToken",
      "tokenExpiresAt",
    ]);
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

// Handle messages from popup and content script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refreshToken") {
    checkAndRefreshToken().then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep message channel open for async response
  }

  if (request.action === "checkTokenStatus") {
    // Check if token is expired or will expire soon (within buffer time)
    checkAndRefreshToken().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Handle popup opening - ensure tokens are fresh
browser.browserAction.onClicked.addListener(async () => {
  await checkAndRefreshToken();
});

// Initialize on script load
init();
