import sys
import os
import json
import numpy as np

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

CHAR_TARGET_LEN = 128
SEQ_TARGET_LEN = 192


def add_temporal_features(seq_points):
    if not seq_points:
        return []

    sanitized = []
    for idx, pt in enumerate(seq_points):
        if len(pt) >= 4:
            sanitized.append(pt[:4])
        else:
            x, y, pen_lift = pt[:3]
            sanitized.append([x, y, pen_lift, float(idx * 20.0)])

    featured = []
    for i in range(len(sanitized)):
        x, y, pen_lift, t = sanitized[i]
        if i == 0:
            dt = 0.0
            vx = 0.0
            vy = 0.0
        else:
            prev_x, prev_y, _, prev_t = sanitized[i - 1]
            dt = (t - prev_t) / 1000.0
            if dt > 0.001:
                vx = (x - prev_x) / dt
                vy = (y - prev_y) / dt
            else:
                dt = 0.0
                vx = 0.0
                vy = 0.0
        featured.append([x, y, pen_lift, dt, vx, vy])
    return featured


def preprocess_sequence(points_list, target_len):
    featured = add_temporal_features(points_list)
    seq_len = len(featured)
    if seq_len == 0:
        return np.zeros((target_len, 6), dtype=np.float32), 1

    if seq_len < target_len:
        padded = featured + [[0.0] * 6] * (target_len - seq_len)
        return np.asarray(padded, dtype=np.float32), seq_len

    indices = np.linspace(0, seq_len - 1, target_len).astype(int)
    resampled = [featured[i] for i in indices]
    return np.asarray(resampled, dtype=np.float32), target_len


def decode_ctc_with_spans(prob_matrix, idx_to_char):
    # prob_matrix shape: (T, V+1), blank index is V
    token_ids = np.argmax(prob_matrix, axis=-1)
    blank_idx = len(idx_to_char)

    decoded_chars = []
    spans = []
    prev = blank_idx
    run_start = 0

    for t, token in enumerate(token_ids):
        if token == prev:
            continue
        if prev != blank_idx and prev in idx_to_char:
            spans.append(
                {
                    "char": idx_to_char[prev],
                    "startStep": int(run_start),
                    "endStep": int(t - 1),
                }
            )
            decoded_chars.append(idx_to_char[prev])
        run_start = t
        prev = token

    if prev != blank_idx and prev in idx_to_char:
        spans.append(
            {
                "char": idx_to_char[prev],
                "startStep": int(run_start),
                "endStep": int(len(token_ids) - 1),
            }
        )
        decoded_chars.append(idx_to_char[prev])

    text = "".join(decoded_chars)
    conf = float(np.mean([np.max(prob_matrix[s["startStep"] : s["endStep"] + 1], axis=-1).mean() for s in spans])) if spans else 0.0
    return text, conf, spans


def split_points_into_segments(seq_points):
    segments = []
    current = []
    for pt in seq_points:
        current.append(pt)
        pen_lift = float(pt[2]) if len(pt) >= 3 else 0.0
        if pen_lift >= 0.9:
            segments.append(current)
            current = []
    if current:
        segments.append(current)
    return segments


def predict_char_segments(char_model, class_names, seq_points):
    if char_model is None or not class_names:
        return "", 0.0, 0

    segments = split_points_into_segments(seq_points)
    if not segments:
        return "", 0.0, 0

    chars = []
    confidences = []
    for segment in segments:
        x_single, _ = preprocess_sequence(segment, CHAR_TARGET_LEN)
        X = np.expand_dims(x_single, axis=0)
        preds = char_model.predict(X, verbose=0)
        pred_idx = int(np.argmax(preds[0]))
        confidence = float(preds[0][pred_idx])
        chars.append(class_names[pred_idx])
        confidences.append(confidence)

    text = "".join(chars)
    avg_conf = float(np.mean(confidences)) if confidences else 0.0
    return text, avg_conf, len(segments)


def main():
    char_model_path = "handwriting_model.keras"
    class_names_path = "class_names.json"
    seq_model_path = "handwriting_sequence_model.keras"
    seq_vocab_path = "sequence_vocab.json"

    try:
        import tensorflow as tf
        from tensorflow import keras
    except Exception as e:
        print(f"ERROR: TensorFlow import failed: {e}", flush=True)
        sys.exit(1)

    char_model = None
    class_names = []
    seq_model = None
    seq_vocab = None

    try:
        if os.path.exists(char_model_path) and os.path.exists(class_names_path):
            char_model = keras.models.load_model(char_model_path)
            with open(class_names_path, "r", encoding="utf-8") as f:
                class_names = json.load(f)
    except Exception as e:
        print(f"ERROR: Failed to load character model: {e}", flush=True)

    try:
        if os.path.exists(seq_model_path) and os.path.exists(seq_vocab_path):
            seq_model = keras.models.load_model(seq_model_path)
            with open(seq_vocab_path, "r", encoding="utf-8") as f:
                seq_vocab = json.load(f)
    except Exception as e:
        print(f"ERROR: Failed to load sequence model: {e}", flush=True)

    if char_model is None and seq_model is None:
        print("ERROR: No model files found. Run train.py first.", flush=True)
        sys.exit(1)

    print("READY", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            if isinstance(payload, list):
                mode = "char"
                raw_points = payload
            else:
                mode = payload.get("mode", "char")
                raw_points = payload.get("points", [])

            if mode == "sequence":
                if seq_model is None or not seq_vocab:
                    print(
                        json.dumps({"error": "Sequence model not trained yet. Run train.py with sequenceSamples."}),
                        flush=True,
                    )
                    continue

                x_single, used_len = preprocess_sequence(raw_points, SEQ_TARGET_LEN)
                X = np.expand_dims(x_single, axis=0)
                probs = seq_model.predict(X, verbose=0)[0]

                chars = seq_vocab.get("chars", [])
                idx_to_char = {i: ch for i, ch in enumerate(chars)}
                text, confidence, spans = decode_ctc_with_spans(probs, idx_to_char)
                resp = {
                    "prediction": text or "?",
                    "confidence": confidence,
                    "mode": "sequence",
                    "letterSpans": spans,
                    "usedTimesteps": int(used_len),
                }
                print(json.dumps(resp, ensure_ascii=False), flush=True)
                continue

            if mode == "hybrid":
                sequence_text = ""
                sequence_conf = 0.0
                spans = []
                used_len = 0

                if seq_model is not None and seq_vocab:
                    x_single, used_len = preprocess_sequence(raw_points, SEQ_TARGET_LEN)
                    X = np.expand_dims(x_single, axis=0)
                    probs = seq_model.predict(X, verbose=0)[0]
                    chars = seq_vocab.get("chars", [])
                    idx_to_char = {i: ch for i, ch in enumerate(chars)}
                    sequence_text, sequence_conf, spans = decode_ctc_with_spans(probs, idx_to_char)

                char_text = ""
                char_conf = 0.0
                segment_count = 0
                if char_model is not None and class_names:
                    char_text, char_conf, segment_count = predict_char_segments(char_model, class_names, raw_points)

                if not sequence_text and not char_text:
                    print(
                        json.dumps({"error": "No prediction available."}),
                        flush=True,
                    )
                    continue

                decision = "sequence"
                chosen_text = sequence_text or char_text
                chosen_conf = sequence_conf if sequence_text else char_conf
                char_used = True
                char_reason = ""

                if sequence_text and char_text:
                    if sequence_conf >= char_conf * 0.9:
                        decision = "sequence"
                        chosen_text = sequence_text
                        chosen_conf = sequence_conf
                        char_used = False
                        char_reason = "sequence-preferred"
                    else:
                        decision = "char"
                        chosen_text = char_text
                        chosen_conf = char_conf
                        char_used = True
                elif sequence_text:
                    decision = "sequence"
                    chosen_text = sequence_text
                    chosen_conf = sequence_conf
                    char_used = False
                    char_reason = "char-unavailable"
                else:
                    decision = "char"
                    chosen_text = char_text
                    chosen_conf = char_conf
                    char_used = True

                resp = {
                    "prediction": chosen_text or "?",
                    "confidence": chosen_conf,
                    "mode": "hybrid",
                    "sequencePrediction": sequence_text or "?",
                    "sequenceConfidence": sequence_conf,
                    "charPrediction": char_text or "?",
                    "charConfidence": char_conf,
                    "charUsed": char_used,
                    "charIgnoredReason": char_reason,
                    "decision": decision,
                    "letterSpans": spans,
                    "usedTimesteps": int(used_len),
                    "segmentCount": int(segment_count),
                    "expectedCharCount": int(len(char_text)) if char_text else 0,
                }
                print(json.dumps(resp, ensure_ascii=False), flush=True)
                continue

            if char_model is None or not class_names:
                print(
                    json.dumps({"error": "Character model not trained yet. Run train.py first."}),
                    flush=True,
                )
                continue

            x_single, _ = preprocess_sequence(raw_points, CHAR_TARGET_LEN)
            X = np.expand_dims(x_single, axis=0)
            preds = char_model.predict(X, verbose=0)
            pred_idx = int(np.argmax(preds[0]))
            confidence = float(preds[0][pred_idx])
            predicted_char = class_names[pred_idx]
            print(
                json.dumps(
                    {
                        "prediction": predicted_char,
                        "confidence": confidence,
                        "mode": "char",
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
