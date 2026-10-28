"use strict";
const { makeBasic, PRESETS } = require("./basic"), { makeHttp } = require("./http"), { makeReplicate } = require("./replicate");

// VC_ENGINE = basic (default, free, no GPU) | http (your own converter server) | replicate (cloud GPU API)
function makeEngine(env = process.env, fetchFn = fetch) {
  const which = (env.VC_ENGINE || "basic").toLowerCase();
  if (which === "http") return makeHttp({ url: env.CONVERTER_URL, key: env.CONVERTER_KEY, fetchFn, steps: +env.CONVERTER_STEPS || 25 });
  if (which === "replicate") return makeReplicate({ token: env.REPLICATE_API_TOKEN, version: env.REPLICATE_MODEL_VERSION, fieldSource: env.REPLICATE_FIELD_SOURCE || undefined, fieldTarget: env.REPLICATE_FIELD_TARGET || undefined, fetchFn });
  return makeBasic();
}
module.exports = { makeEngine, PRESETS, makeBasic };
