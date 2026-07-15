"use strict";

try {
  const cachedTheme = localStorage.getItem("videoToolkitTheme");
  if (cachedTheme === "light" || cachedTheme === "dark") {
    document.documentElement.dataset.theme = cachedTheme;
  }
} catch (_error) {
  // The popup still boots with the dark fallback when localStorage is unavailable.
}
