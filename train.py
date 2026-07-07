import os
import glob
import json
import numpy as np
import tensorflow as tf
from tensorflow import keras

# Set random seed for reproducibility across training runs
tf.random.set_seed(42)
np.random.seed(42)

CHAR_TARGET_LEN = 128
SEQ_TARGET_LEN = 192
MAX_LABEL_LEN = 24
BLANK_TOKEN = "<blank>"


def load_combined_dataset():
    files = glob.glob("handwriting_dataset_*.json")
    if not files:
        all_files = glob.glob("*.json")
        files = [
            f
            for f in all_files
            if f
            not in [
                "class_names.json",
                "package.json",
                "package-lock.json",
                "sequence_vocab.json",
            ]
        ]

    if not files:
        raise FileNotFoundError("No handwriting_dataset_*.json files found.")

    files.sort(key=os.path.getmtime, reverse=True)
    merged = {"samples": [], "sequenceSamples": []}
    for file in files:
        print(f"Loading dataset file: {file}")
        with open(file, "r", encoding="utf-8") as f:
            data = json.load(f)
            merged["samples"].extend(data.get("samples", []))
            merged["sequenceSamples"].extend(data.get("sequenceSamples", []))

    print(f"Loaded {len(merged['samples'])} char samples and {len(merged['sequenceSamples'])} sequence samples from {len(files)} files.")
    return merged


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
            dt = dt_ms / 1000.0
            if dt > 0.001:
                vx = (x - prev_x) / dt
                vy = (y - prev_y) / dt
            else:
                dt = 0.0
                vx = 0.0
                vy = 0.0
        featured_seq.append([x, y, pen_lift, dt, vx, vy])
    return featured_seq


def flatten_strokes(strokes):
    seq_points = []
    global_point_idx = 0
    for stroke in strokes:
        pts = stroke.get("points", [])
        for idx, pt in enumerate(pts):
            pen_lift = 1.0 if idx == len(pts) - 1 else 0.0
            nx = pt["x"] / 256.0
            ny = pt["y"] / 256.0
            t = pt.get("time", float(global_point_idx * 20.0))
            seq_points.append([nx, ny, pen_lift, t])
            global_point_idx += 1
    return seq_points


def pad_or_resample(features, target_len):
    seq_len = len(features)
    if seq_len == 0:
        return np.zeros((target_len, 6), dtype=np.float32), 1
    if seq_len < target_len:
        padded = features + [[0.0] * 6] * (target_len - seq_len)
        return np.asarray(padded, dtype=np.float32), seq_len
    indices = np.linspace(0, seq_len - 1, target_len).astype(int)
    resampled = [features[i] for i in indices]
    return np.asarray(resampled, dtype=np.float32), target_len


def preprocess_char_samples(dataset):
    X = []
    y_labels = []
    for sample in dataset.get("samples", []):
        label = (sample.get("label") or "").strip()
        if not label:
            continue
        strokes = sample.get("normalizedStrokes", [])
        seq = flatten_strokes(strokes)
        if not seq:
            continue
        featured = add_temporal_features(seq)
        x, _ = pad_or_resample(featured, CHAR_TARGET_LEN)
        X.append(x)
        y_labels.append(label)

    if not X:
        return None, None
    return np.asarray(X, dtype=np.float32), y_labels


def preprocess_sequence_samples(dataset):
    sequence_samples = dataset.get("sequenceSamples", [])
    X_list = []
    input_lengths = []
    texts = []
    for sample in sequence_samples:
        text = (sample.get("text") or "").strip()
        if not text:
            continue
        seq = flatten_strokes(sample.get("normalizedStrokes", []))
        if not seq:
            continue
        featured = add_temporal_features(seq)
        x, used_len = pad_or_resample(featured, SEQ_TARGET_LEN)
        X_list.append(x)
        input_lengths.append(used_len)
        texts.append(text)

    if not X_list:
        return None

    charset = sorted(set("".join(texts)))
    char_to_idx = {c: i for i, c in enumerate(charset)}
    labels = np.full((len(texts), MAX_LABEL_LEN), fill_value=-1, dtype=np.int32)
    label_lengths = np.zeros((len(texts), 1), dtype=np.int32)
    for i, text in enumerate(texts):
        encoded = [char_to_idx[c] for c in text[:MAX_LABEL_LEN]]
        labels[i, : len(encoded)] = encoded
        label_lengths[i, 0] = len(encoded)

    return {
        "X": np.asarray(X_list, dtype=np.float32),
        "input_lengths": np.asarray(input_lengths, dtype=np.int32).reshape(-1, 1),
        "labels": labels,
        "label_lengths": label_lengths,
        "charset": charset,
    }


def train_char_model(X, y_labels):
    unique_classes = sorted(list(set(y_labels)))
    class_to_idx = {char: idx for idx, char in enumerate(unique_classes)}
    y = np.array([class_to_idx[lbl] for lbl in y_labels], dtype=np.int32)
    num_classes = len(unique_classes)
    print(f"Training char model with {len(X)} samples, classes={num_classes}")

    with open("class_names.json", "w", encoding="utf-8") as f:
        json.dump(unique_classes, f, ensure_ascii=False)

    model = keras.Sequential(
        [
            keras.layers.Input(shape=(CHAR_TARGET_LEN, 6)),
            keras.layers.LSTM(32, return_sequences=True),
            keras.layers.LSTM(32),
            keras.layers.Dense(32, activation="relu"),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )

    opt = keras.optimizers.Adam(learning_rate=0.001, clipnorm=1.0)
    model.compile(
        optimizer=opt,
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    epochs = 32 + 32 + 32 + 32
    batch_size = min(16, len(X))
    use_validation = len(X) >= 10
    callbacks = []
    if use_validation:
        callbacks.append(
            keras.callbacks.EarlyStopping(
                monitor="val_loss",
                patience=8,
                min_delta=0.001,
                restore_best_weights=True,
            )
        )
        callbacks.append(
            keras.callbacks.ModelCheckpoint(
                filepath="handwriting_model.best.keras",
                monitor="val_loss",
                save_best_only=True,
            )
        )

    model.fit(
        X,
        y,
        epochs=epochs,
        batch_size=batch_size,
        validation_split=0.15 if use_validation else 0.0,
        verbose=1,
        callbacks=callbacks,
    )

    model.save("handwriting_model.keras")
    print("Saved handwriting_model.keras and class_names.json")


def build_sequence_models(vocab_size):
    input_x = keras.layers.Input(shape=(SEQ_TARGET_LEN, 6), name="input_x")
    labels = keras.layers.Input(shape=(MAX_LABEL_LEN,), dtype="int32", name="labels")
    input_len = keras.layers.Input(shape=(1,), dtype="int32", name="input_len")
    label_len = keras.layers.Input(shape=(1,), dtype="int32", name="label_len")

    x = keras.layers.Masking(mask_value=0.0)(input_x)
    x = keras.layers.Bidirectional(keras.layers.LSTM(64, return_sequences=True))(x)
    x = keras.layers.Bidirectional(keras.layers.LSTM(64, return_sequences=True))(x)
    y_pred = keras.layers.Dense(vocab_size + 1, activation="softmax", name="y_pred")(x)

    def ctc_loss_fn(args):
        y_pred_arg, labels_arg, input_len_arg, label_len_arg = args
        return keras.backend.ctc_batch_cost(labels_arg, y_pred_arg, input_len_arg, label_len_arg)

    ctc_loss = keras.layers.Lambda(ctc_loss_fn, name="ctc_loss")([y_pred, labels, input_len, label_len])

    train_model = keras.Model(
        inputs=[input_x, labels, input_len, label_len],
        outputs=ctc_loss,
        name="ctc_train_model",
    )
    infer_model = keras.Model(inputs=input_x, outputs=y_pred, name="ctc_infer_model")
    return train_model, infer_model


def train_sequence_model(seq_data):
    X = seq_data["X"]
    labels = seq_data["labels"]
    input_lengths = seq_data["input_lengths"]
    label_lengths = seq_data["label_lengths"]
    charset = seq_data["charset"]
    vocab_size = len(charset)

    print(f"Training sequence model with {len(X)} samples, charset={vocab_size}")
    train_model, infer_model = build_sequence_models(vocab_size)
    train_model.compile(
        loss={"ctc_loss": lambda _y_true, y_pred: y_pred},
        optimizer=keras.optimizers.Adam(0.001),
    )

    dummy_y = np.zeros((len(X), 1), dtype=np.float32)
    use_validation = len(X) >= 10
    callbacks = []
    if use_validation:
        callbacks.append(
            keras.callbacks.EarlyStopping(
                monitor="val_loss",
                patience=10,
                min_delta=0.001,
                restore_best_weights=True,
            )
        )
        callbacks.append(
            keras.callbacks.ModelCheckpoint(
                filepath="handwriting_sequence_train.best.keras",
                monitor="val_loss",
                save_best_only=True,
            )
        )

    train_model.fit(
        [X, labels, input_lengths, label_lengths],
        dummy_y,
        batch_size=min(8, len(X)),
        epochs=32 + 32 + 32 + 32,
        validation_split=0.1 if use_validation else 0.0,
        verbose=1,
        callbacks=callbacks,
    )

    infer_model.save("handwriting_sequence_model.keras")
    with open("sequence_vocab.json", "w", encoding="utf-8") as f:
        json.dump(
            {
                "chars": charset,
                "blank": BLANK_TOKEN,
                "targetLen": SEQ_TARGET_LEN,
            },
            f,
            ensure_ascii=False,
        )
    print("Saved handwriting_sequence_model.keras and sequence_vocab.json")


def main():
    print("Starting Handwriting Trainer (char + sequence)")
    dataset = load_combined_dataset()

    X_char, y_char = preprocess_char_samples(dataset)
    if X_char is not None and len(X_char) > 0:
        train_char_model(X_char, y_char)
    else:
        print("No character samples found. Skipping character model.")

    seq_data = preprocess_sequence_samples(dataset)
    if seq_data is not None and len(seq_data["X"]) > 0:
        train_sequence_model(seq_data)
    else:
        print("No sequenceSamples found. Skipping sequence model.")

    print("Training complete")


if __name__ == "__main__":
    main()
