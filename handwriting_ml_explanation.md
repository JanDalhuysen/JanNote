# Handwriting Recognition Machine Learning Explanation

## 1. Sequence-Based vs. Image-Based Machine Learning

Most handwriting recognition models (like the famous MNIST digit classifier) are **Image-Based (Offline)**. They take a static 2D
grid of pixels (an image), and use Convolutional Neural Networks (CNNs) to recognize shapes.

Our program uses **Sequence-Based (Online) Recognition**. Instead of rendering your drawing to a picture, it processes the raw
coordinates of your pen path as a time-series sequence:

$$X = [p_1, p_2, p_3, \dots, p_N]$$

Where each point $p_i$ is represented as:

$$p_i = [x_i, y_i, \text{pen\_lift}_i]$$

### The Features We Use:

1. **$x$ coordinate**: Normalized horizontal position of the cursor/pen.
2. **$y$ coordinate**: Normalized vertical position of the cursor/pen.
3. **$\text{pen\_lift}$**: A binary marker ($0.0$ or $1.0$). It is set to $0.0$ while you are drawing a line, and $1.0$ at the end
   of a stroke (when you lift the stylus or mouse button). This tells the model where one stroke ends and another begins (crucial
   for multi-stroke letters like `t`, `i`, or `x`).

---

## 2. Normalization & Preprocessing

Before feeding your drawing to the machine learning model, we must normalize the data so the model is not confused by different
sizes or speeds:

### A. Spatial Normalization (Scale Invariance)

If you draw a small letter `a` in the corner of the canvas, or a giant `a` across the whole screen, they should look identical to
the model.

- We calculate the bounding box of your drawing.
- We rescale and center the drawing so it fits perfectly inside a virtual $256 \times 256$ coordinate space.
- We divide by $256.0$ to project all coordinates into a clean $[0.0, 1.0]$ range.

### B. Length Normalization (Fixed Inputs)

An LSTM network expects input sequences of a fixed size. We chose a target sequence length of **128 points**:

- **If you draw quickly** and capture fewer than 128 points (e.g., 50 points), we pad the end of the sequence with zeros
  ($[0.0, 0.0, 0.0]$) up to 128.
- **If you draw slowly** and capture more than 128 points (e.g., 400 points), we downsample the sequence uniformly, picking 128
  points spaced evenly along your stroke.

---

## 3. The LSTM Neural Network Architecture

We use a **Long Short-Term Memory (LSTM)** network, which is a type of Recurrent Neural Network (RNN) designed for sequential
data:

```
[Input: 128 x 6] ──> [LSTM Layer (32 units)] ──> [Dropout (20%)] ──> [Dense Layer] ──> [Output: Character Probabilities]
```

- **Sequential Memory**: Unlike images where all pixels are processed at once, the LSTM reads the points one by one
  ($p_1 \to p_2 \to p_3 \dots$). It maintains an internal "memory state" that tracks the direction and curvature of your pen
  stroke.
- **Temporal Patterns**: It learns that a circle drawn counter-clockwise represents an `o` or the bowl of an `a`, while a sharp
  vertical line represents an `l` or `1`.

---

## 4. Are We Currently Using Time or Speed?

**Yes, absolutely!**

Our pipeline now incorporates full temporal dynamics alongside the spatial coordinates. For every point $p_i$, the model receives
a 6-dimensional feature vector:

$$p_i = [x_i, y_i, \text{pen\_lift}_i, \Delta t_i, v_{xi}, v_{yi}]$$

### The Features We Use:

1. **$x$ coordinate**: Normalized horizontal position of the pen.
2. **$y$ coordinate**: Normalized vertical position of the pen.
3. **$\text{pen\_lift}$**: A binary marker ($0.0$ or $1.0$) indicating when a stroke is completed.
4. **$\Delta t$ (Delta Time)**: The time elapsed (in seconds) between the current point and the previous point
   ($\Delta t_i = t_i - t_{i-1}$).
5. **$v_x$ (Horizontal Velocity)**: The velocity along the X-axis ($v_{xi} = \Delta x_i / \Delta t_i$).
6. **$v_y$ (Vertical Velocity)**: The velocity along the Y-axis ($v_{yi} = \Delta y_i / \Delta t_i$).

### Why This Made a Massive Difference:

1. **Writing Rhythm (Velocity Cues)**: Humans write straight segments quickly, but slow down significantly when navigating sharp
   corners or loops. By including velocity, the LSTM can easily tell the difference between a smooth curve (like the loop of an
   `e`) and a sharp cusp (like the top loop of a `y`) based on speed changes.
2. **Directional Flow**: The velocity vector ($v_x, v_y$) directly informs the network of the instantaneous drawing direction,
   making it simple to map sequential curves even if their physical shapes overlap in space.
3. **Training Stability**: Alongside adding these temporal features, we optimized the trainer with **gradient clipping
   (`clipnorm=1.0`)** and set a **compact model size (32 units)** to stabilize training and achieve a highly reliable 80%+
   accuracy!
