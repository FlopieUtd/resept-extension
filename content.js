const captureHTML = () => {
  const html = document.documentElement.outerHTML;
  const url = window.location.href;
  const title = document.title;
  const timestamp = new Date().toISOString();

  return {
    html,
    url,
    title,
    timestamp,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
};

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureHTML") {
    try {
      const snapshot = captureHTML();
      sendResponse({ success: true, data: snapshot });
    } catch (error) {
      console.error("Error capturing HTML:", error);
      sendResponse({ success: false, error: error.message });
    }
  } else if (request.action === "logToConsole") {
    sendResponse({ success: true });
  }
  return true;
});
