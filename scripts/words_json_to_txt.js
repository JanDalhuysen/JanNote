// {
//   "name": "afrikaans",
//   "words": [
//     "die",
//     "wees",
//     "en",
//     "'n",
//     "in",
//     "hy",
//     "daai",
//     "vir",
//     "hulle",
//     "ek",
//     "nie",
//     "af",
//     "klein",
//     "hou"
//   ]
// }

// I have a json file with words, and I would like to make a text file with one word per line

const fs = require("fs");

// Read the JSON file
// const jsonData = fs.readFileSync("english.json", "utf-8");
// const data = JSON.parse(jsonData);

// Extract the words array
// const words = data.words;
// Join the words with a newline character
// const textData = words.join("\n");

// Write the text data to a new file
// fs.writeFileSync("english.txt", textData);

// Read all json files in the current directory
const files = fs.readdirSync(".").filter((file) => file.endsWith(".json"));

files.forEach((file) => {
    const jsonData = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(jsonData);
    const words = data.words;
    const textData = words.join("\n");
    const txtFileName = file.replace(".json", ".txt");
    fs.writeFileSync(txtFileName, textData);
});

// Combine all the text files into one file called all_words.txt
const txtFiles = fs.readdirSync(".").filter((file) => file.endsWith(".txt"));
let allWords = "";
txtFiles.forEach((file) => {
    const textData = fs.readFileSync(file, "utf-8");
    allWords += textData + "\n";
});
fs.writeFileSync("all_words.txt", allWords);
