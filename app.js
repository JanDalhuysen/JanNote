const canvas = document.getElementById("inkCanvas");
const context = canvas.getContext("2d");

const strokeLabelInput = document.getElementById("strokeLabel");
const nextPracticeWordBtn = document.getElementById("nextPracticeWordBtn");
const practiceWordText = document.getElementById("practiceWordText");
const clearButton = document.getElementById("clearBtn");
const replayButton = document.getElementById("replayBtn");
const pauseButton = document.getElementById("pauseBtn");
const speedRange = document.getElementById("speedRange");
const speedValue = document.getElementById("speedValue");

const statusText = document.getElementById("statusText");
const sessionText = document.getElementById("sessionText");
const charCount = document.getElementById("charCount");
const wordCount = document.getElementById("wordCount");
const cpmValue = document.getElementById("cpmValue");
const wpmValue = document.getElementById("wpmValue");
const elapsedValue = document.getElementById("elapsedValue");

// Mode & Label UI Elements
const notesModeBtn = document.getElementById("notesModeBtn");
const predictModeBtn = document.getElementById("predictModeBtn");
const datasetModeBtn = document.getElementById("datasetModeBtn");
const datasetSubModeToggle = document.getElementById("datasetSubModeToggle");
const datasetSubModeDivider = document.getElementById("datasetSubModeDivider");
const drawModeBtn = document.getElementById("drawModeBtn");
const labelModeBtn = document.getElementById("labelModeBtn");
const drawControls = document.getElementById("drawControls");
const labelControls = document.getElementById("labelControls");
const activeLabelInput = document.getElementById("activeLabel");
const quickLabelBtns = document.querySelectorAll(".quick-label-btn");
const importDatasetBtn = document.getElementById("importDatasetBtn");
const importDatasetFile = document.getElementById("importDatasetFile");
const exportDatasetBtn = document.getElementById("exportDatasetBtn");
const clearLabelsBtn = document.getElementById("clearLabelsBtn");
const drawingStats = document.getElementById("drawingStats");
const datasetStats = document.getElementById("datasetStats");
const labeledCountEl = document.getElementById("labeledCount");
const samplesBreakdownEl = document.getElementById("samplesBreakdown");
const canvasTip = document.getElementById("canvasTip");
const labelPracticeRow = document.getElementById("labelPracticeRow");
const recognizedWordsPanel = document.getElementById("recognizedWordsPanel");

// Prediction UI Elements
const predictCheckbox = document.getElementById("predictCheckbox");
const continuousModeCheckbox = document.getElementById("continuousModeCheckbox");
const commitWordBtn = document.getElementById("commitWordBtn");
const predictionCard = document.getElementById("predictionCard");
const predictionText = document.getElementById("predictionText");
const predictionConfidenceText = document.getElementById("predictionConfidenceText");
const predictionConfidenceBar = document.getElementById("predictionConfidenceBar");
const predictionBadge = document.getElementById("predictionBadge");
const predictStyleToggle = document.getElementById("predictStyleToggle");
const predictStyleButtons = document.querySelectorAll(".style-btn");

// Note Management UI Elements
const noteTitleInput = document.getElementById("noteTitleInput");
const noteTitleLabel = document.getElementById("noteTitleLabel");
const syncStatusElement = document.getElementById("syncStatus");
const newNoteBtn = document.getElementById("newNoteBtn");
const notesListContainer = document.getElementById("notesList");

const state = {
    strokes: [],
    currentStroke: null,
    drawing: false,
    replaying: false,
    paused: false,
    replayStart: 0,
    replayElapsed: 0,
    replayFrame: 0,
    sessionStart: 0,
    totalCharacters: 0,
    unlabeledStrokes: 0,
    durationMs: 0,
    pointerId: null,
    speed: 1,
    workspaceMode: "notes", // "notes" | "predict" | "dataset"
    mode: "draw", // "draw" or "label"
    activeLabel: "a",
    model: null,
    classNames: [],
    predictMode: true,
    continuousMode: false,
    writingStyle: "print", // "print" | "cursive" | "mixed"
    finalizedLetters: [],
    finalizedWords: [],
    finalizationTimer: null,
    dictionary: new Set(),
    practiceWord: "",
    practiceLetter: "",
    practiceMode: "letter",
    coverageStats: null,

    // Notes & Sync States
    currentNoteId: null,
    lastNoteId: null,
    clientSessionId: "session-" + Math.random().toString(36).substring(2, 9),
    otherUsersStrokes: {},
    isSyncing: false,
    notesList: [],
    datasetsList: [],
    currentDatasetId: null,
    currentDatasetTitle: "",
};

const AUTOSAVE_INTERVAL_MS = 30000;
const AUTOSAVE_SESSION_STORAGE_KEY = "jannote_autosave_session_id";
const autosaveRuntime = {
    sessionId: "",
    intervalId: null,
    inFlight: false,
    pendingBody: "",
    lastSentBody: "",
};

const EASY_CONNECTED_WORDS = [
    "and",
    "he",
    "have",
    "as",
    "on",
    "she",
    "by",
    "we",
    "you",
    "do",
    "or",
    "one",
    "would",
    "all",
    "say",
    "who",
    "when",
    "can",
    "more",
    "no",
    "man",
    "so",
    "up",
    "go",
];

const PRACTICE_LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

function pickRandomDifferent(pool, previousValue) {
    if (!pool || !pool.length) return "";
    const options = pool.filter((v) => v !== previousValue);
    const use = options.length ? options : pool;
    return use[Math.floor(Math.random() * use.length)];
}

function pickRareLetter() {
    const rareLetters = state.coverageStats?.rareLetters;
    if (!Array.isArray(rareLetters) || !rareLetters.length) {
        return pickRandomDifferent(PRACTICE_LETTERS, state.practiceLetter);
    }

    const counts = {};
    for (const item of rareLetters) {
        counts[item.letter] = item.count;
    }

    const complete = PRACTICE_LETTERS.map((letter) => ({
        letter,
        count: counts[letter] ?? 0,
    })).sort((a, b) => a.count - b.count || a.letter.localeCompare(b.letter));

    const topRare = complete.slice(0, Math.min(8, complete.length)).map((item) => item.letter);
    return pickRandomDifferent(topRare, state.practiceLetter);
}

function pickRareWord() {
    const rareWords = state.coverageStats?.rareWords;
    if (!Array.isArray(rareWords) || !rareWords.length) {
        return pickRandomDifferent(EASY_CONNECTED_WORDS, state.practiceWord);
    }

    const easySet = new Set(EASY_CONNECTED_WORDS.map((w) => w.toLowerCase()));
    const candidateObjects = rareWords
        .filter((item) => easySet.has(item.word) && item.word.length >= 2 && item.word.length <= 8)
        .slice(0, 40);

    if (!candidateObjects.length) {
        return pickRandomDifferent(EASY_CONNECTED_WORDS, state.practiceWord);
    }

    const pool = candidateObjects.map((item) => item.word);
    return pickRandomDifferent(pool, state.practiceWord);
}

function isPredictionWorkspace() {
    return state.workspaceMode === "dataset" || state.workspaceMode === "predict";
}

function isNoteWorkspace() {
    return state.workspaceMode === "notes" || state.workspaceMode === "predict";
}

function getAllStrokes() {
    const all = [];
    if (state.finalizedWords) {
        for (const item of state.finalizedWords) {
            all.push(...item.strokes);
        }
    }
    if (state.finalizedLetters) {
        for (const item of state.finalizedLetters) {
            all.push(...item.strokes);
        }
    }
    if (state.strokes) {
        all.push(...state.strokes);
    }
    return all.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
}

function getCanvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        time: performance.now() - state.sessionStart,
    };
}

function getLabelMetrics(label) {
    const trimmed = label.trim();
    if (!trimmed) {
        return { characters: 0, words: 0 };
    }

    return {
        characters: trimmed.replace(/\s+/g, "").length,
        words: trimmed.split(/\s+/).filter(Boolean).length,
    };
}

function getStrokeBounds(stroke) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const point of stroke.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function getStrokeCenter(stroke) {
    const bounds = getStrokeBounds(stroke);
    return {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };
}

function getStrokeSpan(stroke) {
    const bounds = getStrokeBounds(stroke);
    return Math.hypot(bounds.width, bounds.height);
}

function getAdaptiveFinalizeDelayMs(stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) {
        return 220;
    }

    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    const dt = Math.max(1, last.time - first.time);
    const distance = Math.hypot(last.x - first.x, last.y - first.y);
    const speed = distance / dt;

    if (speed > 0.75) return 150;
    if (speed > 0.35) return 190;
    return 230;
}

function guessWordCount(strokes) {
    if (!strokes.length) {
        return 0;
    }

    let wordCount = 1;
    let previousStroke = strokes[0];

    for (let index = 1; index < strokes.length; index += 1) {
        const stroke = strokes[index];
        const previousCenter = getStrokeCenter(previousStroke);
        const currentCenter = getStrokeCenter(stroke);
        const centerDistance = Math.hypot(currentCenter.x - previousCenter.x, currentCenter.y - previousCenter.y);
        const gapMs = (stroke.startedAt ?? stroke.completedAt) - (previousStroke.completedAt ?? previousStroke.startedAt);
        const sizeGate = Math.max(48, getStrokeSpan(previousStroke) * 1.35, getStrokeSpan(stroke) * 1.35);
        const closeInSpace = centerDistance <= sizeGate;
        const hugePause = gapMs > 4000;
        const isBackwardStroke = currentCenter.x < previousCenter.x - 10;

        if ((!closeInSpace && !isBackwardStroke) || hugePause) {
            wordCount += 1;
        }

        previousStroke = stroke;
    }

    return wordCount;
}

function updateStats() {
    const allStrokes = getAllStrokes();
    const elapsedMs = state.sessionStart ? Math.max(1, state.durationMs || performance.now() - state.sessionStart) : 0;
    const elapsedMinutes = elapsedMs / 60000;

    const guessedWords = guessWordCount(allStrokes);
    const estimatedUnlabeledChars = Math.round(state.unlabeledStrokes / 1.2);
    const totalChars = Math.max(guessedWords, state.totalCharacters + estimatedUnlabeledChars);

    const charactersPerMinute = elapsedMinutes > 0 ? totalChars / elapsedMinutes : 0;
    const wordsPerMinute = elapsedMinutes > 0 ? guessedWords / elapsedMinutes : 0;

    charCount.textContent = String(totalChars);
    wordCount.textContent = String(guessedWords);
    cpmValue.textContent = charactersPerMinute.toFixed(1);
    wpmValue.textContent = wordsPerMinute.toFixed(1);
    elapsedValue.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;
    sessionText.textContent = `${allStrokes.length} stroke${allStrokes.length === 1 ? "" : "s"}`;

    // Update Dataset Stats
    const totalStrokes = allStrokes.length;
    const labeledStrokes = allStrokes.filter((s) => s.label).length;
    labeledCountEl.textContent = `${labeledStrokes} / ${totalStrokes}`;

    // Compute breakdown of labels
    const counts = {};
    for (const stroke of allStrokes) {
        if (stroke.label) {
            counts[stroke.label] = (counts[stroke.label] || 0) + 1;
        }
    }

    // Render breakdown badges
    const sortedLabels = Object.keys(counts).sort();
    if (sortedLabels.length === 0) {
        samplesBreakdownEl.innerHTML = `<span class="breakdown-empty">No labels applied yet. Click strokes to label.</span>`;
    } else {
        samplesBreakdownEl.innerHTML = sortedLabels
            .map(
                (label) => `
            <div class="breakdown-badge">
                <span class="badge-char">${escapeHTML(label)}</span>
                <span class="badge-count">${counts[label]}</span>
            </div>
        `,
            )
            .join("");
    }
}

function escapeHTML(str) {
    return str.replace(
        /[&<>'"]/g,
        (tag) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[tag] || tag,
    );
}

async function loadDictionary() {
    try {
        console.log("[Client] Loading words dictionary...");
        const response = await fetch("/seamless_words.txt");
        if (response.ok) {
            const text = await response.text();
            const words = text
                .split("\n")
                .map((w) => w.trim().toLowerCase())
                .filter(Boolean);
            state.dictionary = new Set(words);
            console.log(`[Client] Loaded ${state.dictionary.size} words into dictionary.`);
            updateRecognizedWords();
        } else {
            console.warn("[Client] Failed to load seamless_words.txt from server:", response.statusText);
        }
    } catch (error) {
        console.error("Failed to load dictionary:", error);
    }
}

async function loadCoveragePrompts() {
    try {
        const response = await fetch("/practice-prompts");
        if (!response.ok) {
            console.warn("[Client] Failed to load /practice-prompts:", response.statusText);
            return;
        }
        const stats = await response.json();
        state.coverageStats = stats;
        console.log(
            `[Client] Coverage prompts loaded. files=${stats.sourceFileCount}, words=${stats.uniqueWords}, letters=${stats.rareLetters?.length || 0}`,
        );
    } catch (error) {
        console.warn("[Client] Coverage prompts unavailable:", error);
    }
}

function groupLettersIntoWords() {
    if (!state.finalizedLetters || state.finalizedLetters.length === 0) {
        return [];
    }

    const letters = [...state.finalizedLetters].sort((a, b) => {
        const tA = a.strokes[0]?.startedAt || 0;
        const tB = b.strokes[0]?.startedAt || 0;
        return tA - tB;
    });

    const words = [];
    let currentWord = [letters[0]];

    for (let i = 1; i < letters.length; i++) {
        const prev = letters[i - 1];
        const curr = letters[i];

        const prevBounds = prev.bounds;
        const currBounds = curr.bounds;

        const prevRight = prevBounds.maxX;
        const currLeft = currBounds.minX;

        const xGap = currLeft - prevRight;

        const prevTime = prev.strokes[prev.strokes.length - 1]?.completedAt || 0;
        const currTime = curr.strokes[0]?.startedAt || 0;
        const timeGap = currTime - prevTime;

        const isBackwards = currLeft < prevBounds.minX;

        const avgWidth = (prevBounds.width + currBounds.width) / 2;
        const spaceThreshold = Math.max(35, avgWidth * 1.2);

        if (xGap > spaceThreshold || timeGap > 4000 || isBackwards) {
            words.push(currentWord);
            currentWord = [curr];
        } else {
            currentWord.push(curr);
        }
    }
    words.push(currentWord);

    return words;
}

function updateRecognizedWords() {
    const sentenceBox = document.getElementById("reconstructedSentence");
    const breakdownList = document.getElementById("wordBreakdownList");

    if (!sentenceBox || !breakdownList) return;

    if (state.finalizedWords && state.finalizedWords.length > 0) {
        const words = [...state.finalizedWords].sort((a, b) => {
            const tA = a.strokes[0]?.startedAt || 0;
            const tB = b.strokes[0]?.startedAt || 0;
            return tA - tB;
        });

        const wordsData = words.map((w) => {
            const text = (w.label || w.prediction || "?").trim() || "?";
            const lower = text.toLowerCase();
            const isOk = w.label ? state.dictionary.has(lower) : true;
            return {
                text,
                isOk,
                charCount: w.label ? w.label.replace(/\s+/g, "").length : 0,
            };
        });

        sentenceBox.innerHTML = wordsData
            .map((wd) => {
                const spellErrorClass = wd.isOk ? "" : " spell-error";
                const titleAttr = wd.isOk ? "" : ` title="Not found in words file"`;
                const escaped = escapeHTML(wd.text);
                return `<span class="word-span${spellErrorClass}"${titleAttr}>${escaped}</span>`;
            })
            .join(" ");

        breakdownList.innerHTML = wordsData
            .map((wd) => {
                const rowClass = wd.isOk ? "" : " spell-error";
                const textClass = wd.isOk ? "" : " spell-error";
                const icon = wd.isOk
                    ? `<span class="word-status-icon ok" title="Verified in dictionary">Verified</span>`
                    : `<span class="word-status-icon err" title="Not found in words file">Not found</span>`;
                const escaped = escapeHTML(wd.text);
                return `
            <div class="word-breakdown-row${rowClass}">
                <span class="word-breakdown-text${textClass}">${escaped}</span>
                <span class="word-breakdown-meta">
                    <span>${wd.charCount} char${wd.charCount === 1 ? "" : "s"}</span>
                    ${icon}
                </span>
            </div>
        `;
            })
            .join("");
        return;
    }

    const wordGroups = groupLettersIntoWords();

    if (wordGroups.length === 0) {
        sentenceBox.innerHTML = `<span class="text-empty">Start drawing to see text...</span>`;
        breakdownList.innerHTML = `<span class="breakdown-empty">No words grouped yet.</span>`;
        return;
    }

    const wordsData = wordGroups.map((group) => {
        const text = group
            .map((l) => l.label || l.prediction || "?")
            .join("")
            .trim();
        const lowercaseText = text.toLowerCase();
        const isOk = state.dictionary.has(lowercaseText);
        return {
            text,
            isOk,
            charCount: group.length,
            letters: group,
        };
    });

    sentenceBox.innerHTML = wordsData
        .map((wd) => {
            const spellErrorClass = wd.isOk ? "" : " spell-error";
            const titleAttr = wd.isOk ? "" : ` title="Not found in words file"`;
            const escaped = escapeHTML(wd.text);
            return `<span class="word-span${spellErrorClass}"${titleAttr}>${escaped}</span>`;
        })
        .join(" ");

    breakdownList.innerHTML = wordsData
        .map((wd) => {
            const rowClass = wd.isOk ? "" : " spell-error";
            const textClass = wd.isOk ? "" : " spell-error";
            const icon = wd.isOk
                ? `<span class="word-status-icon ok" title="Verified in dictionary">Verified</span>`
                : `<span class="word-status-icon err" title="Not found in words file">Not found</span>`;
            const escaped = escapeHTML(wd.text);
            return `
            <div class="word-breakdown-row${rowClass}">
                <span class="word-breakdown-text${textClass}">${escaped}</span>
                <span class="word-breakdown-meta">
                    <span>${wd.charCount} char${wd.charCount === 1 ? "" : "s"}</span>
                    ${icon}
                </span>
            </div>
        `;
        })
        .join("");
}

function buildImportedItem(sample, currentOffset, labelValue) {
    const rawSource = Array.isArray(sample.rawStrokes)
        ? sample.rawStrokes
        : Array.isArray(sample.normalizedStrokes)
          ? sample.normalizedStrokes
          : null;
    if (!rawSource) {
        return null;
    }

    // Find the min original time in the sample to calculate duration relative to offset
    let sampleMinTime = Infinity;
    let sampleMaxOrigTime = -Infinity;
    for (const s of rawSource) {
        const points = Array.isArray(s?.points) ? s.points : Array.isArray(s) ? s : [];
        if (points.length) {
            for (let idx = 0; idx < points.length; idx++) {
                const pt = points[idx];
                const timeValue = Number.isFinite(pt.time) ? pt.time : idx;
                if (timeValue < sampleMinTime) sampleMinTime = timeValue;
                if (timeValue > sampleMaxOrigTime) sampleMaxOrigTime = timeValue;
            }
        }
    }
    if (sampleMinTime === Infinity) {
        sampleMinTime = 0;
        sampleMaxOrigTime = 0;
    }

    const sampleDuration = sampleMaxOrigTime - sampleMinTime;

    // Construct finalized strokes for this sample
    const sampleStrokes = rawSource.map((rawStroke) => {
        let strokeMinTime = Infinity;
        let strokeMaxTime = -Infinity;

        const rawPoints = Array.isArray(rawStroke?.points) ? rawStroke.points : Array.isArray(rawStroke) ? rawStroke : [];
        const points = rawPoints.map((pt, idx) => {
            const timeValue = Number.isFinite(pt.time) ? pt.time : idx;
            const adjustedTime = timeValue - sampleMinTime + currentOffset;
            strokeMinTime = Math.min(strokeMinTime, adjustedTime);
            strokeMaxTime = Math.max(strokeMaxTime, adjustedTime);
            return {
                x: pt.x,
                y: pt.y,
                time: adjustedTime,
            };
        });

        if (strokeMinTime === Infinity) {
            strokeMinTime = currentOffset;
            strokeMaxTime = currentOffset;
        }

        return {
            label: labelValue || "",
            startedAt: strokeMinTime,
            completedAt: strokeMaxTime,
            points: points,
            isFinalized: true,
        };
    });

    // Calculate bounding box for this sample
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const s of sampleStrokes) {
        const b = getStrokeBounds(s);
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
    }

    const bounds = {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
    };

    return {
        duration: sampleDuration,
        strokes: sampleStrokes,
        bounds,
    };
}

function setStatus(message) {
    statusText.textContent = message;
}

function setContinuousMode(enabled) {
    state.continuousMode = enabled;
    if (continuousModeCheckbox) {
        continuousModeCheckbox.checked = enabled;
    }
}

function syncPredictControlsVisibility() {
    const isPredict = state.workspaceMode === "predict";
    if (predictStyleToggle) {
        predictStyleToggle.classList.toggle("hidden", !isPredict);
    }

    const continuousToggle = continuousModeCheckbox ? continuousModeCheckbox.closest("label") : null;
    const showContinuousToggle = state.workspaceMode === "dataset" || (isPredict && state.writingStyle === "mixed");
    if (continuousToggle) {
        continuousToggle.classList.toggle("hidden", !showContinuousToggle);
    }

    if (commitWordBtn) {
        const showCommit = state.workspaceMode === "dataset" || (isPredict && state.writingStyle !== "print");
        commitWordBtn.classList.toggle("hidden", !showCommit);
    }
}

function setWritingStyle(style, { applyDefaults = true } = {}) {
    if (!style) return;
    const normalized = String(style).toLowerCase();
    if (!"print|cursive|mixed".includes(normalized)) return;

    state.writingStyle = normalized;
    predictStyleButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.style === normalized);
    });

    if (applyDefaults) {
        if (normalized === "print") {
            setContinuousMode(false);
            setStatus("Print mode: auto-finalize each character.");
        } else if (normalized === "cursive") {
            setContinuousMode(true);
            setStatus("Cursive mode: write connected text, then click Commit Word.");
        } else {
            setContinuousMode(false);
            setStatus("Mixed mode: write print or toggle Continuous Script for cursive.");
        }
    }

    syncPredictControlsVisibility();
}

function pickNextPracticeWord() {
    if (state.workspaceMode !== "dataset" || !EASY_CONNECTED_WORDS.length) return;

    state.practiceMode = state.practiceMode === "word" ? "letter" : "word";

    if (state.practiceMode === "letter") {
        setContinuousMode(false);
        const letter = pickRareLetter();
        state.practiceLetter = letter;
        if (practiceWordText) {
            const count = state.coverageStats?.rareLetters?.find((x) => x.letter === letter)?.count;
            const suffix = Number.isFinite(count) ? ` (count: ${count})` : "";
            practiceWordText.textContent = `Practice letter: ${letter}${suffix}`;
        }
        if (strokeLabelInput) {
            strokeLabelInput.value = letter;
        }
        setActiveLabel(letter);
        setStatus(`Practice prompt ready: "${letter}". Draw a single letter and lift to finalize.`);
        return;
    }

    setContinuousMode(true);
    const word = pickRareWord();
    state.practiceWord = word;
    if (practiceWordText) {
        const count = state.coverageStats?.rareWords?.find((x) => x.word === word)?.count;
        const suffix = Number.isFinite(count) ? ` (count: ${count})` : "";
        practiceWordText.textContent = `Practice word: ${word}${suffix}`;
    }
    if (strokeLabelInput) {
        strokeLabelInput.value = word;
    }
    setStatus(`Practice prompt ready: "${word}". Write it in one connected stroke sequence, then Commit Word.`);
}

function updatePredictionBadge(data) {
    if (!predictionBadge) return;
    if (!data || data.mode !== "hybrid") {
        predictionBadge.classList.add("hidden");
        predictionBadge.classList.remove("is-muted");
        predictionBadge.textContent = "";
        return;
    }

    let text = "";
    let muted = false;
    if (data.charUsed === false) {
        const reason = (data.charIgnoredReason || "char-ignored").replace(/-/g, " ");
        text = `Char ignored: ${reason}`;
        muted = true;
    } else if (data.decision === "agree") {
        text = "Models agree";
    } else if (data.decision === "sequence") {
        text = "Sequence chosen";
    } else if (data.decision === "char") {
        text = "Char chosen";
    }

    if (!text) {
        predictionBadge.classList.add("hidden");
        predictionBadge.classList.remove("is-muted");
        predictionBadge.textContent = "";
        return;
    }

    predictionBadge.textContent = text;
    predictionBadge.classList.toggle("is-muted", muted);
    predictionBadge.classList.remove("hidden");
}

function redraw(activeTime = null) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3.5;
    context.strokeStyle = "#eaf6ff";
    context.shadowColor = "rgba(56, 189, 248, 0.25)";
    context.shadowBlur = 8;

    // 1. Draw finalized letters (strokes + prediction/ground-truth labels above them)
    if (state.finalizedLetters && state.finalizedLetters.length > 0) {
        for (const item of state.finalizedLetters) {
            // Draw strokes for this letter
            for (const stroke of item.strokes) {
                drawStroke(stroke, activeTime);
            }

            // Draw badge above bounding box
            const b = item.bounds;
            if (b.width > 0 && b.height > 0 && b.minX !== Infinity) {
                if (!isPredictionWorkspace() && !item.label) {
                    continue;
                }
                // If replaying, only draw badge and bounding box if the whole letter is replayed
                if (activeTime != null) {
                    const lastStroke = item.strokes[item.strokes.length - 1];
                    const lastPointTime = lastStroke?.completedAt || 0;
                    if (activeTime < lastPointTime) {
                        continue;
                    }
                }

                context.save();

                let text = "";
                let badgeColor = "";
                let textColor = "#0f172a"; // Dark slate
                let shadowColor = "";

                if (state.mode === "label") {
                    if (item.label) {
                        text = item.label;
                        badgeColor = "rgba(52, 211, 153, 0.95)"; // Emerald green
                        shadowColor = "rgba(52, 211, 153, 0.4)";
                    } else {
                        text = "?";
                        badgeColor = "rgba(148, 163, 184, 0.95)"; // Gray
                        shadowColor = "rgba(148, 163, 184, 0.4)";
                    }
                } else {
                    // Draw mode
                    if (item.label) {
                        text = item.label;
                        badgeColor = "rgba(52, 211, 153, 0.95)"; // Emerald green
                        shadowColor = "rgba(52, 211, 153, 0.4)";
                    } else {
                        text = item.prediction || "?";
                        badgeColor = "rgba(56, 189, 248, 0.95)"; // Bright sky-blue
                        shadowColor = "rgba(56, 189, 248, 0.4)";
                    }
                }

                context.font = "bold 16px 'Outfit', 'Inter', sans-serif";

                // Measure text width to size the badge
                const textWidth = context.measureText(text).width;
                const badgeW = Math.max(26, textWidth + 16);
                const badgeH = 26;
                const centerX = b.minX + b.width / 2;
                const centerY = b.minY - 10; // 10px above the bounding box

                // Draw rounded rectangle badge background
                context.beginPath();
                if (typeof context.roundRect === "function") {
                    context.roundRect(centerX - badgeW / 2, centerY - badgeH, badgeW, badgeH, 6);
                } else {
                    context.rect(centerX - badgeW / 2, centerY - badgeH, badgeW, badgeH);
                }
                context.fillStyle = badgeColor;
                context.shadowColor = shadowColor;
                context.shadowBlur = 6;
                context.fill();

                // Draw text inside badge
                context.shadowBlur = 0; // Disable shadow for text for sharpness
                context.fillStyle = textColor;
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText(text, centerX, centerY - badgeH / 2);

                // Draw a very subtle dashed bounding box around the letter for visualization
                if (state.mode === "label" && !item.label) {
                    context.strokeStyle = "rgba(148, 163, 184, 0.3)";
                } else if (item.label) {
                    context.strokeStyle = "rgba(52, 211, 153, 0.3)";
                } else {
                    context.strokeStyle = "rgba(56, 189, 248, 0.3)";
                }
                context.lineWidth = 1;
                context.setLineDash([4, 4]);
                context.strokeRect(b.minX, b.minY, b.width, b.height);

                context.restore();
            }
        }
    }

    // 2. Draw active strokes currently being drawn
    if (state.finalizedWords && state.finalizedWords.length > 0) {
        for (const item of state.finalizedWords) {
            for (const stroke of item.strokes) {
                drawStroke(stroke, activeTime);
            }
        }
    }

    if (state.finalizedWords && state.finalizedWords.length > 0) {
        for (const item of state.finalizedWords) {
            drawWordBoundaryMarkers(item);
        }
    }

    // 3. Draw active strokes currently being drawn
    for (const stroke of state.strokes) {
        drawStroke(stroke, activeTime);
    }

    if (state.currentStroke) {
        drawStroke(state.currentStroke, activeTime);
    }

    // 4. Draw other users' active drawing strokes
    if (state.otherUsersStrokes) {
        for (const sessionId in state.otherUsersStrokes) {
            const data = state.otherUsersStrokes[sessionId];
            const color = getUserColor(sessionId);
            if (data.strokes) {
                for (const stroke of data.strokes) {
                    drawStroke(stroke, activeTime, color);
                }
            }
            if (data.currentStroke) {
                drawStroke(data.currentStroke, activeTime, color);
            }
        }
    }
}

const USER_COLORS = ["#a855f7", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#3b82f6"];
function getUserColor(sessionId) {
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
        hash = sessionId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % USER_COLORS.length;
    return USER_COLORS[idx];
}

function drawStroke(stroke, activeTime, color) {
    const points = stroke.points;
    if (points.length === 0) {
        return;
    }

    let visibleCount = points.length;
    if (activeTime != null) {
        visibleCount = points.findIndex((point) => point.time > activeTime);
        visibleCount = visibleCount === -1 ? points.length : Math.max(0, visibleCount);
    }

    if (visibleCount === 0) {
        return;
    }

    context.save();

    // Customize stroke colors based on labeling
    if (color) {
        context.strokeStyle = color;
        context.shadowColor = color + "40"; // neon transparent shadow
    } else if (state.mode === "label" && stroke.label) {
        context.strokeStyle = "#34d399"; // emerald green
        context.shadowColor = "rgba(52, 211, 153, 0.4)";
    } else {
        context.strokeStyle = "#eaf6ff";
        context.shadowColor = "rgba(56, 189, 248, 0.25)";
    }

    if (visibleCount === 1) {
        context.beginPath();
        context.arc(points[0].x, points[0].y, context.lineWidth / 2, 0, Math.PI * 2);
        context.fillStyle = context.strokeStyle;
        context.fill();
        context.restore();

        drawStrokeTag(stroke);
        return;
    }

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < visibleCount; index += 1) {
        context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
    context.restore();

    drawStrokeTag(stroke);
}

function drawStrokeTag(stroke) {
    // Only draw stroke-level tags for non-finalized strokes to avoid clutter
    if (state.mode === "label" && stroke.label && !stroke.isFinalized) {
        const center = getStrokeCenter(stroke);
        context.save();
        context.shadowColor = "transparent";
        context.shadowBlur = 0;

        context.font = "bold 12px Inter, sans-serif";
        const textWidth = context.measureText(stroke.label).width;
        const padX = 6;
        const padY = 3;
        const rectW = textWidth + padX * 2;
        const rectH = 14 + padY * 2;
        const rectX = center.x - rectW / 2;
        const rectY = center.y - rectH / 2;

        context.fillStyle = "rgba(16, 185, 129, 0.85)"; // Emerald background
        context.beginPath();
        context.roundRect(rectX, rectY, rectW, rectH, 6);
        context.fill();

        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(stroke.label, center.x, center.y + 0.5);
        context.restore();
    }
}

function getFlattenedPointsFromStrokes(strokes) {
    const points = [];
    for (const stroke of strokes || []) {
        for (const pt of stroke.points || []) {
            points.push(pt);
        }
    }
    points.sort((a, b) => (a.time || 0) - (b.time || 0));
    return points;
}

function drawWordBoundaryMarkers(wordItem) {
    if (!wordItem || !Array.isArray(wordItem.letterSpans) || wordItem.letterSpans.length === 0) {
        return;
    }

    const flattened = getFlattenedPointsFromStrokes(wordItem.strokes);
    if (flattened.length < 2) return;

    const usedTimesteps = Math.max(1, wordItem.usedTimesteps || 192);
    const bounds = wordItem.bounds || getStrokeBounds({ points: flattened });

    context.save();
    context.shadowBlur = 0;
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(250, 204, 21, 0.95)";
    context.fillStyle = "rgba(250, 204, 21, 0.95)";
    context.font = "bold 11px Inter, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";

    for (const span of wordItem.letterSpans) {
        const endStep = Math.max(0, Math.min(usedTimesteps - 1, span.endStep ?? 0));
        const frac = usedTimesteps > 1 ? endStep / (usedTimesteps - 1) : 0;
        const idx = Math.max(0, Math.min(flattened.length - 1, Math.round(frac * (flattened.length - 1))));
        const anchor = flattened[idx];

        context.beginPath();
        context.moveTo(anchor.x, bounds.minY - 2);
        context.lineTo(anchor.x, bounds.maxY + 2);
        context.stroke();
        context.fillText(span.char || "?", anchor.x, bounds.minY - 8);
    }
    context.restore();
}

function finishStroke() {
    if (!state.currentStroke) {
        return;
    }

    const stroke = state.currentStroke;
    const metrics = getLabelMetrics(stroke.label);
    stroke.completedAt = stroke.points[stroke.points.length - 1].time;
    state.strokes.push(stroke);
    state.currentStroke = null;
    state.drawing = false;
    state.pointerId = null;
    if (metrics.characters > 0) {
        state.totalCharacters += metrics.characters;
    } else {
        state.unlabeledStrokes += 1;
    }
    state.durationMs = Math.max(state.durationMs, stroke.completedAt);
    if (!state.continuousMode) {
        strokeLabelInput.value = "";
    }
    setStatus("Ready to draw");
    replayButton.disabled = false;
    updateStats();
    redraw();

    if (state.finalizationTimer) {
        clearTimeout(state.finalizationTimer);
    }
    if (!state.continuousMode) {
        const delayMs = getAdaptiveFinalizeDelayMs(stroke);
        state.finalizationTimer = setTimeout(finalizeCurrentLetter, delayMs);
    }

    if (!state.predictMode || !isPredictionWorkspace()) {
        clearPredictionDisplay();
    }
}

function startStroke(event) {
    if (state.finalizationTimer) {
        clearTimeout(state.finalizationTimer);
        state.finalizationTimer = null;
    }

    if (state.replaying) {
        stopReplay();
    }

    if (state.mode === "label") {
        handleLabelClick(event);
        return;
    }

    // Spatial boundary finalization check (for fast writing support)
    if (!state.continuousMode && state.strokes.length > 0) {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        for (const s of state.strokes) {
            const b = getStrokeBounds(s);
            minX = Math.min(minX, b.minX);
            minY = Math.min(minY, b.minY);
            maxX = Math.max(maxX, b.maxX);
            maxY = Math.max(maxY, b.maxY);
        }
        const width = maxX - minX;
        const clickPt = getCanvasPoint(event);

        const isHorizontalGap = clickPt.x > maxX + Math.max(15, width * 0.15);
        const isNewLine = clickPt.y > maxY + 40 || clickPt.x < minX - 45;

        if (isHorizontalGap || isNewLine) {
            console.log("[Client] Spatial boundary detected! Finalizing letter immediately.");
            finalizeCurrentLetter();
        }
    }

    if (!state.sessionStart) {
        state.sessionStart = performance.now();
    }

    const point = getCanvasPoint(event);
    state.currentStroke = {
        label: strokeLabelInput.value,
        startedAt: point.time,
        completedAt: point.time,
        points: [point],
    };
    state.drawing = true;
    state.pointerId = event.pointerId;
    setStatus(state.currentStroke.label.trim() ? `Writing ${state.currentStroke.label.trim()}` : "Writing stroke");
    canvas.setPointerCapture(event.pointerId);
}

function handleLabelClick(event) {
    const clickPt = getCanvasPoint(event);
    let closestStroke = null;
    let closestGroup = null;
    let closestWordGroup = null;
    let minDistance = Infinity;

    // Check active strokes
    for (const stroke of state.strokes) {
        const dist = getMinDistanceToStroke(clickPt, stroke);
        if (dist < minDistance) {
            minDistance = dist;
            closestStroke = stroke;
            closestGroup = null;
        }
    }

    // Check finalized letters' strokes
    if (state.finalizedLetters) {
        for (const item of state.finalizedLetters) {
            for (const stroke of item.strokes) {
                const dist = getMinDistanceToStroke(clickPt, stroke);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestStroke = stroke;
                    closestGroup = item;
                }
            }
        }
    }

    // Check finalized connected words' strokes
    if (state.finalizedWords) {
        for (const item of state.finalizedWords) {
            for (const stroke of item.strokes) {
                const dist = getMinDistanceToStroke(clickPt, stroke);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestStroke = stroke;
                    closestGroup = null;
                    closestWordGroup = item;
                }
            }
        }
    }

    if (closestStroke && minDistance < 18) {
        if (closestWordGroup) {
            const typedWord = (strokeLabelInput.value || "").trim();
            const newLabel = typedWord || closestWordGroup.label || "";
            closestWordGroup.label = newLabel;
            for (const s of closestWordGroup.strokes) {
                s.label = newLabel;
            }
            if (typedWord) {
                setStatus(`Word labeled as "${typedWord}"`);
            } else {
                setStatus("Type a word in the label box, then click the connected word to label it.");
            }
            redraw();
            updateStats();
            updateRecognizedWords();
            pushLabelsToServer();
            return;
        }

        if (closestGroup) {
            const currentLabel = closestGroup.label || "";
            const newLabel = currentLabel === state.activeLabel ? "" : state.activeLabel;
            closestGroup.label = newLabel;
            for (const s of closestGroup.strokes) {
                s.label = newLabel;
            }
        } else {
            const currentLabel = closestStroke.label || "";
            closestStroke.label = currentLabel === state.activeLabel ? "" : state.activeLabel;
        }
        redraw();
        updateStats();
        updateRecognizedWords();
        pushLabelsToServer();
    }
}

function pushLabelsToServer() {
    if (state.currentNoteId) {
        fetch(`/api/notes/${state.currentNoteId}/update-labels`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                finalizedLetters: state.finalizedLetters,
                finalizedWords: state.finalizedWords,
            }),
        }).catch((err) => console.error("Failed to update labels on server:", err));
    }
}

function getMinDistanceToStroke(clickPt, stroke) {
    let minD = Infinity;
    const points = stroke.points;
    if (points.length === 0) return Infinity;
    if (points.length === 1) {
        return Math.hypot(clickPt.x - points[0].x, clickPt.y - points[0].y);
    }
    for (let i = 0; i < points.length - 1; i++) {
        const d = getSegDist(clickPt, points[i], points[i + 1]);
        if (d < minD) {
            minD = d;
        }
    }
    return minD;
}

function getSegDist(p, p1, p2) {
    const x = p1.x,
        y = p1.y,
        dx = p2.x - x,
        dy = p2.y - y;

    if (dx !== 0 || dy !== 0) {
        let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
            return Math.hypot(p.x - p2.x, p.y - p2.y);
        } else if (t > 0) {
            return Math.hypot(p.x - (x + dx * t), p.y - (y + dy * t));
        }
    }
    return Math.hypot(p.x - x, p.y - y);
}

function extendStroke(event) {
    if (!state.drawing || state.pointerId !== event.pointerId || !state.currentStroke) {
        return;
    }

    const point = getCanvasPoint(event);
    const lastPoint = state.currentStroke.points[state.currentStroke.points.length - 1];
    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    if (distance < 0.75) {
        return;
    }

    state.currentStroke.points.push(point);
    state.currentStroke.completedAt = point.time;
    redraw();
}

function stopStroke(event) {
    if (!state.drawing || state.pointerId !== event.pointerId) {
        return;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }

    finishStroke();
}

function clearCanvas() {
    state.strokes = [];
    state.finalizedLetters = [];
    state.finalizedWords = [];
    if (state.finalizationTimer) {
        clearTimeout(state.finalizationTimer);
        state.finalizationTimer = null;
    }
    state.currentStroke = null;
    state.drawing = false;
    state.replaying = false;
    state.paused = false;
    state.replayStart = 0;
    state.replayElapsed = 0;
    state.replayFrame = 0;
    state.sessionStart = 0;
    state.totalCharacters = 0;
    state.unlabeledStrokes = 0;
    state.durationMs = 0;
    state.pointerId = null;
    statusText.textContent = "Ready to draw";
    replayButton.disabled = true;
    replayButton.textContent = "Replay";
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";
    updateStats();
    redraw();
    clearPredictionDisplay();
    updateRecognizedWords();

    if (state.currentNoteId) {
        fetch(`/api/notes/${state.currentNoteId}/clear`, { method: "POST" }).catch((err) =>
            console.error("Failed to clear note on server:", err),
        );
    }
}

function stopReplay() {
    if (state.replayFrame) {
        cancelAnimationFrame(state.replayFrame);
    }

    state.replaying = false;
    state.paused = false;
    state.replayFrame = 0;
    state.replayStart = 0;
    state.replayElapsed = 0;
    replayButton.textContent = "Replay";
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";
    setStatus("Ready to draw");
    redraw();
    updateStats();
}

function replayLoop(frameTime) {
    if (!state.replaying || state.paused) {
        return;
    }

    const baseElapsed = state.replayElapsed + (frameTime - state.replayStart);
    const playbackTime = baseElapsed * state.speed;
    const allStrokes = getAllStrokes();
    const endTime = allStrokes[allStrokes.length - 1]?.completedAt || 0;

    redraw(playbackTime);
    updateStats();

    if (playbackTime >= endTime + 16) {
        stopReplay();
        redraw();
        return;
    }

    state.replayFrame = requestAnimationFrame(replayLoop);
}

function startReplay() {
    if (state.finalizationTimer) {
        clearTimeout(state.finalizationTimer);
        state.finalizationTimer = null;
    }

    const allStrokes = getAllStrokes();
    if (!allStrokes.length) {
        setStatus("Draw something first");
        return;
    }

    state.replaying = true;
    state.paused = false;
    state.replayStart = performance.now();
    state.replayElapsed = 0;
    state.replayFrame = requestAnimationFrame(replayLoop);
    replayButton.textContent = "Stop replay";
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause";
    setStatus("Replaying strokes");
}

function toggleReplay() {
    if (!state.replaying) {
        startReplay();
        return;
    }

    stopReplay();
}

function togglePause() {
    if (!state.replaying) {
        return;
    }

    state.paused = !state.paused;
    pauseButton.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) {
        state.replayElapsed += performance.now() - state.replayStart;
        setStatus("Replay paused");
        if (state.replayFrame) {
            cancelAnimationFrame(state.replayFrame);
            state.replayFrame = 0;
        }
        return;
    }

    state.replayStart = performance.now();
    setStatus("Replaying strokes");
    state.replayFrame = requestAnimationFrame(replayLoop);
}

function syncSpeed() {
    state.speed = Number(speedRange.value);
    speedValue.textContent = `${state.speed.toFixed(1)}x`;
}

function setMode(newMode) {
    const isDataset = state.workspaceMode === "dataset";
    state.mode = isDataset ? newMode : "draw";
    const isLabelMode = isDataset && newMode === "label";

    if (!isDataset) {
        drawModeBtn.classList.add("active");
        labelModeBtn.classList.remove("active");
        drawControls.classList.remove("hidden");
        labelControls.classList.add("hidden");
        drawingStats.classList.remove("hidden");
        datasetStats.classList.add("hidden");
        document.body.classList.remove("mode-label");
        canvasTip.textContent = "Use a pen, stylus, mouse, or touch input.";
        setStatus("Ready to draw");
        redraw();
        updateStats();
        return;
    }

    if (!isLabelMode) {
        drawModeBtn.classList.add("active");
        labelModeBtn.classList.remove("active");
        drawControls.classList.remove("hidden");
        labelControls.classList.add("hidden");
        drawingStats.classList.remove("hidden");
        datasetStats.classList.add("hidden");
        document.body.classList.remove("mode-label");
        canvasTip.textContent = "Use a pen, stylus, mouse, or touch input.";
        setStatus("Ready to draw");
    } else {
        if (state.replaying) {
            stopReplay();
        }
        drawModeBtn.classList.remove("active");
        labelModeBtn.classList.add("active");
        drawControls.classList.add("hidden");
        labelControls.classList.remove("hidden");
        drawingStats.classList.add("hidden");
        datasetStats.classList.remove("hidden");
        document.body.classList.add("mode-label");
        canvasTip.textContent = `Click letters to label with '${state.activeLabel}', or type a whole word then click a connected word.`;
        setStatus(`Labeling mode (Active: '${state.activeLabel}')`);
    }
    redraw();
    updateStats();
}

function stopNoteSyncPolling() {
    if (syncPollInterval) {
        clearInterval(syncPollInterval);
        syncPollInterval = null;
    }
}

function setWorkspaceMode(newMode, { force = false } = {}) {
    if (!force && state.workspaceMode === newMode) return;
    state.workspaceMode = newMode;

    const isDataset = newMode === "dataset";
    const isPredict = newMode === "predict";
    const isNotes = newMode === "notes";
    notesModeBtn.classList.toggle("active", isNotes);
    if (predictModeBtn) {
        predictModeBtn.classList.toggle("active", isPredict);
    }
    datasetModeBtn.classList.toggle("active", isDataset);

    if (labelPracticeRow) {
        labelPracticeRow.classList.toggle("hidden", !isDataset);
    }
    if (datasetSubModeToggle) {
        datasetSubModeToggle.classList.toggle("hidden", !isDataset);
    }
    if (datasetSubModeDivider) {
        datasetSubModeDivider.classList.toggle("hidden", !isDataset);
    }
    if (predictionCard) {
        predictionCard.classList.toggle("hidden", !(isDataset || isPredict));
    }
    if (recognizedWordsPanel) {
        recognizedWordsPanel.classList.toggle("hidden", !(isDataset || isPredict));
    }

    const predictToggle = predictCheckbox ? predictCheckbox.closest("label") : null;
    if (predictToggle) {
        predictToggle.classList.toggle("hidden", !(isDataset || isPredict));
    }
    syncPredictControlsVisibility();
    if (nextPracticeWordBtn) {
        nextPracticeWordBtn.classList.toggle("hidden", !isDataset);
    }
    if (practiceWordText) {
        practiceWordText.classList.toggle("hidden", !isDataset);
    }

    if (newNoteBtn) {
        newNoteBtn.textContent = isDataset ? "+ New Dataset" : "+ New Note";
    }
    if (noteTitleLabel) {
        noteTitleLabel.textContent = isDataset ? "Dataset Title" : "Note Title";
    }
    if (noteTitleInput) {
        noteTitleInput.placeholder = isDataset ? "Untitled Dataset" : "Untitled Note";
        noteTitleInput.disabled = isDataset;
        if (isDataset) {
            noteTitleInput.value = "";
        }
    }

    if (!isDataset) {
        state.predictMode = isPredict;
        if (predictCheckbox) predictCheckbox.checked = isPredict;
        if (!isPredict) {
            setContinuousMode(false);
            clearPredictionDisplay();
        } else {
            setWritingStyle(state.writingStyle, { applyDefaults: true });
            loadModel();
            loadDictionary();
            runInference();
        }
        if (strokeLabelInput) {
            strokeLabelInput.value = "";
        }
        setMode("draw");
        if (state.lastNoteId) {
            const restoreNoteId = state.lastNoteId;
            state.lastNoteId = null;
            loadNotesList().finally(() => {
                selectNote(restoreNoteId);
            });
        } else {
            loadNotesList();
        }
        return;
    }

    stopNoteSyncPolling();
    if (state.currentNoteId) {
        state.lastNoteId = state.currentNoteId;
    }
    state.currentNoteId = null;
    state.otherUsersStrokes = {};
    setSyncStatus("saved");
    if (predictCheckbox) {
        predictCheckbox.checked = true;
        state.predictMode = true;
    }
    loadModel();
    loadDictionary();
    loadCoveragePrompts().finally(() => {
        pickNextPracticeWord();
    });
    loadDatasetsList();
    setMode(state.mode || "draw");
}

function setActiveLabel(newLabel) {
    const clean = newLabel.trim();
    if (clean === "") return;

    state.activeLabel = clean;
    activeLabelInput.value = clean;

    quickLabelBtns.forEach((btn) => {
        if (btn.textContent === clean) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    if (state.mode === "label") {
        canvasTip.textContent = `Click strokes to label them as '${state.activeLabel}'.`;
        setStatus(`Labeling mode (Active: '${state.activeLabel}')`);
    }
}

function createAutosaveSessionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `session_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function createDatasetId() {
    return `dataset-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function getAutosaveSessionId(datasetId) {
    if (!datasetId) {
        return "";
    }
    const storageKey = `${AUTOSAVE_SESSION_STORAGE_KEY}:${datasetId}`;
    try {
        const stored = localStorage.getItem(storageKey);
        if (stored) return stored;
        const created = createAutosaveSessionId();
        localStorage.setItem(storageKey, created);
        return created;
    } catch (error) {
        console.warn("[Autosave] localStorage unavailable, using ephemeral session ID.", error);
        return createAutosaveSessionId();
    }
}

function setDatasetMeta({ id, title } = {}) {
    if (id) {
        state.currentDatasetId = id;
    }
    if (typeof title === "string") {
        state.currentDatasetTitle = title || "Untitled Dataset";
    }
    if (noteTitleInput) {
        noteTitleInput.value = state.currentDatasetTitle || "";
    }
    refreshAutosaveSessionId();
}

function refreshAutosaveSessionId() {
    const newSessionId = getAutosaveSessionId(state.currentDatasetId);
    if (!newSessionId) {
        autosaveRuntime.sessionId = "";
        return;
    }
    if (autosaveRuntime.sessionId !== newSessionId) {
        autosaveRuntime.sessionId = newSessionId;
        autosaveRuntime.pendingBody = "";
        autosaveRuntime.lastSentBody = "";
    }
}

function buildAutosaveDataset() {
    const dataset = compileDataset();
    const labeledSamples = (dataset.samples || []).filter((sample) => String(sample?.label || "").trim());
    const labeledSequenceSamples = (dataset.sequenceSamples || []).filter((sample) => String(sample?.text || "").trim());

    return {
        metadata: {
            ...(dataset.metadata || {}),
            datasetId: state.currentDatasetId || "",
            title: state.currentDatasetTitle || "",
            autosave: true,
            totalSamples: labeledSamples.length,
            totalSequenceSamples: labeledSequenceSamples.length,
        },
        samples: labeledSamples,
        sequenceSamples: labeledSequenceSamples,
    };
}

async function sendAutosaveBody(body) {
    autosaveRuntime.inFlight = true;
    try {
        const response = await fetch("/autosave-dataset", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body,
        });
        if (!response.ok) {
            throw new Error(`Autosave failed (${response.status})`);
        }
        autosaveRuntime.lastSentBody = body;
    } catch (error) {
        console.warn("[Autosave] Failed to sync labeled dataset:", error);
    } finally {
        autosaveRuntime.inFlight = false;
        if (autosaveRuntime.pendingBody && autosaveRuntime.pendingBody !== autosaveRuntime.lastSentBody) {
            const nextBody = autosaveRuntime.pendingBody;
            autosaveRuntime.pendingBody = "";
            sendAutosaveBody(nextBody);
        } else {
            autosaveRuntime.pendingBody = "";
        }
    }
}

function triggerAutosave({ force = false, useBeacon = false } = {}) {
    if (state.workspaceMode !== "dataset") {
        return;
    }
    if (!state.currentDatasetId) {
        return;
    }
    if (!autosaveRuntime.sessionId) {
        return;
    }

    const dataset = buildAutosaveDataset();
    if (!dataset.samples.length && !dataset.sequenceSamples.length) {
        return;
    }

    const body = JSON.stringify({
        sessionId: autosaveRuntime.sessionId,
        datasetId: state.currentDatasetId,
        datasetTitle: state.currentDatasetTitle || "",
        dataset,
    });

    if (!force && body === autosaveRuntime.lastSentBody) {
        return;
    }

    if (useBeacon && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon("/autosave-dataset", new Blob([body], { type: "application/json" }));
        if (sent) {
            autosaveRuntime.lastSentBody = body;
        }
        return;
    }

    if (autosaveRuntime.inFlight) {
        autosaveRuntime.pendingBody = body;
        return;
    }

    sendAutosaveBody(body);
}

function initializeAutosave() {
    refreshAutosaveSessionId();
    if (autosaveRuntime.intervalId) {
        clearInterval(autosaveRuntime.intervalId);
    }
    autosaveRuntime.intervalId = setInterval(() => {
        triggerAutosave();
    }, AUTOSAVE_INTERVAL_MS);

    const flushAutosave = () => triggerAutosave({ force: true, useBeacon: true });
    window.addEventListener("pagehide", flushAutosave);
    window.addEventListener("beforeunload", flushAutosave);
}

// Grouping and normalization logic for dataset export
function compileDataset() {
    const finalGroups = [];
    const sequenceSamples = [];

    // 1. Add finalized letters directly as pre-grouped samples
    if (state.finalizedLetters) {
        for (const item of state.finalizedLetters) {
            finalGroups.push({
                label: item.label || "",
                strokes: item.strokes,
                startedAt: item.strokes[0]?.startedAt || 0,
            });
        }
    }

    if (state.finalizedWords) {
        for (const item of state.finalizedWords) {
            if (!item.label) continue;
            sequenceSamples.push({
                id: `sequence_${Date.now()}_${item.label}`,
                text: item.label,
                strokeCount: item.strokes.length,
                rawStrokes: item.strokes.map((s) => ({
                    points: s.points.map((p) => ({ x: p.x, y: p.y, time: p.time })),
                })),
                normalizedStrokes: normalizeStrokes(item.strokes),
            });
        }
    }

    // 2. Group any active strokes in state.strokes (supporting both labeled and unlabeled)
    const sortedActiveStrokes = [...state.strokes].sort((a, b) => a.startedAt - b.startedAt);
    const activeGroups = [];

    for (const stroke of sortedActiveStrokes) {
        let added = false;
        const strokeLabel = stroke.label || "";

        for (const group of activeGroups) {
            if (group.label === strokeLabel) {
                const lastStrokeInGroup = group.strokes[group.strokes.length - 1];
                const timeDiff = Math.abs(stroke.startedAt - lastStrokeInGroup.completedAt);

                const c1 = getStrokeCenter(stroke);
                const c2 = getStrokeCenter(lastStrokeInGroup);
                const spaceDiff = Math.hypot(c1.x - c2.x, c1.y - c2.y);

                const sizeThreshold = Math.max(80, getStrokeSpan(stroke) * 2, getStrokeSpan(lastStrokeInGroup) * 2);

                // Group if drawn within 4 seconds and close in space
                if (timeDiff < 4000 && spaceDiff < sizeThreshold) {
                    group.strokes.push(stroke);
                    added = true;
                    break;
                }
            }
        }

        if (!added) {
            activeGroups.push({
                label: strokeLabel,
                strokes: [stroke],
                startedAt: stroke.startedAt || 0,
            });
        }
    }

    // Combine active groups into finalGroups
    finalGroups.push(...activeGroups);

    // Sort all groups chronologically by their starting time
    finalGroups.sort((a, b) => a.startedAt - b.startedAt);

    const processedSamples = finalGroups.map((group, index) => {
        const normalized = normalizeStrokes(group.strokes);
        return {
            id: `sample_${index + 1}_${group.label}`,
            label: group.label,
            strokeCount: group.strokes.length,
            rawStrokes: group.strokes.map((s) => ({
                points: s.points.map((p) => ({ x: p.x, y: p.y, time: p.time })),
            })),
            normalizedStrokes: normalized,
        };
    });

    const allStrokes = getAllStrokes();
    const labeledStrokes = allStrokes.filter((s) => s.label);

    return {
        metadata: {
            exportedAt: new Date().toISOString(),
            totalStrokes: allStrokes.length,
            totalLabeledStrokes: labeledStrokes.length,
            totalSamples: processedSamples.length,
            totalSequenceSamples: sequenceSamples.length,
            canvasWidth: canvas.width / (window.devicePixelRatio || 1),
            canvasHeight: canvas.height / (window.devicePixelRatio || 1),
            datasetId: state.currentDatasetId || "",
            title: state.currentDatasetTitle || "",
        },
        samples: processedSamples,
        sequenceSamples: sequenceSamples,
    };
}

function normalizeStrokes(strokes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
        for (const point of stroke.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const maxDim = Math.max(width, height);

    const scale = maxDim > 0 ? 256 / maxDim : 1;
    const offsetX = (256 - width * scale) / 2;
    const offsetY = (256 - height * scale) / 2;

    return strokes.map((stroke) => {
        const startTime = strokes[0].points[0]?.time || 0;
        return {
            points: stroke.points.map((point) => ({
                x: Number(((point.x - minX) * scale + offsetX).toFixed(2)),
                y: Number(((point.y - minY) * scale + offsetY).toFixed(2)),
                time: Number((point.time - startTime).toFixed(0)),
            })),
        };
    });
}

// Keyboard shortcuts for Label Mode
window.addEventListener("keydown", (event) => {
    if (state.workspaceMode !== "dataset" || state.mode !== "label") return;

    if (document.activeElement === activeLabelInput) {
        if (event.key === "Enter") {
            activeLabelInput.blur();
        }
        return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (event.key.length === 1) {
        setActiveLabel(event.key);
        event.preventDefault();
    }
});

// Event listeners
canvas.addEventListener("pointerdown", startStroke);
canvas.addEventListener("pointermove", extendStroke);
canvas.addEventListener("pointerup", stopStroke);
canvas.addEventListener("pointercancel", stopStroke);

clearButton.addEventListener("click", clearCanvas);
replayButton.addEventListener("click", toggleReplay);
pauseButton.addEventListener("click", togglePause);
speedRange.addEventListener("input", syncSpeed);

// Mode selectors
notesModeBtn.addEventListener("click", () => setWorkspaceMode("notes"));
if (predictModeBtn) {
    predictModeBtn.addEventListener("click", () => setWorkspaceMode("predict"));
}
datasetModeBtn.addEventListener("click", () => setWorkspaceMode("dataset"));
drawModeBtn.addEventListener("click", () => setMode("draw"));
labelModeBtn.addEventListener("click", () => setMode("label"));

// Label configuration
activeLabelInput.addEventListener("input", () => {
    setActiveLabel(activeLabelInput.value);
});

quickLabelBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        setActiveLabel(btn.textContent);
    });
});

predictStyleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        setWritingStyle(btn.dataset.style);
    });
});

clearLabelsBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all stroke labels?")) {
        for (const stroke of state.strokes) {
            stroke.label = "";
        }
        if (state.finalizedLetters) {
            for (const item of state.finalizedLetters) {
                item.label = "";
                for (const stroke of item.strokes) {
                    stroke.label = "";
                }
            }
        }
        if (state.finalizedWords) {
            for (const item of state.finalizedWords) {
                item.label = "";
                for (const stroke of item.strokes) {
                    stroke.label = "";
                }
            }
        }
        redraw();
        updateStats();
        updateRecognizedWords();
        pushLabelsToServer();
    }
});

exportDatasetBtn.addEventListener("click", () => {
    if (state.workspaceMode !== "dataset") {
        alert("Switch to Dataset mode to export datasets.");
        return;
    }
    const dataset = compileDataset();
    if (dataset.metadata.totalStrokes === 0) {
        alert("Please draw something before exporting.");
        return;
    }

    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `handwriting_dataset_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${dataset.samples.length} samples`);
});

importDatasetBtn.addEventListener("click", () => {
    if (state.workspaceMode !== "dataset") {
        setWorkspaceMode("dataset");
    }
    importDatasetFile.click();
});

importDatasetFile.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || (!Array.isArray(data.samples) && !Array.isArray(data.sequenceSamples))) {
                alert("Invalid dataset format: missing 'samples' array.");
                return;
            }
            const inferredTitle = data?.metadata?.title || file.name.replace(/\.json$/i, "");
            importDataset(data, { datasetId: createDatasetId(), datasetTitle: inferredTitle, source: "import" });
        } catch (err) {
            console.error("Failed to parse JSON file:", err);
            alert("Failed to parse JSON file. Please ensure it is a valid exported dataset.");
        } finally {
            importDatasetFile.value = "";
        }
    };
    reader.readAsText(file);
});

function importDataset(data, { datasetId, datasetTitle, source } = {}) {
    if (state.workspaceMode !== "dataset") {
        setWorkspaceMode("dataset");
    }
    const resolvedId = datasetId || data?.metadata?.datasetId || state.currentDatasetId || createDatasetId();
    const resolvedTitle = datasetTitle || data?.metadata?.title || "Untitled Dataset";
    setDatasetMeta({ id: resolvedId, title: resolvedTitle });
    upsertDatasetListItem({
        id: resolvedId,
        title: resolvedTitle,
        updatedAt: Date.now(),
        source: source || "autosave",
    });
    if (state.finalizationTimer) {
        clearTimeout(state.finalizationTimer);
        state.finalizationTimer = null;
    }
    state.strokes = [];
    state.finalizedLetters = [];
    state.finalizedWords = [];
    state.currentStroke = null;
    state.drawing = false;
    state.replaying = false;
    state.paused = false;
    state.replayStart = 0;
    state.replayElapsed = 0;
    state.replayFrame = 0;
    state.sessionStart = 0;
    state.totalCharacters = 0;
    state.unlabeledStrokes = 0;
    state.durationMs = 0;
    state.pointerId = null;

    let currentOffset = 500;
    let maxTime = 0;

    const samples = Array.isArray(data.samples) ? data.samples : [];
    for (const sample of samples) {
        const imported = buildImportedItem(sample, currentOffset, sample.label || "");
        if (!imported) {
            continue;
        }

        state.finalizedLetters.push({
            prediction: sample.label || "?",
            confidence: sample.label ? 1.0 : 0.0,
            bounds: imported.bounds,
            strokes: imported.strokes,
            label: sample.label || "",
        });

        maxTime = Math.max(maxTime, imported.strokes[imported.strokes.length - 1]?.completedAt || currentOffset);
        currentOffset += imported.duration + 1000;
    }

    const sequenceSamples = Array.isArray(data.sequenceSamples) ? data.sequenceSamples : [];
    for (const sample of sequenceSamples) {
        const textLabel = (sample.text || "").trim();
        const imported = buildImportedItem(sample, currentOffset, textLabel);
        if (!imported) {
            continue;
        }

        state.finalizedWords.push({
            id: sample.id || `W-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            label: textLabel,
            prediction: textLabel || "?",
            confidence: textLabel ? 1.0 : 0.0,
            bounds: imported.bounds,
            strokes: imported.strokes,
            letterSpans: Array.isArray(sample.letterSpans) ? sample.letterSpans : [],
            usedTimesteps: sample.usedTimesteps || 0,
            sequencePrediction: textLabel || "?",
            sequenceConfidence: textLabel ? 1.0 : 0.0,
            charPrediction: textLabel || "?",
            charConfidence: textLabel ? 1.0 : 0.0,
            charUsed: true,
            charIgnoredReason: "",
            segmentCount: 0,
            expectedCharCount: textLabel.replace(/\s+/g, "").length,
        });

        maxTime = Math.max(maxTime, imported.strokes[imported.strokes.length - 1]?.completedAt || currentOffset);
        currentOffset += imported.duration + 1000;
    }

    // Set chronological variables so new strokes are appended at the end
    state.sessionStart = performance.now() - maxTime - 1000;
    state.durationMs = maxTime;

    // Set stats initial totals
    let labeledCount = 0;
    let unlabeledStrokeCount = 0;
    for (const letter of state.finalizedLetters) {
        if (letter.label) {
            labeledCount += 1;
        } else {
            unlabeledStrokeCount += letter.strokes.length;
        }
    }
    state.totalCharacters = labeledCount;
    state.unlabeledStrokes = unlabeledStrokeCount;

    replayButton.disabled = false;
    clearPredictionDisplay();

    // Automatically switch to Label mode to look at/label the imported characters
    setMode("label");

    const totalImported = state.finalizedLetters.length + state.finalizedWords.length;
    setStatus(`Imported ${totalImported} item${totalImported === 1 ? "" : "s"}`);

    redraw();
    updateStats();
    updateRecognizedWords();

    // Run sequential background predictions for imported unlabeled characters
    predictFinalizedLetters(state.finalizedLetters);
}

function createNewDataset() {
    const newId = createDatasetId();
    const title = "Untitled Dataset";
    setDatasetMeta({ id: newId, title });
    upsertDatasetListItem({
        id: newId,
        title,
        updatedAt: Date.now(),
        source: "autosave",
    });
    clearCanvas();
    setMode("draw");
    pickNextPracticeWord();
    setStatus("New dataset ready");
}

async function predictFinalizedLetters(letters) {
    if (!state.modelTrained || state.workspaceMode !== "dataset") return;

    for (const letter of letters) {
        if (!letter.label) {
            try {
                const normalizedStrokes = normalizeStrokes(letter.strokes);
                const seqPoints = [];
                for (const stroke of normalizedStrokes) {
                    const pts = stroke.points;
                    for (let idx = 0; idx < pts.length; idx++) {
                        const pt = pts[idx];
                        const penLift = idx === pts.length - 1 ? 1.0 : 0.0;
                        seqPoints.push([pt.x / 256.0, pt.y / 256.0, penLift, pt.time]);
                    }
                }
                if (seqPoints.length === 0) continue;

                const response = await fetch("/predict", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ points: seqPoints }),
                });

                if (response.ok) {
                    const data = await response.json();
                    if (!data.error) {
                        letter.prediction = data.prediction || "?";
                        letter.confidence = data.confidence || 0;
                        redraw();
                        updateRecognizedWords();
                    }
                }
            } catch (error) {
                console.error("Failed to predict imported letter:", error);
            }
        }
    }
}

function clearPredictionDisplay() {
    if (predictionText) {
        predictionText.textContent = "-";
    }
    if (predictionConfidenceText) {
        predictionConfidenceText.textContent = "0%";
    }
    if (predictionConfidenceBar) {
        predictionConfidenceBar.style.width = "0%";
    }
    updatePredictionBadge(null);
}

async function finalizeCurrentWord() {
    if (!state.strokes.length) return;

    const wordLabel = (strokeLabelInput.value || "").trim();

    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const stroke of state.strokes) {
        const b = getStrokeBounds(stroke);
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
    }
    const bounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    const strokesToCommit = [...state.strokes];
    for (const stroke of strokesToCommit) {
        stroke.isFinalized = true;
        stroke.label = wordLabel;
    }

    const newWord = {
        id: "W-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9),
        label: wordLabel,
        prediction: "?",
        confidence: 0,
        bounds,
        strokes: strokesToCommit,
        letterSpans: [],
        usedTimesteps: 0,
    };
    state.finalizedWords.push(newWord);

    if (state.currentNoteId) {
        fetch(`/api/notes/${state.currentNoteId}/finalize-word`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word: newWord }),
        }).catch((err) => console.error("Failed to push finalized word:", err));
    }

    state.totalCharacters += wordLabel.replace(/\s+/g, "").length;
    state.strokes = [];
    strokeLabelInput.value = "";
    setStatus(wordLabel ? `Committed word "${wordLabel}"` : "Committed unlabeled word. Label it later in Label Mode.");
    updateStats();
    redraw();
    updateRecognizedWords();
    pickNextPracticeWord();

    if (!state.predictMode || !isPredictionWorkspace()) {
        return;
    }

    try {
        const normalizedStrokes = normalizeStrokes(strokesToCommit);
        const seqPoints = [];
        for (const stroke of normalizedStrokes) {
            const pts = stroke.points;
            for (let idx = 0; idx < pts.length; idx++) {
                const pt = pts[idx];
                const penLift = idx === pts.length - 1 ? 1.0 : 0.0;
                seqPoints.push([pt.x / 256.0, pt.y / 256.0, penLift, pt.time]);
            }
        }

        if (seqPoints.length === 0) return;

        const predictEndpoint =
            state.workspaceMode === "predict" && state.writingStyle === "cursive" ? "/predict-sequence" : "/predict-hybrid";
        const response = await fetch(predictEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ points: seqPoints }),
        });

        if (!response.ok) return;
        const data = await response.json();
        if (data.error) return;

        newWord.prediction = data.prediction || "?";
        newWord.confidence = data.confidence || 0;
        newWord.letterSpans = Array.isArray(data.letterSpans) ? data.letterSpans : [];
        newWord.usedTimesteps = data.usedTimesteps || 0;
        newWord.sequencePrediction = data.sequencePrediction || data.prediction || "?";
        newWord.sequenceConfidence = data.sequenceConfidence || data.confidence || 0;
        newWord.charPrediction = data.charPrediction || "?";
        newWord.charConfidence = data.charConfidence || 0;
        newWord.charUsed = data.charUsed !== false;
        newWord.charIgnoredReason = data.charIgnoredReason || "";
        newWord.segmentCount = data.segmentCount || 0;
        newWord.expectedCharCount = data.expectedCharCount || 0;

        if (state.currentNoteId) {
            fetch(`/api/notes/${state.currentNoteId}/update-word-prediction`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    wordId: newWord.id,
                    prediction: data.prediction || "?",
                    confidence: data.confidence || 0,
                    letterSpans: data.letterSpans || [],
                    usedTimesteps: data.usedTimesteps || 0,
                }),
            }).catch((err) => console.error("Failed to update word prediction on server:", err));
        }

        const confidence = Math.round((data.confidence || 0) * 100);
        if (predictionText) {
            predictionText.textContent = data.prediction || "?";
        }
        if (predictionConfidenceText) {
            predictionConfidenceText.textContent = `${confidence}%`;
        }
        if (predictionConfidenceBar) {
            predictionConfidenceBar.style.width = `${confidence}%`;
        }
        updatePredictionBadge(data);
        redraw();
        updateRecognizedWords();
    } catch (error) {
        console.error("Failed to run sequence prediction:", error);
    }
}

async function finalizeCurrentLetter() {
    if (!state.strokes.length) return;

    const strokesToPredict = [...state.strokes];

    // Calculate combined bounding box of the active strokes
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const stroke of strokesToPredict) {
        const b = getStrokeBounds(stroke);
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
    }
    const bounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };

    // Find any initial label on strokes (e.g. set via text input before drawing)
    let initialLabel = "";
    for (const stroke of strokesToPredict) {
        if (stroke.label) {
            initialLabel = stroke.label;
            break;
        }
    }

    // Set finalized flag and ensure consistent label
    for (const stroke of strokesToPredict) {
        stroke.isFinalized = true;
        stroke.label = initialLabel;
    }

    // Add finalized letter with placeholder prediction to avoid visual flicker during fetch
    const newLetter = {
        id: "L-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9),
        prediction: "?",
        confidence: 0,
        bounds: bounds,
        strokes: strokesToPredict,
        label: initialLabel,
    };
    state.finalizedLetters.push(newLetter);

    if (state.currentNoteId) {
        fetch(`/api/notes/${state.currentNoteId}/finalize-letter`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ letter: newLetter }),
        }).catch((err) => console.error("Failed to push finalized letter:", err));
    }

    // Clear active strokes so the next drawing is a new letter
    state.strokes = [];
    updateStats();
    redraw();
    updateRecognizedWords();

    if (!state.predictMode || !isPredictionWorkspace()) {
        return;
    }

    try {
        const normalizedStrokes = normalizeStrokes(strokesToPredict);
        const seqPoints = [];

        for (const stroke of normalizedStrokes) {
            const pts = stroke.points;
            for (let idx = 0; idx < pts.length; idx++) {
                const pt = pts[idx];
                const penLift = idx === pts.length - 1 ? 1.0 : 0.0;
                seqPoints.push([pt.x / 256.0, pt.y / 256.0, penLift, pt.time]);
            }
        }

        if (seqPoints.length === 0) return;

        console.log(`[Client] Finalizing letter. Sending ${seqPoints.length} points to /predict...`);

        const response = await fetch("/predict", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ points: seqPoints }),
        });

        if (!response.ok) {
            console.warn("[Client] Finalize predict request failed:", response.statusText);
            return;
        }

        const data = await response.json();
        console.log("[Client] Finalize predict response:", data);
        if (data.error) {
            console.error("[Client] Finalize error inside response:", data.error);
            return;
        }

        const predictedChar = data.prediction || "?";
        const confidence = Math.round((data.confidence || 0) * 100);

        // Update the prediction values inside the finalized letter object
        newLetter.prediction = predictedChar;
        newLetter.confidence = data.confidence;

        if (state.currentNoteId) {
            fetch(`/api/notes/${state.currentNoteId}/update-letter-prediction`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    letterId: newLetter.id,
                    prediction: predictedChar,
                    confidence: data.confidence,
                }),
            }).catch((err) => console.error("Failed to update letter prediction on server:", err));
        }

        // Update the prediction display card for visual feedback
        if (predictionText) {
            predictionText.textContent = predictedChar;
        }
        if (predictionConfidenceText) {
            predictionConfidenceText.textContent = `${confidence}%`;
        }
        if (predictionConfidenceBar) {
            predictionConfidenceBar.style.width = `${confidence}%`;
        }
        updatePredictionBadge(null);
    } catch (error) {
        console.error("Failed to finalize letter prediction:", error);
    }

    redraw();
    updateRecognizedWords();

    if (state.practiceMode === "letter" && initialLabel === state.practiceLetter) {
        pickNextPracticeWord();
    }
}

async function runInference() {
    if (!isPredictionWorkspace()) {
        clearPredictionDisplay();
        return;
    }
    if (!state.predictMode) {
        clearPredictionDisplay();
        return;
    }
    if (!state.strokes.length) {
        clearPredictionDisplay();
        return;
    }

    try {
        // Preprocess and normalize strokes (exact match to train.py)
        const normalizedStrokes = normalizeStrokes(state.strokes);
        const seqPoints = [];

        for (const stroke of normalizedStrokes) {
            const pts = stroke.points;
            for (let idx = 0; idx < pts.length; idx++) {
                const pt = pts[idx];
                const penLift = idx === pts.length - 1 ? 1.0 : 0.0;
                seqPoints.push([pt.x / 256.0, pt.y / 256.0, penLift, pt.time]);
            }
        }

        if (seqPoints.length === 0) {
            clearPredictionDisplay();
            return;
        }

        console.log(`[Client] Preprocessed points: ${seqPoints.length}. Sending POST /predict request...`);

        // Post sequence to Express server
        const response = await fetch("/predict", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ points: seqPoints }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.warn("[Client] Prediction server returned error response:", errData.error || response.statusText);

            // If the model isn't trained yet, reflect it on the card
            if (response.status === 404) {
                if (predictionText) predictionText.textContent = "?";
                if (predictionConfidenceText) predictionConfidenceText.textContent = "No Model";
            }
            return;
        }

        const data = await response.json();
        console.log("[Client] Received prediction response:", data);
        if (data.error) {
            console.error("[Client] Prediction error inside server response:", data.error);
            return;
        }

        const predictedChar = data.prediction || "?";
        const confidence = Math.round((data.confidence || 0) * 100);

        // Update the prediction display card
        if (predictionText) {
            predictionText.textContent = predictedChar;
        }
        if (predictionConfidenceText) {
            predictionConfidenceText.textContent = `${confidence}%`;
        }
        if (predictionConfidenceBar) {
            predictionConfidenceBar.style.width = `${confidence}%`;
        }
        updatePredictionBadge(null);
    } catch (error) {
        console.error("Inference fetch failed:", error);
    }
}

async function loadModel() {
    try {
        const response = await fetch("/model-status");
        if (!response.ok) return;
        const status = await response.json();

        state.modelTrained = status.modelTrained;
        state.bridgeReady = status.bridgeReady;

        if (state.modelTrained) {
            if (state.bridgeReady) {
                setStatus("Handwriting model loaded! Auto-predict active.");
            } else {
                setStatus("Handwriting model is trained. Starting python bridge...");
            }
            if (state.strokes.length > 0 && state.predictMode) {
                runInference();
            }
        } else {
            console.log("No trained model files found yet. Auto-predict is inactive.");
            if (predictionText) predictionText.textContent = "?";
            if (predictionConfidenceText) predictionConfidenceText.textContent = "No Model";
        }
    } catch (error) {
        console.log("Failed to check model status:", error);
    }
}

if (predictCheckbox) {
    predictCheckbox.addEventListener("change", () => {
        if (!isPredictionWorkspace()) {
            predictCheckbox.checked = false;
            state.predictMode = false;
            clearPredictionDisplay();
            return;
        }
        state.predictMode = predictCheckbox.checked;
        if (state.predictMode) {
            runInference();
        } else {
            clearPredictionDisplay();
        }
    });
}

if (continuousModeCheckbox) {
    continuousModeCheckbox.addEventListener("change", () => {
        if (!isPredictionWorkspace()) {
            continuousModeCheckbox.checked = false;
            state.continuousMode = false;
            return;
        }
        state.continuousMode = continuousModeCheckbox.checked;
        if (state.continuousMode) {
            setStatus("Continuous script mode ON. Draw connected writing, then click Commit Word.");
        } else {
            setStatus("Continuous script mode OFF. Character auto-finalization is active.");
        }
    });
}

if (commitWordBtn) {
    commitWordBtn.addEventListener("click", () => {
        finalizeCurrentWord();
    });
}

if (nextPracticeWordBtn) {
    nextPracticeWordBtn.addEventListener("click", () => {
        pickNextPracticeWord();
    });
}

window.addEventListener("resize", resizeCanvas);

// ==========================================
// NOTE MANAGEMENT & SYNCHRONIZATION LOGIC
// ==========================================

let syncPollInterval = null;

function setSyncStatus(status) {
    if (!syncStatusElement) return;
    syncStatusElement.className = `sync-status ${status}`;
    syncStatusElement.textContent = status === "saved" ? "Saved" : status === "syncing" ? "Syncing" : "Offline";
}

async function loadNotesList() {
    if (!isNoteWorkspace()) return;
    try {
        const response = await fetch("/api/notes");
        if (!response.ok) throw new Error("Failed to fetch notes list");
        const notes = await response.json();
        state.notesList = notes;
        renderNotesList();

        // Auto-select first note if none selected, or if current note was deleted
        if (notes.length > 0) {
            const currentExists = notes.some((n) => n.id === state.currentNoteId);
            if (!state.currentNoteId || !currentExists) {
                selectNote(notes[0].id);
            }
        } else {
            // No notes exist, create one
            createNewNote();
        }
    } catch (err) {
        console.error("Failed to load notes:", err);
        setSyncStatus("offline");
    }
}

async function loadDatasetsList() {
    if (state.workspaceMode !== "dataset") return;
    try {
        const response = await fetch("/api/datasets");
        if (!response.ok) throw new Error("Failed to fetch datasets list");
        const datasets = await response.json();
        state.datasetsList = datasets;
        renderDatasetsList();

        if (datasets.length > 0) {
            const currentExists = datasets.some((d) => d.id === state.currentDatasetId);
            if (!state.currentDatasetId || !currentExists) {
                selectDataset(datasets[0].id);
            }
        } else {
            createNewDataset();
        }
    } catch (err) {
        console.error("Failed to load datasets:", err);
        setSyncStatus("offline");
    }
}

function renderNotesList() {
    if (!notesListContainer) return;
    notesListContainer.innerHTML = "";

    state.notesList.forEach((note) => {
        const dateStr = new Date(note.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const isActive = note.id === state.currentNoteId;

        const noteItem = document.createElement("div");
        noteItem.className = `note-item ${isActive ? "active" : ""}`;
        noteItem.dataset.id = note.id;

        noteItem.innerHTML = `
            <div class="note-item-info">
                <span class="note-item-title">${escapeHTML(note.title || "Untitled Note")}</span>
                <span class="note-item-date">Updated: ${dateStr}</span>
            </div>
            <button class="note-delete-btn" title="Delete Note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        noteItem.addEventListener("click", (e) => {
            if (e.target.closest(".note-delete-btn")) {
                deleteNote(note.id);
                return;
            }
            selectNote(note.id);
        });

        notesListContainer.appendChild(noteItem);
    });
}

function renderDatasetsList() {
    if (!notesListContainer) return;
    notesListContainer.innerHTML = "";

    (state.datasetsList || []).forEach((dataset) => {
        const updatedAt = dataset.updatedAt ? new Date(dataset.updatedAt) : null;
        const dateStr = updatedAt ? updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Unknown";
        const isActive = dataset.id === state.currentDatasetId;
        const sourceLabel = dataset.source === "autosave" ? "Autosave" : "Dataset";

        const datasetItem = document.createElement("div");
        datasetItem.className = `note-item ${isActive ? "active" : ""}`;
        datasetItem.dataset.id = dataset.id;

        datasetItem.innerHTML = `
            <div class="note-item-info">
                <span class="note-item-title">${escapeHTML(dataset.title || "Untitled Dataset")}</span>
                <span class="note-item-date">Updated: ${dateStr} · ${sourceLabel}</span>
            </div>
        `;

        datasetItem.addEventListener("click", () => {
            selectDataset(dataset.id);
        });

        notesListContainer.appendChild(datasetItem);
    });
}

function upsertDatasetListItem(dataset) {
    if (!dataset || !dataset.id) return;
    const list = Array.isArray(state.datasetsList) ? state.datasetsList : [];
    const existing = list.findIndex((item) => item.id === dataset.id);
    if (existing >= 0) {
        list[existing] = { ...list[existing], ...dataset };
    } else {
        list.unshift(dataset);
    }
    state.datasetsList = list;
    renderDatasetsList();
}

async function selectDataset(datasetId) {
    if (state.workspaceMode !== "dataset") return;
    if (!datasetId) return;
    if (state.currentDatasetId === datasetId) return;

    setSyncStatus("syncing");
    try {
        const response = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}`);
        if (!response.ok) throw new Error("Failed to fetch dataset");
        const data = await response.json();

        const datasetInfo = (state.datasetsList || []).find((d) => d.id === datasetId);
        const datasetTitle = datasetInfo?.title || data?.metadata?.title || "Untitled Dataset";
        importDataset(data, { datasetId, datasetTitle, source: datasetInfo?.source || "autosave" });
        setSyncStatus("saved");
    } catch (err) {
        console.error("Failed to select dataset:", err);
        setSyncStatus("offline");
    }
}

async function selectNote(noteId) {
    if (!isNoteWorkspace()) return;
    if (state.currentNoteId === noteId) return;

    if (syncPollInterval) {
        clearInterval(syncPollInterval);
        syncPollInterval = null;
    }

    state.currentNoteId = noteId;
    state.otherUsersStrokes = {};

    state.strokes = [];
    state.currentStroke = null;
    state.drawing = false;
    if (state.finalizationTimer) {
        clearTimeout(state.finalizationTimer);
        state.finalizationTimer = null;
    }

    renderNotesList();
    setSyncStatus("syncing");

    try {
        const response = await fetch(`/api/notes/${noteId}`);
        if (!response.ok) throw new Error("Failed to fetch note");
        const note = await response.json();

        state.finalizedLetters = note.finalizedLetters || [];
        state.finalizedWords = note.finalizedWords || [];

        if (noteTitleInput) {
            noteTitleInput.value = note.title || "";
        }

        redraw();
        updateStats();
        updateRecognizedWords();
        setSyncStatus("saved");

        syncPollInterval = setInterval(syncCurrentNote, 300);
    } catch (err) {
        console.error("Failed to select note:", err);
        setSyncStatus("offline");
    }
}

async function createNewNote() {
    if (!isNoteWorkspace()) return;
    try {
        setSyncStatus("syncing");
        const response = await fetch("/api/notes", { method: "POST" });
        if (!response.ok) throw new Error("Failed to create note");
        const newNote = await response.json();

        state.currentNoteId = null;
        await loadNotesList();
        await selectNote(newNote.id);
    } catch (err) {
        console.error("Failed to create note:", err);
        setSyncStatus("offline");
    }
}

async function deleteNote(noteId) {
    if (!isNoteWorkspace()) return;
    if (!confirm("Are you sure you want to delete this note? This action cannot be undone.")) return;

    try {
        setSyncStatus("syncing");
        const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Failed to delete note");

        if (state.currentNoteId === noteId) {
            state.currentNoteId = null;
            if (syncPollInterval) {
                clearInterval(syncPollInterval);
                syncPollInterval = null;
            }
        }
        await loadNotesList();
    } catch (err) {
        console.error("Failed to delete note:", err);
        setSyncStatus("offline");
    }
}

async function renameNote(noteId, newTitle) {
    if (!isNoteWorkspace()) return;
    if (!noteId) return;
    try {
        setSyncStatus("syncing");
        const response = await fetch(`/api/notes/${noteId}/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newTitle }),
        });
        if (!response.ok) throw new Error("Failed to rename note");

        const note = state.notesList.find((n) => n.id === noteId);
        if (note) {
            note.title = newTitle;
            renderNotesList();
        }
        setSyncStatus("saved");
    } catch (err) {
        console.error("Failed to rename note:", err);
        setSyncStatus("offline");
    }
}

async function syncCurrentNote() {
    if (!isNoteWorkspace() || !state.currentNoteId) return;

    try {
        const response = await fetch(`/api/notes/${state.currentNoteId}/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clientSessionId: state.clientSessionId,
                strokes: state.strokes,
                currentStroke: state.currentStroke,
            }),
        });

        if (!response.ok) throw new Error("Sync failed");
        const data = await response.json();

        state.otherUsersStrokes = data.activeStrokes || {};

        const lettersChanged = JSON.stringify(state.finalizedLetters) !== JSON.stringify(data.finalizedLetters);
        const wordsChanged = JSON.stringify(state.finalizedWords) !== JSON.stringify(data.finalizedWords);

        if (lettersChanged || wordsChanged) {
            state.finalizedLetters = data.finalizedLetters || [];
            state.finalizedWords = data.finalizedWords || [];
            redraw();
            updateStats();
            updateRecognizedWords();
        }

        if (noteTitleInput && document.activeElement !== noteTitleInput) {
            if (noteTitleInput.value !== data.title) {
                noteTitleInput.value = data.title || "";
                const note = state.notesList.find((n) => n.id === state.currentNoteId);
                if (note && note.title !== data.title) {
                    note.title = data.title;
                    renderNotesList();
                }
            }
        }

        setSyncStatus("saved");
    } catch (err) {
        console.error("Sync error:", err);
        setSyncStatus("offline");
    }
}

// Hook up UI listeners
if (newNoteBtn) {
    newNoteBtn.addEventListener("click", () => {
        if (state.workspaceMode === "dataset") {
            createNewDataset();
        } else {
            createNewNote();
        }
    });
}

if (noteTitleInput) {
    let renameTimeout = null;
    noteTitleInput.addEventListener("input", () => {
        if (!isNoteWorkspace()) return;
        clearTimeout(renameTimeout);
        renameTimeout = setTimeout(() => {
            renameNote(state.currentNoteId, noteTitleInput.value);
        }, 500);
    });
    noteTitleInput.addEventListener("blur", () => {
        if (!isNoteWorkspace()) return;
        clearTimeout(renameTimeout);
        renameNote(state.currentNoteId, noteTitleInput.value);
    });
}

syncSpeed();
resizeCanvas();
updateStats();
initializeAutosave();
setWorkspaceMode("notes", { force: true });
