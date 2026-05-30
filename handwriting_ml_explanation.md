# Handwriting Recognition Machine Learning Explanation

## 1. Sequence-Based vs. Image-Based Machine Learning

Most handwriting recognition models (like MNIST-style classifiers) are **Image-Based (Offline)**. They take static pixel grids and
use CNNs to recognize shapes.

Our program uses **Sequence-Based (Online) Recognition**. Instead of rendering strokes to an image, it processes raw pen path
coordinates as a time-series sequence.

Each point is represented as:

`[x, y, pen_lift, delta_time, vx, vy]`

### The Features We Use:

1. **`x` coordinate**: Normalized horizontal position of the pen.
2. **`y` coordinate**: Normalized vertical position of the pen.
3. **`pen_lift`**: Binary marker (`0.0` or `1.0`) showing where a stroke ends.
4. **`delta_time`**: Time elapsed (seconds) since the previous point.
5. **`vx`**: Horizontal velocity.
6. **`vy`**: Vertical velocity.

---

## 2. Normalization & Preprocessing

Before training or inference, the stroke data is normalized so the models are robust to drawing size and speed.

### A. Spatial Normalization (Scale Invariance)

- Compute the stroke-group bounding box.
- Rescale and center into a virtual `256 x 256` area.
- Normalize coordinates into `[0.0, 1.0]`.

### B. Length Normalization (Fixed Input Sequences)

Models use fixed sequence lengths:

- Character model target length: **128** points
- Sequence model target length: **192** points

If a sample is shorter than target length, it is padded with zeros. If a sample is longer, it is uniformly downsampled.

---

## 3. Character Model (Print / Isolated Letters)

This is the current model used by `/predict`.

Training data source:

- Dataset field: `samples`

Architecture:

```text
[Input: 128 x 6] -> [LSTM(32, seq)] -> [LSTM(32)] -> [Dense(32, relu)] -> [Dropout(0.2)] -> [Softmax]
```

Outputs:

- `handwriting_model.keras`
- `class_names.json`

This model is excellent for print-style and isolated letter recognition.

---

## 4. Sequence Model for Connected Cursive Words

This is the current model used by `/predict-sequence`.

Training data source:

- Dataset field: `sequenceSamples`

Architecture:

```text
[Input: 192 x 6] -> [BiLSTM(64, seq)] -> [BiLSTM(64, seq)] -> [Dense(vocab + blank, softmax)] -> [CTC loss during training]
```

This model learns to decode full connected words without manually labeled per-letter boundaries.

Outputs:

- `handwriting_sequence_model.keras`
- `sequence_vocab.json`

Inference returns:

- `prediction`
- `confidence`
- `letterSpans` (approximate start/end timesteps per predicted letter)
- `usedTimesteps`

---

## 5. Are We Currently Using Time or Speed?

**Yes, absolutely.**

Both the character and sequence models consume the full temporal feature set (`delta_time`, `vx`, `vy`) in addition to coordinates
and `pen_lift`.

Why this helps:

1. **Writing Rhythm**: Loops and corners often have distinct velocity signatures.
2. **Directional Flow**: Velocity vectors encode local pen direction directly.
3. **Stability**: Temporal context improves separation of shape-similar letters and connected forms.

---

## 6. Why Whole-Word Labels Work for Cursive

For connected cursive, the sequence model uses CTC training, which learns alignment between stroke sequence and output text
internally.

You can label an entire connected word (for example `mag`) without manually marking where each letter starts.

The model then learns likely boundaries from repeated examples.

---

## 7. Practical Data Guidance

- Character recognition can work very well with a few hundred labeled letters.
- Sequence word recognition needs more data.
- A small `sequenceSamples` dataset can collapse to one-letter outputs.
- For stable connected-word predictions, aim for at least `100+` sequence samples, then keep scaling up.
- Repeating high-frequency words with style variation (speed, slant, spacing) improves robustness significantly.
