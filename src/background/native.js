"use strict";

export const NATIVE_HOST_NAME = "com.xvdl.transcriber";

export async function runNativeTranscription(itemId, mp4Url) {
  const response = await sendNativeMessage({
    type: "transcribe",
    itemId,
    tweetId: itemId,
    mp4Url,
    copyToClipboard: true
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Native transcriber failed.");
  }

  return {
    text: String(response.transcript || ""),
    charCount: Number(response.charCount || 0),
    preview: String(response.preview || "")
  };
}

export async function debugNativeHost() {
  try {
    const ping = await sendNativeMessage({ type: "ping" });
    return {
      ok: true,
      extensionId: chrome.runtime.id,
      nativeHost: NATIVE_HOST_NAME,
      ping
    };
  } catch (error) {
    return {
      ok: false,
      extensionId: chrome.runtime.id,
      nativeHost: NATIVE_HOST_NAME,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            [
              "Native host is unavailable.",
              `Extension ID: ${chrome.runtime.id}.`,
              "Run setup from the project folder:",
              `./scripts/install_native_host.sh ${chrome.runtime.id}`,
              chrome.runtime.lastError.message
            ].join(" ")
          )
        );
        return;
      }

      resolve(response);
    });
  });
}
