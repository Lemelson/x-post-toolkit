"use strict";

(function registerDriveAdapter() {
  const factories = globalThis.XVDL_SITE_ADAPTER_FACTORIES || [];
  globalThis.XVDL_SITE_ADAPTER_FACTORIES = factories;

  factories.push((api) => {
    const DRIVE_FILE_PATH_RE = /\/file\/d\/([a-zA-Z0-9_-]{10,})\b/;
    const DRIVE_FILE_QUERY_RE = /[?&]id=([a-zA-Z0-9_-]{10,})\b/;
    const ITEM_PREFIX_DRIVE = "gdrive:";
    const DRIVE_HOST_ATTR = "data-xvdl-drive-host";
    const DRIVE_CONTROL_LABELS = [
      "Full screen (f)",
      "Exit full screen (f)",
      "Settings",
      "Mute (m)",
      "Unmute (m)"
    ];

    return {
      id: "drive",
      platform: "gdrive",
      match() {
        return location.hostname === "drive.google.com";
      },
      scan() {
        injectDriveButtons();
      },
      getButtonContext() {
        return extractDriveMeta(getPrimaryVideoElement());
      },
      getVisibleContext() {
        return extractDriveMeta(getPrimaryVideoElement());
      }
    };

    function injectDriveButtons() {
      const existing = document.querySelector(`.${api.DRIVE_ACTIONS_CLASS}`);
      const video = getPrimaryVideoElement();
      const meta = extractDriveMeta(video);

      if (!meta.itemId) {
        existing?.remove();
        return;
      }

      let wrapper = existing;
      if (!wrapper) {
        wrapper = api.createActionWrapper(meta, "drive", "drive");
      } else {
        api.syncButtonsMeta(wrapper, meta);
      }

      const inlineTarget = findDriveInlineTarget();
      if (inlineTarget?.container) {
        wrapper.dataset.placement = "inline";
        insertDriveInline(wrapper, inlineTarget.container, inlineTarget.beforeNode);
        return;
      }

      const host = findDriveOverlayHost(video);
      if (!host) {
        return;
      }

      if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
      }
      host.setAttribute(DRIVE_HOST_ATTR, "1");
      wrapper.dataset.placement = "overlay";

      if (wrapper.parentElement !== host) {
        host.appendChild(wrapper);
      }
    }

    function extractDriveMeta(videoEl) {
      const title = extractDriveTitle();
      const itemUrl = extractDriveCanonicalUrl() || location.href;
      const fileId = discoverDriveFileId(videoEl, itemUrl);
      const fallbackKey = `page_${hashString(itemUrl || title || "drive")}`;

      return {
        itemId: `${ITEM_PREFIX_DRIVE}${fileId || fallbackKey}`,
        itemUrl,
        title,
        platform: "gdrive",
        mediaUrl: buildDriveDirectUrl(fileId),
        fileId: fileId || ""
      };
    }

    function extractDriveTitle() {
      const metaTitle =
        document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
        document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ||
        "";
      const heading =
        document.querySelector('h1, [aria-label][role="heading"]')?.textContent ||
        document.querySelector("[data-tooltip]")?.getAttribute("data-tooltip") ||
        "";
      const title = metaTitle || heading || document.title || "";
      return String(title)
        .replace(/\s*-\s*Google Drive\s*$/i, "")
        .trim()
        .slice(0, 180);
    }

    function extractDriveCanonicalUrl() {
      return (
        document.querySelector('link[rel="canonical"]')?.href ||
        document.querySelector('meta[property="og:url"]')?.getAttribute("content") ||
        document.querySelector('meta[name="twitter:url"]')?.getAttribute("content") ||
        location.href
      );
    }

    function discoverDriveFileId(videoEl, canonicalUrl) {
      const docIdEl = document.querySelector("[data-doc-id]");
      if (docIdEl) {
        const docId = docIdEl.getAttribute("data-doc-id");
        if (docId && docId.length >= 10) {
          return docId;
        }
      }

      const candidates = [
        location.href,
        canonicalUrl,
        document.querySelector('meta[property="og:video"]')?.getAttribute("content") || "",
        document.querySelector('meta[property="og:url"]')?.getAttribute("content") || "",
        document.querySelector('link[rel="canonical"]')?.href || "",
        videoEl?.currentSrc || "",
        videoEl?.src || ""
      ];

      for (const link of document.querySelectorAll('a[href*="/file/d/"], a[href*="id="]')) {
        candidates.push(link.href || "");
        if (candidates.length > 24) {
          break;
        }
      }

      for (const candidate of candidates) {
        const fileId = extractDriveFileId(candidate);
        if (fileId) {
          return fileId;
        }
      }

      const headHtml = document.head?.innerHTML || "";
      const pathMatch = headHtml.match(DRIVE_FILE_PATH_RE);
      if (pathMatch) {
        return pathMatch[1];
      }
      const queryMatch = headHtml.match(DRIVE_FILE_QUERY_RE);
      return queryMatch ? queryMatch[1] : "";
    }

    function buildDriveDirectUrl(fileId) {
      if (!fileId) {
        return "";
      }
      return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
    }

    function getPrimaryVideoElement() {
      const videos = Array.from(document.querySelectorAll("video"));
      if (!videos.length) {
        return null;
      }

      let best = null;
      let bestScore = 0;

      for (const video of videos) {
        const rect = video.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        const area = visibleWidth * visibleHeight;
        if (area <= 0) {
          continue;
        }
        if (area > bestScore) {
          best = video;
          bestScore = area;
        }
      }

      return best;
    }

    function findDriveOverlayHost(videoEl) {
      if (!(videoEl instanceof HTMLVideoElement)) {
        return null;
      }

      let node = videoEl.parentElement;
      let best = node;
      const targetRect = videoEl.getBoundingClientRect();

      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (
          rect.width >= targetRect.width * 0.9 &&
          rect.height >= targetRect.height * 0.75
        ) {
          best = node;
        }
      }

      return best || videoEl.parentElement;
    }

    function findDriveInlineTarget() {
      let anchor = null;
      for (const label of DRIVE_CONTROL_LABELS) {
        anchor = document.querySelector(`button[aria-label="${label}"], [role="button"][aria-label="${label}"]`);
        if (anchor) {
          break;
        }
      }

      if (!anchor) {
        return null;
      }

      const row = findDriveControlRow(anchor);
      if (!row) {
        return null;
      }

      const fullscreenBtn = row.querySelector('button[aria-label*="full screen" i], [role="button"][aria-label*="full screen" i]');
      const beforeNode = fullscreenBtn
        ? findDirectChild(row, fullscreenBtn)
        : findDirectChild(row, anchor);

      return {
        container: row,
        beforeNode: beforeNode || null
      };
    }

    function findDriveControlRow(anchor) {
      let node = anchor instanceof Element ? anchor.parentElement : null;

      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        const buttons = node.querySelectorAll('button, [role="button"]');
        const hasMultipleControls = buttons.length >= 3;
        const rect = node.getBoundingClientRect();
        const isWideEnough = rect.width >= 120;
        const isNotTooTall = rect.height <= 120;

        if (hasMultipleControls && isWideEnough && isNotTooTall) {
          return node;
        }
      }

      return null;
    }

    function findDirectChild(container, node) {
      let current = node;
      while (current && current.parentElement && current.parentElement !== container) {
        current = current.parentElement;
      }
      return current && current.parentElement === container ? current : null;
    }

    function insertDriveInline(wrapper, container, beforeNode) {
      if (beforeNode && beforeNode.parentElement === container) {
        if (wrapper.parentElement !== container || wrapper.nextSibling !== beforeNode) {
          container.insertBefore(wrapper, beforeNode);
        }
        return;
      }

      if (wrapper.parentElement !== container) {
        container.appendChild(wrapper);
      }
    }

    function extractDriveFileId(input) {
      const text = String(input || "");
      const pathMatch = text.match(DRIVE_FILE_PATH_RE);
      if (pathMatch) {
        return pathMatch[1];
      }
      const queryMatch = text.match(DRIVE_FILE_QUERY_RE);
      return queryMatch ? queryMatch[1] : null;
    }

    function hashString(value) {
      let hash = 0;
      const text = String(value || "");
      for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
      }
      return Math.abs(hash).toString(36);
    }
  });
})();
