import sys
import os
import json
import numpy as np

# Prevent TensorFlow from logging debugging/warning info to stderr, keeping console clean
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"


def add_temporal_features(seq_points):
    if not seq_points:
        return []

    # Ensure every point has a time value (index * 20ms fallback if missing)
    sanitized_points = []
    for idx, pt in enumerate(seq_points):
        if len(pt) >= 4:
            sanitized_points.append(pt[:4])
        else:
            # Fallback for old clients sending 3 elements [x, y, pen_lift]
            x = pt[0]
            y = pt[1]
            pen_lift = pt[2]
            t = float(idx * 20.0)  # Synthesized time
            sanitized_points.append([x, y, pen_lift, t])

    featured_seq = []
    for i in range(len(sanitized_points)):
        x, y, pen_lift, t = sanitized_points[i]
        if i == 0:
            dt = 0.0
            vx = 0.0
            vy = 0.0
        else:
            prev_x, prev_y, _, prev_t = sanitized_points[i - 1]
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


def preprocess_sequence(points_list, target_len=128):
    # points_list is a list of [x, y, pen_lift, time] or [x, y, pen_lift]
    featured_points = add_temporal_features(points_list)

    seq_len = len(featured_points)
    if seq_len == 0:
        return np.zeros((target_len, 6), dtype=np.float32)

    if seq_len < target_len:
        # Pad with zeros
        padded = featured_points + [[0.0, 0.0, 0.0, 0.0, 0.0, 0.0]] * (target_len - seq_len)
        return np.array(padded, dtype=np.float32)
    else:
        # Downsample uniformly
        indices = np.linspace(0, seq_len - 1, target_len).astype(int)
        resampled = [featured_points[i] for i in indices]
        return np.array(resampled, dtype=np.float32)


def main():
    model_path = "handwriting_model.keras"
    classes_path = "class_names.json"

    if not os.path.exists(model_path) or not os.path.exists(classes_path):
        print("ERROR: Model files not found. Please run train.py first.", flush=True)
        sys.exit(1)

    try:
        # Import tensorflow inside main to show errors on startup rather than import
        import tensorflow as tf
        from tensorflow import keras

        # Load model and class names
        model = keras.models.load_model(model_path)
        with open(classes_path, "r") as f:
            class_names = json.load(f)
    except Exception as e:
        print(f"ERROR: Failed to load model: {e}", flush=True)
        sys.exit(1)

    # Signal to Node server that the Python script is ready
    print("READY", flush=True)

    # Listen to stdin for incoming prediction requests
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        # print(f"Received input: {line}", flush=True)  # Debug log for received input
        try:
            # Parse the coordinates from Node
            # Format: [[x, y, pen_lift, time], ...]
            raw_points = json.loads(line)

            # Preprocess and reshape
            X_single = preprocess_sequence(raw_points)
            X = np.expand_dims(X_single, axis=0)  # shape (1, 128, 6)

            # Perform inference
            preds = model.predict(X, verbose=0)
            pred_idx = np.argmax(preds[0])
            confidence = float(preds[0][pred_idx])
            predicted_char = class_names[pred_idx]

            # Output result back to Node
            response = {"prediction": predicted_char, "confidence": confidence}
            print(json.dumps(response), flush=True)

        except Exception as e:
            err_response = {"error": str(e)}
            print(json.dumps(err_response), flush=True)


if __name__ == "__main__":
    main()
