const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

let pythonProcess = null;
let pythonReady = false;
let pendingCallbacks = [];

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

    if (!fs.existsSync(modelPath) || !fs.existsSync(classesPath)) {
        console.log("No trained model files found yet. Server will start python bridge once model is trained.");
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
    if (filename === "handwriting_model.keras") {
        // Debounce watch events as writing the keras file might trigger multiple events
        clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
            console.log("Detected changes to handwriting_model.keras. Reloading Python bridge...");
            startPythonBridge();
        }, 1000);
    }
});

// Start the bridge on startup (if files exist)
startPythonBridge();

// Endpoint to run predictions
app.post("/predict", (req, res) => {
    console.log(
        `[HTTP POST /predict] Incoming request. Body keys: [${Object.keys(req.body || {})}]. Points count: ${req.body?.points?.length ?? "undefined"}`,
    );
    const points = req.body.points;
    if (!points || !Array.isArray(points)) {
        console.warn("[HTTP POST /predict] Rejected: missing or invalid points parameter.");
        return res.status(400).json({ error: "Missing points list in request body." });
    }

    const modelPath = path.join(__dirname, "handwriting_model.keras");
    if (!fs.existsSync(modelPath)) {
        console.warn("[HTTP POST /predict] Rejected: model files do not exist. User needs to run train.py.");
        return res.status(404).json({ error: "Model not trained yet. Run train.py first!" });
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
            sendToPython(points, res);
        }, 1200);
        return;
    }

    sendToPython(points, res);
});

// Endpoint to check model status
app.get("/model-status", (req, res) => {
    const modelPath = path.join(__dirname, "handwriting_model.keras");
    const exists = fs.existsSync(modelPath);
    res.json({
        modelTrained: exists,
        bridgeReady: pythonReady,
    });
});

function sendToPython(points, res) {
    console.log(`[Python Bridge] Writing ${points.length} points to predict.py stdin...`);
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

    pythonProcess.stdin.write(JSON.stringify(points) + "\n");
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`JanNote server is running on port ${PORT}.`);
    console.log(`Open your browser and visit: http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop the server.`);
});
