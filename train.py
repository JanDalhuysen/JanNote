import os
import glob
import json
import numpy as np
import tensorflow as tf
from tensorflow import keras

# Set random seed for reproducibility across training runs
tf.random.set_seed(42)
np.random.seed(42)


def load_latest_dataset():
    # Search for files matching handwriting_dataset_*.json
    files = glob.glob("handwriting_dataset_*.json")
    if not files:
        # Fallback to searching any .json file that is not class_names.json or package.json
        all_files = glob.glob("*.json")
        files = [f for f in all_files if f not in ["class_names.json", "package.json", "package-lock.json"]]

    if not files:
        raise FileNotFoundError(
            "Could not find any handwriting dataset JSON files in the current folder.\nPlease download your exported dataset and place it in this directory (e.g. 'handwriting_dataset_XXXX.json')."
        )

    # Sort by modification time to get the newest file
    files.sort(key=os.path.getmtime, reverse=True)
    # load all files and combine them into one dataset
    combined_dataset = {"samples": []}
    for file in files:
        print(f"Loading dataset file: {file}")
        with open(file, "r") as f:
            data = json.load(f)
            if "samples" in data:
                combined_dataset["samples"].extend(data["samples"])
            else:
                print(f"Warning: File {file} does not contain 'samples' key. Skipping.")
    print(f"Total samples loaded from {len(files)} files: {len(combined_dataset['samples'])}")
    return combined_dataset
    # latest_file = files[0]
    # print(f"Found latest dataset file: {latest_file}")

    # with open(latest_file, "r") as f:
    # return json.load(f)


def add_temporal_features(seq_points):
    if not seq_points:
        return []

    featured_seq = []
    for i in range(len(seq_points)):
        x, y, pen_lift, t = seq_points[i]
        if i == 0:
            dt = 0.0
            vx = 0.0
            vy = 0.0
        else:
            prev_x, prev_y, _, prev_t = seq_points[i - 1]
            dt_ms = t - prev_t
            dt = dt_ms / 1000.0  # convert to seconds

            # Avoid division by zero or extremely small time increments
            if dt > 0.001:
                vx = (x - prev_x) / dt
                vy = (y - prev_y) / dt
            else:
                dt = 0.0
                vx = 0.0
                vy = 0.0

        featured_seq.append([x, y, pen_lift, dt, vx, vy])
    return featured_seq


def preprocess_samples(dataset, target_len=128):
    samples = dataset.get("samples", [])
    if not samples:
        raise ValueError("Dataset does not contain any samples.")

    X = []
    y_labels = []

    for sample in samples:
        label = sample.get("label")
        # We use normalizedStrokes which are already scaled to a 256x256 box
        strokes = sample.get("normalizedStrokes", [])

        # Flatten all points from all strokes into a single sequence
        seq_points = []
        global_point_idx = 0
        for stroke in strokes:
            pts = stroke.get("points", [])
            for idx, pt in enumerate(pts):
                # pen_lift = 1.0 if this is the last point of the stroke, else 0.0
                pen_lift = 1.0 if idx == len(pts) - 1 else 0.0

                # Normalize coordinate values to [0.0, 1.0] by dividing by 256
                nx = pt["x"] / 256.0
                ny = pt["y"] / 256.0

                # Fetch time, fallback to generated index time if missing
                t = pt.get("time", float(global_point_idx * 20.0))
                seq_points.append([nx, ny, pen_lift, t])
                global_point_idx += 1

        if not seq_points:
            continue

        # Compute temporal features (dt, vx, vy)
        featured_points = add_temporal_features(seq_points)

        # Resample or pad the sequence to target_len (128 points)
        seq_len = len(featured_points)
        if seq_len < target_len:
            # Pad with 6-element zero vectors
            padded = featured_points + [[0.0, 0.0, 0.0, 0.0, 0.0, 0.0]] * (target_len - seq_len)
            X.append(padded)
        else:
            # Downsample uniformly
            indices = np.linspace(0, seq_len - 1, target_len).astype(int)
            resampled = [featured_points[i] for i in indices]
            X.append(resampled)

        y_labels.append(label)

    return np.array(X, dtype=np.float32), y_labels


def main():
    print("=== Starting Handwriting LSTM Model Trainer ===")

    # 1. Load dataset
    try:
        dataset = load_latest_dataset()
    except Exception as e:
        print(f"Error: {e}")
        return

    # 2. Preprocess data
    X, y_labels = preprocess_samples(dataset)
    print(f"Loaded {len(X)} samples. Input tensor shape: {X.shape}")

    # 3. Create class mapping
    unique_classes = sorted(list(set(y_labels)))
    class_to_idx = {char: idx for idx, char in enumerate(unique_classes)}

    y = np.array([class_to_idx[lbl] for lbl in y_labels], dtype=np.int32)
    num_classes = len(unique_classes)
    print(f"Unique characters to recognize ({num_classes}): {unique_classes}")

    # 4. Save class mapping to JSON
    with open("class_names.json", "w") as f:
        json.dump(unique_classes, f)
    print("Saved class names mapping to class_names.json")

    # 5. Build Recurrent Model (LSTM)
    # We use a slightly smaller capacity model (32 units) to prevent overfitting on
    # a tiny dataset and to stabilize training.
    model = keras.Sequential(
        [
            keras.layers.Input(shape=(128, 6)),
            keras.layers.LSTM(32, return_sequences=True),
            keras.layers.LSTM(32),
            keras.layers.Dense(32, activation="relu"),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )

    # Using Adam with gradient clipping (clipnorm=1.0) to prevent the LSTM
    # from getting stuck/diverging at low accuracy (e.g. 17%).
    opt = keras.optimizers.Adam(learning_rate=0.001, clipnorm=1.0)
    model.compile(optimizer=opt, loss="sparse_categorical_crossentropy", metrics=["accuracy"])

    model.summary()

    # 6. Train the model
    epochs = 32 + 32 + 32
    batch_size = min(16, len(X))

    print(f"\nTraining model for {epochs} epochs (batch_size={batch_size})...")
    model.fit(X, y, epochs=epochs, batch_size=batch_size, validation_split=0.15 if len(X) >= 10 else 0.0, verbose=1)

    # 7. Save standard Keras model
    print("\nSaving model as standard handwriting_model.keras...")
    model.save("handwriting_model.keras")

    print("\n=== Model training complete! ===")
    print("Model saved to: handwriting_model.keras")
    print("Class mapping saved to: class_names.json")


if __name__ == "__main__":
    main()
