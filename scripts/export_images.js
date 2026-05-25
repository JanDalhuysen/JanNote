const fs = require("fs");
const path = require("path");

function getSafeFolderName(label) {
    if (!label) return "empty";
    if (label.length === 1) {
        const char = label[0];
        const code = char.charCodeAt(0);

        // Uppercase letters
        if (char >= "A" && char <= "Z") {
            return `${char}_upper`;
        }
        // Lowercase letters
        if (char >= "a" && char <= "z") {
            return `${char}_lower`;
        }
        // Digits
        if (char >= "0" && char <= "9") {
            return `${char}_digit`;
        }
        // Common punctuation and special characters
        const specialMap = {
            " ": "space",
            ".": "dot",
            ",": "comma",
            "?": "question",
            "!": "exclamation",
            "-": "dash",
            _: "underscore",
            "+": "plus",
            "=": "equals",
            "/": "slash",
            "\\": "backslash",
            "*": "asterisk",
            ":": "colon",
            ";": "semicolon",
        };
        if (specialMap[char]) {
            return `special_${specialMap[char]}`;
        }
        return `char_code_${code}`;
    }

    // For multi-character labels, replace non-alphanumeric with underscore
    return label.replace(/[^a-zA-Z0-9]/g, "_");
}

function generateSvg(strokes) {
    // Generate paths for each stroke
    let pathsHtml = "";

    for (const stroke of strokes) {
        const points = stroke.points || [];
        if (points.length === 0) continue;

        let pathData = "";
        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            if (i === 0) {
                pathData += `M ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
            } else {
                pathData += ` L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
            }
        }

        // If there's only 1 point, draw a small circle instead of a path line
        if (points.length === 1) {
            const pt = points[0];
            pathsHtml += `  <circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="3" fill="#38bdf8" />\n`;
        } else {
            pathsHtml += `  <path d="${pathData}" stroke="#38bdf8" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round" />\n`;
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" style="background-color: #0f172a; border-radius: 8px;">
  <!-- Inner boundary showing the 256x256 limits -->
  <rect x="0" y="0" width="256" height="256" stroke="#1e293b" stroke-width="2" fill="none" />
${pathsHtml}</svg>`;
}

function generatePng(svgContent) {
    // Use a simple library to convert SVG to PNG (e.g., svg2png or sharp)
    // For this example, we'll use 'sharp' which is a popular image processing library
    const sharp = require("sharp");

    // The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received an instance of Promise
    if (typeof svgContent !== "string") {
        return Promise.reject(new Error("Invalid SVG content"));
    }

    return sharp(Buffer.from(svgContent))
        .png()
        .toBuffer()
        .catch((err) => {
            console.error("Error generating PNG from SVG:", err);
            return null;
        });
}

function main() {
    console.log("=== Handwriting Dataset Image Exporter ===");

    const workspaceDir = __dirname;
    const debugDir = path.join(workspaceDir, "debug");

    // Find all dataset files
    const files = fs.readdirSync(workspaceDir).filter((file) => {
        return file.startsWith("handwriting_dataset_") && file.endsWith(".json");
    });

    if (files.length === 0) {
        console.log("No files matching 'handwriting_dataset_*.json' were found in the current directory.");
        return;
    }

    console.log(`Found ${files.length} dataset file(s).`);

    // Create debug directory
    if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir);
        console.log(`Created output folder: ${debugDir}`);
    }

    let totalExported = 0;

    for (const file of files) {
        const filePath = path.join(workspaceDir, file);
        const fileBasename = path.basename(file, ".json");

        console.log(`Reading dataset file: ${file}`);
        let data;
        try {
            const fileContent = fs.readFileSync(filePath, "utf8");
            data = JSON.parse(fileContent);
        } catch (err) {
            console.error(`Error reading or parsing ${file}:`, err.message);
            continue;
        }

        const samples = data.samples || [];
        if (samples.length === 0) {
            console.log(`No samples found in ${file}. Skipping.`);
            continue;
        }

        console.log(`Processing ${samples.length} samples from ${file}...`);

        for (const sample of samples) {
            const label = sample.label;
            const sampleId = sample.id || `sample_${Date.now()}`;

            // Choose either normalizedStrokes or fall back to rawStrokes
            let strokes = sample.normalizedStrokes;
            let isNormalized = true;

            if (!strokes || strokes.length === 0) {
                strokes = sample.rawStrokes;
                isNormalized = false;
            }

            if (!strokes || strokes.length === 0) {
                continue;
            }

            // If strokes are raw (not normalized to 256x256), we will normalize them dynamically for the SVG
            if (!isNormalized) {
                strokes = normalizeRawStrokes(strokes);
            }

            const folderName = getSafeFolderName(label);
            const labelDir = path.join(debugDir, folderName);

            if (!fs.existsSync(labelDir)) {
                fs.mkdirSync(labelDir, { recursive: true });
            }

            const svgContent = generateSvg(strokes);
            const outputFileName = `${fileBasename}_${sampleId}.svg`;
            const outputPath = path.join(labelDir, outputFileName);

            // fs.writeFileSync(outputPath, svgContent, "utf8");
            totalExported++;

            // Also export png of each svg using sharp
            generatePng(svgContent)
                .then((pngBuffer) => {
                    if (pngBuffer) {
                        const pngFileName = `${fileBasename}_${sampleId}.png`;
                        const pngOutputPath = path.join(labelDir, pngFileName);
                        fs.writeFileSync(pngOutputPath, pngBuffer);
                    }
                })
                .catch((err) => {
                    console.error(`Error generating PNG for ${outputFileName}:`, err);
                });
        }
    }

    console.log(`\n=== Export Complete! ===`);
    console.log(`Exported ${totalExported} samples as SVG images into '${debugDir}'`);
    console.log(`You can open these SVGs directly in any browser (Chrome, Edge, Firefox) to view them.`);
}

function normalizeRawStrokes(strokes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
        const points = stroke.points || [];
        for (const point of points) {
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
        const points = stroke.points || [];
        return {
            points: points.map((point) => ({
                x: (point.x - minX) * scale + offsetX,
                y: (point.y - minY) * scale + offsetY,
            })),
        };
    });
}

main();
