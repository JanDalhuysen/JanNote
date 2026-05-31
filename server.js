const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

const app = express();
const PORT = 3000;

const autosaveDir = path.join(__dirname, "autosave");
const DATA_DIR = path.join(__dirname, "data");

app.use(express.json());
app.use(express.static(__dirname));

let pythonProcess = null;
let pythonReady = false;
let pendingCallbacks = [];

function getDatasetFilesFromDirs(dirs) {
    const files = [];
    for (const dir of dirs) {
        const absDir = path.join(__dirname, dir);
        if (!fs.existsSync(absDir)) continue;
        for (const name of fs.readdirSync(absDir)) {
            if (/^handwriting_dataset_.*\.json$/i.test(name)) {
                files.push(path.join(absDir, name));
            }
        }
    }
    return [...new Set(files)].sort();
}

function readDatasetMetadata(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        const metadata = data?.metadata || {};
        return {
            title: metadata.title || "",
            datasetId: metadata.datasetId || "",
            updatedAt: metadata.autosavedAt || metadata.exportedAt || "",
        };
    } catch (err) {
        console.warn(`[Datasets] Failed to read metadata from ${filePath}:`, err.message);
        return { title: "", datasetId: "", updatedAt: "" };
    }
}

function getDatasetList() {
    const sources = [
        { dir: DATA_DIR, source: "data", pattern: /^handwriting_dataset_.*\.json$/i },
        { dir: autosaveDir, source: "autosave", pattern: /^handwriting_autosave_.*\.json$/i },
    ];

    const datasets = [];

    for (const source of sources) {
        if (!fs.existsSync(source.dir)) continue;
        const files = fs.readdirSync(source.dir);
        for (const name of files) {
            if (!source.pattern.test(name)) continue;
            const filePath = path.join(source.dir, name);
            const stats = fs.statSync(filePath);
            const meta = readDatasetMetadata(filePath);
            const updatedAt = meta.updatedAt ? new Date(meta.updatedAt).getTime() : stats.mtimeMs;
            const title = meta.title || name.replace(/\.json$/i, "");
            datasets.push({
                id: `${source.source}__${name}`,
                title,
                source: source.source,
                updatedAt,
                file: name,
            });
        }
    }

    datasets.sort((a, b) => b.updatedAt - a.updatedAt);
    return datasets;
}

function buildCoverageStats() {
    const files = getDatasetFilesFromDirs(["data", "data1", "data2"]);
    const wordCounts = {};
    const letterCounts = {};
    let sequenceSamples = 0;
    let letterSamples = 0;

    for (const file of files) {
        try {
            const raw = fs.readFileSync(file, "utf-8");
            const data = JSON.parse(raw);

            for (const sample of data.sequenceSamples || []) {
                const word = String(sample?.text || "")
                    .trim()
                    .toLowerCase();
                if (!word) continue;
                wordCounts[word] = (wordCounts[word] || 0) + 1;
                sequenceSamples += 1;
            }

            for (const sample of data.samples || []) {
                const label = String(sample?.label || "")
                    .trim()
                    .toLowerCase();
                if (label.length !== 1 || !/^[a-z]$/.test(label)) continue;
                letterCounts[label] = (letterCounts[label] || 0) + 1;
                letterSamples += 1;
            }
        } catch (err) {
            console.warn(`[Coverage] Skipping unreadable dataset file: ${file}`, err.message);
        }
    }

    const rareWords = Object.entries(wordCounts)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([word, count]) => ({ word, count }));
    const rareLetters = Object.entries(letterCounts)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([letter, count]) => ({ letter, count }));

    return {
        sourceFileCount: files.length,
        sequenceSamples,
        letterSamples,
        uniqueWords: rareWords.length,
        rareWords,
        rareLetters,
    };
}

function startPythonBridge() {
    if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
        pythonReady = false;
        // Clean up any pending requests
        pendingCallbacks.forEach((cb) => cb.reject(new Error("Python bridge restarted")));
        pendingCallbacks = [];
    }

    const modelPath = path.join(__dirname, "handwriting_model.keras");
    const classesPath = path.join(__dirname, "class_names.json");
    const seqModelPath = path.join(__dirname, "handwriting_sequence_model.keras");
    const seqVocabPath = path.join(__dirname, "sequence_vocab.json");

    const hasCharModel = fs.existsSync(modelPath) && fs.existsSync(classesPath);
    const hasSeqModel = fs.existsSync(seqModelPath) && fs.existsSync(seqVocabPath);
    if (!hasCharModel && !hasSeqModel) {
        console.log("No trained model files found yet. Server will start python bridge once a model is trained.");
        return;
    }

    console.log("Starting Python inference bridge (predict.py)...");

    // Spawn predict.py. We run 'python' using shell-independent spawn.
    pythonProcess = spawn("python", ["predict.py"], { cwd: __dirname });

    let stdoutBuffer = "";

    pythonProcess.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        let lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop(); // keep partial line in buffer

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (line === "READY") {
                pythonReady = true;
                console.log("Python inference bridge is READY and listening.");
                continue;
            }

            if (line.startsWith("ERROR:")) {
                console.error("Python Bridge Error:", line);
                continue;
            }

            // Parse response and resolve the oldest pending request
            try {
                console.log(`[Python Bridge stdout] Raw output: "${line}"`);
                const responseData = JSON.parse(line);
                console.log(
                    `[Python Bridge] Parsed response: character='${responseData.prediction}', confidence=${responseData.confidence}`,
                );
                const nextCallback = pendingCallbacks.shift();
                if (nextCallback) {
                    nextCallback.resolve(responseData);
                }
            } catch (err) {
                console.error("[Python Bridge] Failed to parse prediction output:", line, err);
            }
        }
    });

    pythonProcess.stderr.on("data", (data) => {
        console.error(`Python stderr: ${data.toString()}`);
    });

    pythonProcess.on("close", (code) => {
        console.log(`Python process exited with code ${code}`);
        pythonReady = false;
        pythonProcess = null;
    });

    pythonProcess.on("error", (err) => {
        console.error("Failed to start predict.py. Is python installed and on PATH?", err);
        pythonReady = false;
        pythonProcess = null;
    });
}

// Watch model file for changes to automatically hot-reload the Python script
let watchTimeout = null;
fs.watch(__dirname, (eventType, filename) => {
    if (filename === "handwriting_model.keras" || filename === "handwriting_sequence_model.keras") {
        // Debounce watch events as writing the keras file might trigger multiple events
        clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
            console.log("Detected changes to model files. Reloading Python bridge...");
            startPythonBridge();
        }, 1000);
    }
});

// Start the bridge on startup (if files exist)
startPythonBridge();

function handlePredictRequest(req, res, mode = "char") {
    console.log(
        `[HTTP POST /predict] Incoming request. Body keys: [${Object.keys(req.body || {})}]. Points count: ${req.body?.points?.length ?? "undefined"}`,
    );
    const points = req.body.points;
    if (!points || !Array.isArray(points)) {
        console.warn("[HTTP POST /predict] Rejected: missing or invalid points parameter.");
        return res.status(400).json({ error: "Missing points list in request body." });
    }

    const modelPath = path.join(__dirname, "handwriting_model.keras");
    const classesPath = path.join(__dirname, "class_names.json");
    const seqModelPath = path.join(__dirname, "handwriting_sequence_model.keras");
    const seqVocabPath = path.join(__dirname, "sequence_vocab.json");

    const hasCharModel = fs.existsSync(modelPath) && fs.existsSync(classesPath);
    const hasSeqModel = fs.existsSync(seqModelPath) && fs.existsSync(seqVocabPath);

    if (mode === "char" && !hasCharModel) {
        console.warn("[HTTP POST /predict] Rejected: character model files do not exist. User needs to run train.py.");
        return res.status(404).json({ error: "Character model not trained yet. Run train.py first!" });
    }

    if (mode === "sequence" && !hasSeqModel) {
        console.warn("[HTTP POST /predict] Rejected: sequence model files do not exist. User needs to run train.py.");
        return res.status(404).json({ error: "Sequence model not trained yet. Run train.py with sequenceSamples." });
    }

    if (mode === "hybrid" && !hasCharModel && !hasSeqModel) {
        console.warn("[HTTP POST /predict] Rejected: no model files do not exist. User needs to run train.py.");
        return res.status(404).json({ error: "No model trained yet. Run train.py first!" });
    }

    // If python process is not running or not ready, try starting it (in case they just trained it)
    if (!pythonProcess || !pythonReady) {
        console.log("[HTTP POST /predict] Python bridge is not running/ready. Attempting to start it...");
        startPythonBridge();
        // Give it 1.2 seconds to start, otherwise fail this request
        setTimeout(() => {
            if (!pythonReady) {
                console.error("[HTTP POST /predict] Python bridge failed to ready up within 1.2s.");
                return res.status(503).json({ error: "Python bridge is starting up. Please try drawing again in a moment." });
            }
            console.log("[HTTP POST /predict] Python bridge started successfully. Forwarding points.");
            sendToPython(points, res, mode);
        }, 1200);
        return;
    }

    sendToPython(points, res, mode);
}

// Endpoint to run single-character predictions
app.post("/predict", (req, res) => handlePredictRequest(req, res, "char"));

// Endpoint scaffold for sequence predictions (currently uses same model/bridge)
app.post("/predict-sequence", (req, res) => handlePredictRequest(req, res, "sequence"));

// Endpoint for hybrid predictions (sequence + char fusion)
app.post("/predict-hybrid", (req, res) => handlePredictRequest(req, res, "hybrid"));

// Endpoint to check model status
app.get("/model-status", (req, res) => {
    const modelPath = path.join(__dirname, "handwriting_model.keras");
    const seqModelPath = path.join(__dirname, "handwriting_sequence_model.keras");
    const exists = fs.existsSync(modelPath);
    const seqExists = fs.existsSync(seqModelPath);
    res.json({
        modelTrained: exists,
        sequenceModelTrained: seqExists,
        bridgeReady: pythonReady,
    });
});

app.get("/practice-prompts", (req, res) => {
    try {
        const stats = buildCoverageStats();
        res.json(stats);
    } catch (error) {
        console.error("[HTTP GET /practice-prompts] Failed:", error);
        res.status(500).json({ error: "Failed to build coverage stats." });
    }
});

// GET /api/datasets - list available datasets (data + autosave)
app.get("/api/datasets", (req, res) => {
    try {
        const datasets = getDatasetList();
        res.json(datasets);
    } catch (err) {
        console.error("Failed to list datasets:", err);
        res.status(500).json({ error: "Failed to list datasets." });
    }
});

function resolveDatasetFile(datasetId) {
    const parts = String(datasetId || "").split("__");
    const source = parts.shift();
    const filename = parts.join("__");
    if (!filename || !/^[a-z0-9._-]+\.json$/i.test(filename)) {
        return null;
    }
    const baseDir = source === "data" ? DATA_DIR : source === "autosave" ? autosaveDir : null;
    if (!baseDir) return null;
    const resolved = path.resolve(baseDir, filename);
    if (!resolved.startsWith(path.resolve(baseDir))) {
        return null;
    }
    return resolved;
}

// GET /api/datasets/:id - load dataset by id
app.get("/api/datasets/:id", (req, res) => {
    try {
        const filePath = resolveDatasetFile(req.params.id);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Dataset not found." });
        }
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        res.json(data);
    } catch (err) {
        console.error("Failed to read dataset:", err);
        res.status(500).json({ error: "Failed to read dataset." });
    }
});

app.post("/autosave-dataset", (req, res) => {
    try {
        const rawSessionId = String(req.body?.sessionId || "").trim();
        const rawDatasetId = String(req.body?.datasetId || req.body?.dataset?.metadata?.datasetId || "").trim();
        const rawDatasetTitle = String(req.body?.datasetTitle || req.body?.dataset?.metadata?.title || "").trim();
        const dataset = req.body?.dataset;
        if (!rawSessionId) {
            return res.status(400).json({ error: "Missing sessionId." });
        }
        if (!dataset || !Array.isArray(dataset.samples) || !Array.isArray(dataset.sequenceSamples)) {
            return res.status(400).json({ error: "Invalid dataset payload." });
        }

        const safeSessionId = rawSessionId.replace(/[^a-z0-9_-]/gi, "").slice(0, 64);
        const rawDatasetIdentity = rawDatasetId || rawDatasetTitle;
        const safeDatasetId = rawDatasetIdentity.replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "dataset";
        if (!safeSessionId) {
            return res.status(400).json({ error: "Invalid sessionId." });
        }

        if (!fs.existsSync(autosaveDir)) {
            fs.mkdirSync(autosaveDir, { recursive: true });
        }

        const autosavePayload = {
            ...dataset,
            metadata: {
                ...(dataset.metadata || {}),
                autosavedAt: new Date().toISOString(),
                autosaveSessionId: safeSessionId,
                datasetId: safeDatasetId,
                title: rawDatasetTitle || dataset?.metadata?.title || "",
            },
        };
        const targetPath = path.join(autosaveDir, `handwriting_autosave_${safeDatasetId}_${safeSessionId}.json`);
        fs.writeFileSync(targetPath, JSON.stringify(autosavePayload, null, 2), "utf-8");

        return res.json({
            ok: true,
            file: path.basename(targetPath),
            totalSamples: autosavePayload.samples.length,
            totalSequenceSamples: autosavePayload.sequenceSamples.length,
        });
    } catch (error) {
        console.error("[HTTP POST /autosave-dataset] Failed:", error);
        return res.status(500).json({ error: "Failed to autosave dataset." });
    }
});

function sendToPython(points, res, mode = "char") {
    console.log(`[Python Bridge] Writing ${points.length} points to predict.py stdin (mode=${mode})...`);
    const timeout = setTimeout(() => {
        console.error("[Python Bridge] TIMEOUT waiting for python response (4s limit reached).");
        // Remove callback from queue on timeout
        const idx = pendingCallbacks.findIndex((cb) => cb.res === res);
        if (idx !== -1) {
            pendingCallbacks.splice(idx, 1);
        }
        res.status(504).json({ error: "Inference timed out." });
    }, 4000);

    pendingCallbacks.push({
        res: res,
        resolve: (data) => {
            clearTimeout(timeout);
            console.log(`[Python Bridge] Request resolved successfully.`);
            res.json(data);
        },
        reject: (err) => {
            clearTimeout(timeout);
            console.error(`[Python Bridge] Request failed: ${err.message}`);
            res.status(500).json({ error: err.message });
        },
    });

    pythonProcess.stdin.write(JSON.stringify({ mode, points }) + "\n");
}

const NOTES_DIR = path.join(__dirname, "notes");
if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
}

// In-memory active drawing strokes of other users
// Structure: { [noteId]: { [clientSessionId]: { strokes, currentStroke, lastActive } } }
const activeStrokes = {};

// Clean up inactive sessions periodically (stale after 5 seconds)
setInterval(() => {
    const now = Date.now();
    for (const noteId in activeStrokes) {
        for (const sessionId in activeStrokes[noteId]) {
            if (now - activeStrokes[noteId][sessionId].lastActive > 5000) {
                delete activeStrokes[noteId][sessionId];
            }
        }
        if (Object.keys(activeStrokes[noteId]).length === 0) {
            delete activeStrokes[noteId];
        }
    }
}, 5000);

// Helper functions for reading/writing note files
function getNoteFilePath(noteId) {
    const safeId = String(noteId).replace(/[^a-z0-9_-]/gi, "");
    return path.join(NOTES_DIR, `${safeId}.json`);
}

function getNoteData(noteId) {
    const filePath = getNoteFilePath(noteId);
    if (!fs.existsSync(filePath)) {
        return {
            id: noteId,
            title: "Untitled Note",
            finalizedLetters: [],
            finalizedWords: [],
            updatedAt: Date.now(),
        };
    }
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    } catch (err) {
        console.error(`Error reading note ${noteId}:`, err);
        return {
            id: noteId,
            title: "Untitled Note",
            finalizedLetters: [],
            finalizedWords: [],
            updatedAt: Date.now(),
        };
    }
}

function saveNoteData(noteId, data) {
    const filePath = getNoteFilePath(noteId);
    data.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// GET /api/notes - list all notes metadata
app.get("/api/notes", (req, res) => {
    try {
        if (!fs.existsSync(NOTES_DIR)) {
            fs.mkdirSync(NOTES_DIR, { recursive: true });
        }
        const files = fs.readdirSync(NOTES_DIR);
        const notes = [];
        for (const file of files) {
            if (file.endsWith(".json")) {
                const noteId = file.slice(0, -5);
                const data = getNoteData(noteId);
                notes.push({
                    id: data.id,
                    title: data.title,
                    updatedAt: data.updatedAt,
                });
            }
        }
        notes.sort((a, b) => b.updatedAt - a.updatedAt);
        res.json(notes);
    } catch (err) {
        console.error("Failed to list notes:", err);
        res.status(500).json({ error: "Failed to list notes." });
    }
});

// POST /api/notes - create new note
app.post("/api/notes", (req, res) => {
    try {
        const noteId = `note-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const newNote = {
            id: noteId,
            title: "Untitled Note",
            finalizedLetters: [],
            finalizedWords: [],
            updatedAt: Date.now(),
        };
        saveNoteData(noteId, newNote);
        res.status(201).json(newNote);
    } catch (err) {
        console.error("Failed to create note:", err);
        res.status(500).json({ error: "Failed to create note." });
    }
});

// GET /api/notes/:id - get single note
app.get("/api/notes/:id", (req, res) => {
    try {
        const note = getNoteData(req.params.id);
        res.json(note);
    } catch (err) {
        console.error("Failed to get note:", err);
        res.status(500).json({ error: "Failed to get note." });
    }
});

// DELETE /api/notes/:id - delete note
app.delete("/api/notes/:id", (req, res) => {
    try {
        const filePath = getNoteFilePath(req.params.id);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        if (activeStrokes[req.params.id]) {
            delete activeStrokes[req.params.id];
        }
        res.json({ ok: true });
    } catch (err) {
        console.error("Failed to delete note:", err);
        res.status(500).json({ error: "Failed to delete note." });
    }
});

// POST /api/notes/:id/rename - rename note
app.post("/api/notes/:id/rename", (req, res) => {
    try {
        const { title } = req.body;
        const note = getNoteData(req.params.id);
        note.title = title || "Untitled Note";
        saveNoteData(req.params.id, note);
        res.json({ ok: true, title: note.title });
    } catch (err) {
        console.error("Failed to rename note:", err);
        res.status(500).json({ error: "Failed to rename note." });
    }
});

// POST /api/notes/:id/clear - clear note contents
app.post("/api/notes/:id/clear", (req, res) => {
    try {
        const note = getNoteData(req.params.id);
        note.finalizedLetters = [];
        note.finalizedWords = [];
        saveNoteData(req.params.id, note);
        res.json({ ok: true });
    } catch (err) {
        console.error("Failed to clear note:", err);
        res.status(500).json({ error: "Failed to clear note." });
    }
});

// POST /api/notes/:id/finalize-letter - add a finalized letter
app.post("/api/notes/:id/finalize-letter", (req, res) => {
    try {
        const { letter } = req.body;
        if (!letter || !letter.id) {
            return res.status(400).json({ error: "Invalid letter data." });
        }
        const note = getNoteData(req.params.id);
        note.finalizedLetters.push(letter);
        saveNoteData(req.params.id, note);
        res.json({ ok: true });
    } catch (err) {
        console.error("Failed to finalize letter:", err);
        res.status(500).json({ error: "Failed to finalize letter." });
    }
});

// POST /api/notes/:id/finalize-word - add a finalized word
app.post("/api/notes/:id/finalize-word", (req, res) => {
    try {
        const { word } = req.body;
        if (!word || !word.id) {
            return res.status(400).json({ error: "Invalid word data." });
        }
        const note = getNoteData(req.params.id);
        note.finalizedWords.push(word);
        saveNoteData(req.params.id, note);
        res.json({ ok: true });
    } catch (err) {
        console.error("Failed to finalize word:", err);
        res.status(500).json({ error: "Failed to finalize word." });
    }
});

// POST /api/notes/:id/update-letter-prediction - update prediction for a letter
app.post("/api/notes/:id/update-letter-prediction", (req, res) => {
    try {
        const { letterId, prediction, confidence } = req.body;
        const note = getNoteData(req.params.id);
        const letter = note.finalizedLetters.find((l) => l.id === letterId);
        if (letter) {
            letter.prediction = prediction;
            letter.confidence = confidence;
            saveNoteData(req.params.id, note);
            res.json({ ok: true });
        } else {
            res.status(404).json({ error: "Letter not found." });
        }
    } catch (err) {
        console.error("Failed to update letter prediction:", err);
        res.status(500).json({ error: "Failed to update prediction." });
    }
});

// POST /api/notes/:id/update-word-prediction - update prediction for a word
app.post("/api/notes/:id/update-word-prediction", (req, res) => {
    try {
        const { wordId, prediction, confidence, letterSpans, usedTimesteps } = req.body;
        const note = getNoteData(req.params.id);
        const word = note.finalizedWords.find((w) => w.id === wordId);
        if (word) {
            word.prediction = prediction;
            word.confidence = confidence;
            word.letterSpans = letterSpans || [];
            word.usedTimesteps = usedTimesteps || 0;
            saveNoteData(req.params.id, note);
            res.json({ ok: true });
        } else {
            res.status(404).json({ error: "Word not found." });
        }
    } catch (err) {
        console.error("Failed to update word prediction:", err);
        res.status(500).json({ error: "Failed to update prediction." });
    }
});

// POST /api/notes/:id/update-labels - replace items (for relabeling / clear labels)
app.post("/api/notes/:id/update-labels", (req, res) => {
    try {
        const { finalizedLetters, finalizedWords } = req.body;
        const note = getNoteData(req.params.id);
        if (finalizedLetters) note.finalizedLetters = finalizedLetters;
        if (finalizedWords) note.finalizedWords = finalizedWords;
        saveNoteData(req.params.id, note);
        res.json({ ok: true });
    } catch (err) {
        console.error("Failed to update labels:", err);
        res.status(500).json({ error: "Failed to update labels." });
    }
});

// POST /api/notes/:id/sync - sync client active strokes, get note data and other users' active strokes
app.post("/api/notes/:id/sync", (req, res) => {
    try {
        const noteId = req.params.id;
        const { clientSessionId, strokes, currentStroke } = req.body;

        if (!activeStrokes[noteId]) {
            activeStrokes[noteId] = {};
        }

        if (clientSessionId) {
            activeStrokes[noteId][clientSessionId] = {
                strokes: strokes || [],
                currentStroke: currentStroke || null,
                lastActive: Date.now(),
            };
        }

        const note = getNoteData(noteId);

        // Get active strokes of other sessions
        const others = {};
        if (activeStrokes[noteId]) {
            for (const sessionId in activeStrokes[noteId]) {
                if (sessionId !== clientSessionId) {
                    others[sessionId] = {
                        strokes: activeStrokes[noteId][sessionId].strokes,
                        currentStroke: activeStrokes[noteId][sessionId].currentStroke,
                    };
                }
            }
        }

        res.json({
            title: note.title,
            finalizedLetters: note.finalizedLetters,
            finalizedWords: note.finalizedWords,
            activeStrokes: others,
        });
    } catch (err) {
        console.error("Failed to sync note:", err);
        res.status(500).json({ error: "Failed to sync note." });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`JanNote server is running on port ${PORT}.`);
    console.log(`Open your browser and visit: http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop the server.`);
});
