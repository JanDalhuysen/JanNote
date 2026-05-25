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
const jsonData = fs.readFileSync("dutch.json", "utf-8");
const data = JSON.parse(jsonData);

// Extract the words array
const words = data.words;
// Join the words with a newline character
const textData = words.join("\n");

// Write the text data to a new file
fs.writeFileSync("dutch.txt", textData);
