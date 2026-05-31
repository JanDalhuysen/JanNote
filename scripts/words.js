const fs = require("fs/promises");

async function filterCursiveWords(inputFilename, outputFilename) {
    // const forbiddenLetters = new Set(["x", "q", "i", "j", "t", "k", "f"]);
    const forbiddenLetters = new Set(["q", "x", ".", "'", "-", "ê"]);

    try {
        // Read the file
        const data = await fs.readFile(inputFilename, "utf-8");

        // Split into lines, trim, and remove empty lines
        let words = data
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        // Filter words that don't contain forbidden letters
        let cleanWords = words.filter((word) => {
            return ![...word.toLowerCase()].some((char) => forbiddenLetters.has(char));
        });

        // Remove duplicates while preserving order
        const seen = new Set();
        cleanWords = cleanWords.filter((word) => {
            const lower = word.toLowerCase();
            if (seen.has(lower)) return false;
            seen.add(lower);
            return true;
        });

        // Convert to lowercase
        cleanWords = cleanWords.map((word) => word.toLowerCase());

        // Keep only words with less than 6 characters
        cleanWords = cleanWords.filter((word) => word.length < 6);

        // Write to output file
        const outputContent = cleanWords.join("\n") + (cleanWords.length ? "\n" : "");
        await fs.writeFile(outputFilename, outputContent, "utf-8");

        console.log(
            `Success! Processed ${words.length} words. Saved ${cleanWords.length} seamless words to '${outputFilename}'.`,
        );
    } catch (error) {
        if (error.code === "ENOENT") {
            console.error(`Error: The file '${inputFilename}' was not found. Please check the path.`);
        } else {
            console.error("An error occurred:", error.message);
        }
    }
}

// Run the program
async function main() {
    const inputFile = "all_words.txt";
    const outputFile = "dictionary.txt";

    await filterCursiveWords(inputFile, outputFile);
}

main();
