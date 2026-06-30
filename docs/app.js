(function () {
  const STORAGE_KEY = "default-contact-reader";
  const MIN_FONT = 16;
  const MAX_FONT = 24;

  const state = {
    manifest: null,
    chapterIndex: 0,
    settings: {
      fontSize: 18,
      theme: "light",
      scrollByChapter: {}
    }
  };

  const els = {
    root: document.documentElement,
    bookTitle: document.getElementById("bookTitle"),
    bookStatus: document.getElementById("bookStatus"),
    chapterCount: document.getElementById("chapterCount"),
    readingPercent: document.getElementById("readingPercent"),
    chapterNav: document.getElementById("chapterNav"),
    chapterKicker: document.getElementById("chapterKicker"),
    toolbarTitle: document.getElementById("toolbarTitle"),
    chapterContent: document.getElementById("chapterContent"),
    progressBar: document.getElementById("progressBar"),
    prevChapter: document.getElementById("prevChapter"),
    nextChapter: document.getElementById("nextChapter"),
    decreaseFont: document.getElementById("decreaseFont"),
    increaseFont: document.getElementById("increaseFont"),
    themeToggle: document.getElementById("themeToggle")
  };

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") {
        state.settings = {
          ...state.settings,
          ...saved,
          scrollByChapter: saved.scrollByChapter || {}
        };
      }
    } catch (_error) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  }

  function applySettings() {
    els.root.style.setProperty("--reader-size", `${state.settings.fontSize}px`);
    els.root.dataset.theme = state.settings.theme;
    els.themeToggle.textContent = state.settings.theme === "dark" ? "日间" : "夜间";
    els.themeToggle.setAttribute("aria-pressed", String(state.settings.theme === "dark"));
    els.decreaseFont.disabled = state.settings.fontSize <= MIN_FONT;
    els.increaseFont.disabled = state.settings.fontSize >= MAX_FONT;
  }

  function setFontSize(nextSize) {
    state.settings.fontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, nextSize));
    applySettings();
    saveSettings();
  }

  function setTheme(theme) {
    state.settings.theme = theme;
    applySettings();
    saveSettings();
  }

  function getChapterFromHash() {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!id || !state.manifest) return -1;
    return state.manifest.chapters.findIndex((chapter) => chapter.id === id);
  }

  function renderNav() {
    const fragment = document.createDocumentFragment();

    state.manifest.chapters.forEach((chapter, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chapter-link";
      button.dataset.index = String(index);
      button.setAttribute("aria-current", index === state.chapterIndex ? "true" : "false");

      const number = document.createElement("span");
      number.className = "chapter-number";
      number.textContent = `第 ${chapter.number} 章`;

      const name = document.createElement("span");
      name.className = "chapter-name";
      name.textContent = chapter.title;

      button.append(number, name);
      button.addEventListener("click", () => loadChapter(index, true));
      fragment.append(button);
    });

    els.chapterNav.replaceChildren(fragment);
  }

  function updateNavState() {
    els.chapterNav.querySelectorAll(".chapter-link").forEach((button, index) => {
      button.setAttribute("aria-current", index === state.chapterIndex ? "true" : "false");
    });
  }

  function updateChapterControls() {
    const chapter = state.manifest.chapters[state.chapterIndex];
    els.chapterKicker.textContent = `第 ${chapter.number} 章`;
    els.toolbarTitle.textContent = chapter.title;
    els.prevChapter.disabled = state.chapterIndex === 0;
    els.nextChapter.disabled = state.chapterIndex === state.manifest.chapters.length - 1;
    document.title = `第 ${chapter.number} 章 ${chapter.title} - ${state.manifest.title}`;
  }

  function renderChapter(rawText) {
    const lines = rawText.replace(/\r\n/g, "\n").split("\n");
    const titleLineIndex = lines.findIndex((line) => line.trim());
    const title = titleLineIndex >= 0 ? lines[titleLineIndex].trim() : "未命名章节";
    const body = lines.slice(titleLineIndex + 1).join("\n").trim();
    const paragraphs = body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);

    const heading = document.createElement("h2");
    heading.textContent = title;
    const meta = document.createElement("div");
    meta.className = "chapter-meta";
    meta.textContent = `默认联系人 / ${title.replace(/^第\s*\d+\s*章\s*/, "")}`;

    const fragment = document.createDocumentFragment();
    fragment.append(meta, heading);

    paragraphs.forEach((paragraph) => {
      const p = document.createElement("p");
      p.textContent = paragraph.replace(/\n+/g, " ");
      fragment.append(p);
    });

    els.chapterContent.replaceChildren(fragment);
  }

  function getScrollRatio() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / scrollable));
  }

  function updateProgress() {
    const ratio = getScrollRatio();
    const percent = `${Math.round(ratio * 1000) / 10}%`;
    els.progressBar.style.width = percent;
    els.readingPercent.textContent = percent;

    const chapter = state.manifest?.chapters[state.chapterIndex];
    if (chapter) {
      state.settings.lastChapter = chapter.id;
      state.settings.scrollByChapter[chapter.id] = ratio;
      saveSettings();
    }
  }

  function restoreScroll(chapterId, shouldReset) {
    requestAnimationFrame(() => {
      if (shouldReset) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        updateProgress();
        return;
      }

      const ratio = state.settings.scrollByChapter[chapterId] || 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Math.max(0, scrollable * ratio), behavior: "auto" });
      updateProgress();
    });
  }

  async function loadChapter(index, shouldResetScroll) {
    const chapter = state.manifest.chapters[index];
    state.chapterIndex = index;
    updateNavState();
    updateChapterControls();
    window.history.replaceState(null, "", `#${encodeURIComponent(chapter.id)}`);

    els.chapterContent.replaceChildren(Object.assign(document.createElement("div"), {
      className: "loading-state",
      textContent: "正在打开章节..."
    }));

    try {
      const response = await fetch(chapter.file, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawText = await response.text();
      renderChapter(rawText);
      restoreScroll(chapter.id, shouldResetScroll);
      els.chapterContent.focus({ preventScroll: true });
    } catch (error) {
      const message = document.createElement("div");
      message.className = "error-state";
      message.textContent = `章节加载失败：${error.message}`;
      els.chapterContent.replaceChildren(message);
    }
  }

  async function init() {
    readSettings();
    applySettings();

    const response = await fetch("chapters/manifest.json", { cache: "no-cache" });
    state.manifest = await response.json();
    els.bookTitle.textContent = state.manifest.title;
    els.bookStatus.textContent = state.manifest.status || "连载中";
    els.chapterCount.textContent = String(state.manifest.chapters.length);

    const hashIndex = getChapterFromHash();
    const savedIndex = state.manifest.chapters.findIndex(
      (chapter) => chapter.id === state.settings.lastChapter
    );
    state.chapterIndex = hashIndex >= 0 ? hashIndex : Math.max(0, savedIndex);

    renderNav();
    await loadChapter(state.chapterIndex, hashIndex >= 0);
  }

  els.prevChapter.addEventListener("click", () => {
    if (state.chapterIndex > 0) loadChapter(state.chapterIndex - 1, true);
  });

  els.nextChapter.addEventListener("click", () => {
    if (state.chapterIndex < state.manifest.chapters.length - 1) {
      loadChapter(state.chapterIndex + 1, true);
    }
  });

  els.decreaseFont.addEventListener("click", () => setFontSize(state.settings.fontSize - 1));
  els.increaseFont.addEventListener("click", () => setFontSize(state.settings.fontSize + 1));
  els.themeToggle.addEventListener("click", () => {
    setTheme(state.settings.theme === "dark" ? "light" : "dark");
  });

  window.addEventListener("scroll", () => {
    window.requestAnimationFrame(updateProgress);
  }, { passive: true });

  window.addEventListener("hashchange", () => {
    const index = getChapterFromHash();
    if (index >= 0 && index !== state.chapterIndex) loadChapter(index, true);
  });

  init().catch((error) => {
    const message = document.createElement("div");
    message.className = "error-state";
    message.textContent = `阅读器初始化失败：${error.message}`;
    els.chapterContent.replaceChildren(message);
  });
}());
