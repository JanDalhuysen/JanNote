import os


def filter_cursive_words(input_filename, output_filename):
    # Set of letters that require lifting the pen
    forbidden_letters = {"x", "q"}

    try:
        # Open and read the input file
        with open(input_filename, "r", encoding="utf-8") as infile:
            # Read lines, strip whitespace, and filter out empty lines
            words = [line.strip() for line in infile if line.strip()]

        # Filter words: keep only if none of the forbidden letters are in the word (lowercased)
        clean_words = [word for word in words if not any(char in forbidden_letters for char in word.lower())]

        # Remove duplicates while preserving order
        seen = set()
        clean_words = [x for x in clean_words if not (x in seen or seen.add(x))]

        # Make all words lowercase
        clean_words = [word.lower() for word in clean_words]

        # Write the filtered words to the output file
        with open(output_filename, "w", encoding="utf-8") as outfile:
            for word in clean_words:
                outfile.write(word + "\n")

        print(f"Success! Processed {len(words)} words. Saved {len(clean_words)} seamless words to '{output_filename}'.")

    except FileNotFoundError:
        print(f"Error: The file '{input_filename}' was not found. Please check the path.")


# Run the program
if __name__ == "__main__":
    # Change these filenames if your files have different names
    input_file = "10k.txt"
    output_file = "seamless_words.txt"

    filter_cursive_words(input_file, output_file)
