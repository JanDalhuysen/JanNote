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

// Prediction UI Elements
const predictCheckbox = document.getElementById("predictCheckbox");
const continuousModeCheckbox = document.getElementById("continuousModeCheckbox");
const commitWordBtn = document.getElementById("commitWordBtn");
const predictionCard = document.getElementById("predictionCard");
const predictionText = document.getElementById("predictionText");
const predictionConfidenceText = document.getElementById("predictionConfidenceText");
const predictionConfidenceBar = document.getElementById("predictionConfidenceBar");

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
    mode: "draw", // "draw" or "label"
    activeLabel: "a",
    model: null,
    classNames: [],
    predictMode: true,
    continuousMode: false,
    finalizedLetters: [],
    finalizedWords: [],
    finalizationTimer: null,
    dictionary: new Set(),
    practiceWord: "",
};

const EASY_CONNECTED_WORDS = [
    "the",
    "be",
    "of",
    "and",
    "a",
    "to",
    "in",
    "he",
    "have",
    "it",
    "that",
    "for",
    "they",
    "with",
    "as",
    "not",
    "on",
    "she",
    "at",
    "by",
    "this",
    "we",
    "you",
    "do",
];

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
        const response = await fetch("/dictionary.txt");
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
            console.warn("[Client] Failed to load dictionary.txt from server:", response.statusText);
        }
    } catch (error) {
        console.error("Failed to load dictionary:", error);
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

function setStatus(message) {
    statusText.textContent = message;
}

function pickNextPracticeWord() {
    if (!EASY_CONNECTED_WORDS.length) return;
    const options = EASY_CONNECTED_WORDS.filter((w) => w !== state.practiceWord);
    const pool = options.length ? options : EASY_CONNECTED_WORDS;
    const word = pool[Math.floor(Math.random() * pool.length)];
    state.practiceWord = word;
    if (practiceWordText) {
        practiceWordText.textContent = `Practice word: ${word}`;
    }
    if (strokeLabelInput) {
        strokeLabelInput.value = word;
    }
    setStatus(`Practice prompt ready: "${word}". Write it in one connected stroke sequence, then Commit Word.`);
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
}

function drawStroke(stroke, activeTime) {
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
    if (state.mode === "label" && stroke.label) {
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

    if (!state.predictMode) {
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

// Mode switching function
function setMode(newMode) {
    state.mode = newMode;
    if (newMode === "draw") {
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
    if (state.mode !== "label") return;

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
    }
});

exportDatasetBtn.addEventListener("click", () => {
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
    importDatasetFile.click();
});

importDatasetFile.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || !Array.isArray(data.samples)) {
                alert("Invalid dataset format: missing 'samples' array.");
                return;
            }
            importDataset(data);
        } catch (err) {
            console.error("Failed to parse JSON file:", err);
            alert("Failed to parse JSON file. Please ensure it is a valid exported dataset.");
        } finally {
            importDatasetFile.value = "";
        }
    };
    reader.readAsText(file);
});

function importDataset(data) {
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

    for (const sample of data.samples) {
        if (!sample.rawStrokes || !Array.isArray(sample.rawStrokes)) {
            continue;
        }

        // Find the min original time in the sample to calculate duration relative to offset
        let sampleMinTime = Infinity;
        let sampleMaxOrigTime = -Infinity;
        for (const s of sample.rawStrokes) {
            if (s.points && Array.isArray(s.points)) {
                for (const pt of s.points) {
                    if (pt.time < sampleMinTime) sampleMinTime = pt.time;
                    if (pt.time > sampleMaxOrigTime) sampleMaxOrigTime = pt.time;
                }
            }
        }
        if (sampleMinTime === Infinity) {
            sampleMinTime = 0;
            sampleMaxOrigTime = 0;
        }

        const sampleDuration = sampleMaxOrigTime - sampleMinTime;

        // Construct finalized strokes for this sample
        const sampleStrokes = sample.rawStrokes.map((rawStroke) => {
            let strokeMinTime = Infinity;
            let strokeMaxTime = -Infinity;

            const points = (rawStroke.points || []).map((pt) => {
                const adjustedTime = pt.time - sampleMinTime + currentOffset;
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

            maxTime = Math.max(maxTime, strokeMaxTime);

            return {
                label: sample.label || "",
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

        const letterObj = {
            prediction: sample.label || "?",
            confidence: sample.label ? 1.0 : 0.0,
            bounds: bounds,
            strokes: sampleStrokes,
            label: sample.label || "",
        };

        state.finalizedLetters.push(letterObj);

        // Advance currentOffset for the next letter
        currentOffset += sampleDuration + 1000;
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

    setStatus(`Imported ${state.finalizedLetters.length} sample${state.finalizedLetters.length === 1 ? "" : "s"}`);

    redraw();
    updateStats();
    updateRecognizedWords();

    // Run sequential background predictions for imported unlabeled characters
    predictFinalizedLetters(state.finalizedLetters);
}

async function predictFinalizedLetters(letters) {
    if (!state.modelTrained) return;

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
        label: wordLabel,
        prediction: "?",
        confidence: 0,
        bounds,
        strokes: strokesToCommit,
        letterSpans: [],
        usedTimesteps: 0,
    };
    state.finalizedWords.push(newWord);

    state.totalCharacters += wordLabel.replace(/\s+/g, "").length;
    state.strokes = [];
    strokeLabelInput.value = "";
    setStatus(wordLabel ? `Committed word "${wordLabel}"` : "Committed unlabeled word. Label it later in Label Mode.");
    updateStats();
    redraw();
    updateRecognizedWords();
    pickNextPracticeWord();

    if (!state.predictMode) {
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

        const response = await fetch("/predict-sequence", {
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
        prediction: "?",
        confidence: 0,
        bounds: bounds,
        strokes: strokesToPredict,
        label: initialLabel,
    };
    state.finalizedLetters.push(newLetter);

    // Clear active strokes so the next drawing is a new letter
    state.strokes = [];
    updateStats();
    redraw();
    updateRecognizedWords();

    if (!state.predictMode) {
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
    } catch (error) {
        console.error("Failed to finalize letter prediction:", error);
    }

    redraw();
    updateRecognizedWords();
}

async function runInference() {
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

syncSpeed();
resizeCanvas();
updateStats();
loadModel();
loadDictionary();
pickNextPracticeWord();
