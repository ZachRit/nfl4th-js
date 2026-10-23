import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// A gradient-boosted tree ensemble read from xgboost's JSON model format, and
// predicted the way xgboost's CPU predictor does it: single precision
// throughout, so the outputs agree with R's `predict()` to the last float.

type Objective = 'binary:logistic' | 'multi:softprob';

interface JsonTree {
  left_children: number[];
  right_children: number[];
  split_indices: number[];
  split_conditions: number[];
  split_type: number[];
  default_left: number[];
}

interface JsonModel {
  learner: {
    learner_model_param: { base_score: string; num_class: string; num_feature: string };
    objective: { name: string };
    gradient_booster: {
      name: string;
      model: { trees: JsonTree[]; tree_info: number[] };
    };
  };
}

export interface Booster {
  /** One probability for binary:logistic, one per class for multi:softprob. */
  predict(features: ArrayLike<number>): Float64Array;
}

const f32 = Math.fround;

export function loadBooster(path: URL): Booster {
  const model = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as JsonModel;
  const { learner_model_param: param, objective, gradient_booster: booster } = model.learner;
  if (booster.name !== 'gbtree')
    throw new Error(`${path.href}: unsupported booster ${booster.name}`);
  if (objective.name !== 'binary:logistic' && objective.name !== 'multi:softprob') {
    throw new Error(`${path.href}: unsupported objective ${objective.name}`);
  }
  const obj: Objective = objective.name;
  const numClass = obj === 'multi:softprob' ? Number(param.num_class) : 1;
  const numFeature = Number(param.num_feature);

  // base_score is stored after the inverse link, as "[5E-1]" or one value per
  // class, and the margin starts from its link: the logit for binary:logistic
  // and the value itself for multi:softprob, whose link is the identity.
  const baseScores = JSON.parse(param.base_score) as number[] | number;
  const intercepts = Array.isArray(baseScores) ? baseScores : [baseScores];
  if (intercepts.some((b) => b !== intercepts[0])) {
    throw new Error(`${path.href}: per-class intercepts are unsupported`);
  }
  const p = f32(intercepts[0]!);
  const baseMargin = obj === 'binary:logistic' ? f32(-Math.log(f32(f32(1 / p) - 1))) : p;

  // Flatten every tree into shared typed arrays, nodes addressed by
  // treeOffset[t] + node id.
  const trees = booster.model.trees;
  const treeOffset = new Int32Array(trees.length);
  const totalNodes = trees.reduce((n, t) => n + t.left_children.length, 0);
  const left = new Int32Array(totalNodes);
  const right = new Int32Array(totalNodes);
  const splitIndex = new Int32Array(totalNodes);
  const splitCondition = new Float32Array(totalNodes);
  const defaultLeft = new Uint8Array(totalNodes);
  let offset = 0;
  trees.forEach((tree, t) => {
    treeOffset[t] = offset;
    for (let i = 0; i < tree.left_children.length; i++) {
      if (tree.split_type[i] !== 0)
        throw new Error(`${path.href}: categorical splits are unsupported`);
      left[offset + i] = tree.left_children[i]!;
      right[offset + i] = tree.right_children[i]!;
      splitIndex[offset + i] = tree.split_indices[i]!;
      // On a leaf, split_conditions holds the leaf's value.
      splitCondition[offset + i] = tree.split_conditions[i]!;
      defaultLeft[offset + i] = tree.default_left[i]!;
    }
    offset += tree.left_children.length;
  });
  const treeClass = Int32Array.from(booster.model.tree_info);

  const x = new Float32Array(numFeature);
  return {
    predict(features) {
      if (features.length !== numFeature) {
        throw new Error(`${path.href}: expected ${numFeature} features, got ${features.length}`);
      }
      // Features are compared as float32; NaN marks a missing value.
      for (let i = 0; i < numFeature; i++) x[i] = features[i]!;

      const margin = new Float32Array(numClass).fill(baseMargin);
      for (let t = 0; t < treeOffset.length; t++) {
        const base = treeOffset[t]!;
        let node = 0;
        while (left[base + node] !== -1) {
          const value = x[splitIndex[base + node]!]!;
          const goLeft = Number.isNaN(value)
            ? defaultLeft[base + node] === 1
            : value < splitCondition[base + node]!;
          node = goLeft ? left[base + node]! : right[base + node]!;
        }
        const c = treeClass[t]!;
        margin[c] = margin[c]! + splitCondition[base + node]!;
      }

      const out = new Float64Array(numClass);
      if (obj === 'binary:logistic') {
        // xgboost's Sigmoid clamps the exponent to keep expf finite.
        const e = f32(Math.exp(Math.min(-margin[0]!, f32(88.7))));
        out[0] = f32(1 / f32(f32(e + 1) + f32(1e-16)));
        return out;
      }
      let max = margin[0]!;
      for (let c = 1; c < numClass; c++) max = Math.max(max, margin[c]!);
      // xgboost's Softmax sums the exponentials in double, then divides in float.
      let sum = 0;
      for (let c = 0; c < numClass; c++) {
        out[c] = f32(Math.exp(f32(margin[c]! - max)));
        sum += out[c]!;
      }
      const denom = f32(sum);
      for (let c = 0; c < numClass; c++) out[c] = f32(out[c]! / denom);
      return out;
    },
  };
}
