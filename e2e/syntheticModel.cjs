/*
 * Tiny ONNX models made by hand, so the on-device tools can be tested in a real browser without downloading anything.
 *
 *   syntheticModel():    one node, ReduceMean over the three colour channels. Fed a picture it returns the picture's
 *                        brightness as a one-channel "mask", which is enough to follow every step (pixels in, tensors,
 *                        GPU, mask out) with exact numbers.
 *   syntheticUpscaler(): one node, Resize with nearest-neighbour. Fed a picture of any size it returns a picture `scale`
 *                        times larger in which every pixel became a block of pixels, so the result of the whole
 *                        pipeline (tiles, context, stitching, canvas) can be compared pixel for pixel with the original.
 *
 * ONNX files are protocol buffers; only the few fields these graphs need are written (field numbers from onnx.proto).
 */
const crypto = require("node:crypto");

const varint = (value) => {
  const bytes = [];
  let n = value;
  while (n > 0x7f) {
    bytes.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
  return Buffer.from(bytes);
};
const tag = (field, wireType) => varint(field * 8 + wireType);
const bytesField = (field, buffer) => Buffer.concat([tag(field, 2), varint(buffer.length), buffer]);
const stringField = (field, text) => bytesField(field, Buffer.from(text, "utf8"));
const intField = (field, value) => Buffer.concat([tag(field, 0), varint(value)]);

/** ValueInfoProto: a named float tensor. A number in the shape is a fixed size, a string the name of a size that may vary. */
function valueInfo(name, shape) {
  // TensorShapeProto.dim { dim_value } or { dim_param }
  const dims = Buffer.concat(shape.map((d) => bytesField(1, typeof d === "string" ? stringField(2, d) : intField(1, d))));
  const tensorType = Buffer.concat([intField(1, 1 /* FLOAT */), bytesField(2, dims)]); // TypeProto.Tensor { elem_type, shape }
  return Buffer.concat([stringField(1, name), bytesField(2, bytesField(1, tensorType))]); // { name, type { tensor_type } }
}

const attributeInts = (name, ints) => Buffer.concat([stringField(1, name), ...ints.map((i) => intField(8, i)), intField(20, 7 /* INTS */)]);
const attributeInt = (name, value) => Buffer.concat([stringField(1, name), intField(3, value), intField(20, 2 /* INT */)]);
const attributeString = (name, text) => Buffer.concat([stringField(1, name), bytesField(4, Buffer.from(text, "utf8")), intField(20, 3 /* STRING */)]);

/** TensorProto: a named constant of floats (field numbers: dims 1, data_type 2, float_data 4, name 8). */
function floatConstant(name, values) {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => data.writeFloatLE(v, i * 4));
  return Buffer.concat([intField(1, values.length), intField(2, 1 /* FLOAT */), bytesField(4, data), stringField(8, name)]);
}

/** The model file and the facts the app's model registry would hold about it. */
function syntheticModel(size = 64) {
  const node = Buffer.concat([
    stringField(1, "input_image"),
    stringField(2, "output_image"),
    stringField(3, "channel_mean"),
    stringField(4, "ReduceMean"),
    bytesField(5, attributeInts("axes", [1])),
    bytesField(5, attributeInt("keepdims", 1)),
  ]);
  const graph = Buffer.concat([
    bytesField(1, node),
    stringField(2, "craftly_e2e"),
    bytesField(11, valueInfo("input_image", [1, 3, size, size])),
    bytesField(12, valueInfo("output_image", [1, 1, size, size])),
  ]);
  const opset = Buffer.concat([stringField(1, ""), intField(2, 13)]);
  const bytes = Buffer.concat([intField(1, 8 /* IR version */), stringField(2, "craftly-e2e"), bytesField(7, graph), bytesField(8, opset)]);
  return {
    bytes,
    base64: bytes.toString("base64"),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    size,
    io: { kind: "image-to-mask", input: "input_image", output: "output_image", size, mean: [0, 0, 0], std: [1, 1, 1], activation: "none" },
  };
}

/** A model that makes every pixel `scale` x `scale` pixels of the same colour. Any picture size goes in. */
function syntheticUpscaler(scale = 4) {
  const node = Buffer.concat([
    stringField(1, "input"),
    stringField(1, ""), // roi: not given
    stringField(1, "scales"),
    stringField(2, "output"),
    stringField(3, "stretch"),
    stringField(4, "Resize"),
    // each output pixel looks at the input pixel it lies in: exact blocks, no blending
    bytesField(5, attributeString("mode", "nearest")),
    bytesField(5, attributeString("coordinate_transformation_mode", "asymmetric")),
    bytesField(5, attributeString("nearest_mode", "floor")),
  ]);
  const graph = Buffer.concat([
    bytesField(1, node),
    stringField(2, "craftly_e2e_upscaler"),
    bytesField(5, floatConstant("scales", [1, 1, scale, scale])),
    bytesField(11, valueInfo("input", [1, 3, "height", "width"])),
    bytesField(12, valueInfo("output", [1, 3, "height_scaled", "width_scaled"])),
  ]);
  const opset = Buffer.concat([stringField(1, ""), intField(2, 13)]);
  const bytes = Buffer.concat([intField(1, 8 /* IR version */), stringField(2, "craftly-e2e"), bytesField(7, graph), bytesField(8, opset)]);
  return {
    bytes,
    base64: bytes.toString("base64"),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    scale,
    io: { kind: "image-to-image", input: "input", output: "output", scale, tile: 48, halo: 4 },
  };
}

module.exports = { syntheticModel, syntheticUpscaler };
