const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const shouldDelete = process.argv.includes("--delete");
const DATASET_FILE_PREFIX = "handwriting_dataset_";

// Calculate distance between two points
function distance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function getSampleKey(file, sampleId) {
    return `${file}::${sampleId}`;
}

function createBackupRunDirectory() {
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(dataDir, "_outlier_backups", runId);
}

function backupDatasetFile(filePath, backupDir) {
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = path.join(backupDir, path.basename(filePath));
    if (fs.existsSync(backupPath)) {
        throw new Error(`Backup already exists at ${backupPath}`);
    }

    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

// Extract features from a sample
function extractFeatures(sample) {
    let minX = Infinity,
        maxX = -Infinity;
    let minY = Infinity,
        maxY = -Infinity;
    let totalLength = 0;

    if (!Array.isArray(sample.rawStrokes) || sample.rawStrokes.length === 0) {
        return { width: 0, height: 0, totalLength: 0, strokeCount: 0 };
    }

    sample.rawStrokes.forEach((stroke) => {
        const points = Array.isArray(stroke?.points) ? stroke.points : [];
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) {
                continue;
            }
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;

            if (i > 0) {
                const prev = points[i - 1];
                if (Number.isFinite(prev?.x) && Number.isFinite(prev?.y)) {
                    totalLength += distance(prev, p);
                }
            }
        }
    });

    const width = maxX === -Infinity ? 0 : maxX - minX;
    const height = maxY === -Infinity ? 0 : maxY - minY;

    return {
        width,
        height,
        totalLength,
        strokeCount: typeof sample.strokeCount === "number" ? sample.strokeCount : sample.rawStrokes.length,
    };
}

// Standard Deviation and Mean
function getStats(values) {
    if (values.length === 0) return { mean: 0, stdDev: 0 };
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return { mean, stdDev: Math.sqrt(variance) };
}

function analyze() {
    console.log(`Checking data directory: ${dataDir}`);
    if (!fs.existsSync(dataDir)) {
        console.error("Data directory does not exist.");
        return;
    }

    const files = fs.readdirSync(dataDir).filter((f) => f.startsWith(DATASET_FILE_PREFIX) && f.endsWith(".json"));

    const statsByLabel = Object.create(null);
    const allSamples = [];

    console.log(`Reading ${files.length} dataset files...`);

    files.forEach((file) => {
        const filePath = path.join(dataDir, file);
        try {
            const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

            if (data.samples) {
                data.samples.forEach((sample) => {
                    if (!sample?.id || !sample?.label) {
                        return;
                    }

                    const label = sample.label;
                    if (!statsByLabel[label]) {
                        statsByLabel[label] = {
                            samples: [],
                            features: { width: [], height: [], totalLength: [], strokeCount: [] },
                        };
                    }

                    const features = extractFeatures(sample);
                    const sampleData = {
                        id: sample.id,
                        sampleKey: getSampleKey(file, sample.id),
                        file,
                        label,
                        features,
                    };

                    statsByLabel[label].samples.push(sampleData);
                    allSamples.push(sampleData);

                    statsByLabel[label].features.width.push(features.width);
                    statsByLabel[label].features.height.push(features.height);
                    statsByLabel[label].features.totalLength.push(features.totalLength);
                    statsByLabel[label].features.strokeCount.push(features.strokeCount);
                });
            }
        } catch (e) {
            console.error(`Error reading ${file}: ${e.message}`);
        }
    });

    console.log(`Extracted features for ${allSamples.length} total samples.`);

    const badSamples = [];

    // Z-score threshold. Adjust this if you get too many or too few results.
    // 3.0 is a typical value for detecting extreme outliers in a normal distribution.
    // const Z_THRESHOLD = 3.0;
    const Z_THRESHOLD = 2.5;

    for (const label in statsByLabel) {
        const group = statsByLabel[label];
        if (group.samples.length < 5) continue; // Not enough data for this label to find outliers

        const widthStats = getStats(group.features.width);
        const heightStats = getStats(group.features.height);
        const lengthStats = getStats(group.features.totalLength);

        group.samples.forEach((sample) => {
            const f = sample.features;

            const widthZ = Math.abs((f.width - widthStats.mean) / (widthStats.stdDev || 1));
            const heightZ = Math.abs((f.height - heightStats.mean) / (heightStats.stdDev || 1));
            const lengthZ = Math.abs((f.totalLength - lengthStats.mean) / (lengthStats.stdDev || 1));

            const reasons = [];
            if (widthZ > Z_THRESHOLD) reasons.push(`width is outlier (z=${widthZ.toFixed(2)})`);
            if (heightZ > Z_THRESHOLD) reasons.push(`height is outlier (z=${heightZ.toFixed(2)})`);
            if (lengthZ > Z_THRESHOLD) reasons.push(`total length is outlier (z=${lengthZ.toFixed(2)})`);

            if (reasons.length > 0) {
                badSamples.push({
                    id: sample.id,
                    sampleKey: sample.sampleKey,
                    label: sample.label,
                    file: sample.file,
                    reasons: reasons,
                    features: f,
                });
            }
        });
    }

    console.log(`Found ${badSamples.length} potential low-quality or bad samples.`);

    // Sort primarily by label, then by file, then by id
    badSamples.sort((a, b) => {
        const labelCompare = a.label.localeCompare(b.label);
        if (labelCompare !== 0) return labelCompare;

        const fileCompare = a.file.localeCompare(b.file);
        if (fileCompare !== 0) return fileCompare;

        return String(a.id).localeCompare(String(b.id));
    });

    // Output to a JSON file to review
    const outputPath = path.join(__dirname, "outliers.json");
    fs.writeFileSync(outputPath, JSON.stringify(badSamples, null, 2));

    console.log(`Wrote details of all outliers to ${outputPath}`);

    // Print a few examples
    const examplesToShow = Math.min(15, badSamples.length);
    if (examplesToShow > 0) {
        console.log(`\nHere are the first ${examplesToShow} examples:`);
        for (let i = 0; i < examplesToShow; i++) {
            const b = badSamples[i];
            console.log(`- Label: '${b.label}' | ID: ${b.id} | File: ${b.file} | Reasons: ${b.reasons.join(", ")}`);
        }
    }

    if (shouldDelete && badSamples.length > 0) {
        console.log(`\nDeleting ${badSamples.length} outliers from dataset files...`);
        const badSamplesByFile = {};
        const backupDir = createBackupRunDirectory();
        badSamples.forEach((b) => {
            if (!badSamplesByFile[b.file]) badSamplesByFile[b.file] = new Set();
            badSamplesByFile[b.file].add(b.id);
        });

        let deletedCount = 0;
        let backedUpFiles = 0;
        for (const [file, idsToDelete] of Object.entries(badSamplesByFile)) {
            const filePath = path.join(dataDir, file);
            try {
                const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
                if (data.samples) {
                    const originalLength = data.samples.length;
                    const filteredSamples = data.samples.filter((s) => !idsToDelete.has(s.id));
                    const removedCount = originalLength - filteredSamples.length;

                    if (removedCount === 0) {
                        continue;
                    }

                    const backupPath = backupDatasetFile(filePath, backupDir);
                    backedUpFiles++;
                    data.samples = filteredSamples;

                    if (data.metadata) {
                        data.metadata.totalSamples = data.samples.length;
                        data.metadata.totalSequenceSamples = Array.isArray(data.sequenceSamples)
                            ? data.sequenceSamples.length
                            : 0;

                        let totalStrokes = 0;
                        let totalLabeledStrokes = 0;

                        if (Array.isArray(data.samples)) {
                            data.samples.forEach((s) => {
                                const count =
                                    typeof s.strokeCount === "number" ? s.strokeCount : s.rawStrokes ? s.rawStrokes.length : 0;
                                totalStrokes += count;
                                if (s.label) {
                                    totalLabeledStrokes += count;
                                }
                            });
                        }
                        if (Array.isArray(data.sequenceSamples)) {
                            data.sequenceSamples.forEach((s) => {
                                const count =
                                    typeof s.strokeCount === "number" ? s.strokeCount : s.rawStrokes ? s.rawStrokes.length : 0;
                                totalStrokes += count;
                                if (s.text) {
                                    totalLabeledStrokes += count;
                                }
                            });
                        }

                        data.metadata.totalStrokes = totalStrokes;
                        data.metadata.totalLabeledStrokes = totalLabeledStrokes;
                    }

                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                    console.log(`- Backed up ${file} to ${backupPath}`);
                    console.log(`- Removed ${removedCount} samples from ${file}`);
                    deletedCount += removedCount;
                }
            } catch (e) {
                console.error(`Error deleting from ${file}: ${e.message}`);
            }
        }
        if (backedUpFiles > 0) {
            console.log(`Backups were written to ${backupDir}`);
        }
        console.log(`Successfully deleted ${deletedCount} samples from datasets.`);
    } else if (!shouldDelete && badSamples.length > 0) {
        console.log(`\nRun with --delete flag to permanently remove these outliers from the dataset files.`);
    }
}

analyze();
