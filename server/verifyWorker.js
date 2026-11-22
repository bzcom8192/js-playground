// Semicolon Acres Online — one replay verification, inside a worker_thread (see
// verifier.js). workerData = the job; posts { ok: true, result } or
// { ok: false, error } once, then the parent terminates the thread.
//
// The program being replayed is hostile until proven otherwise. The farmer
// API it gets is closed (runtime.js passes only game functions), and this file
// closes what a worker would otherwise leave reachable from plain JS:
//  - module loading: after the engine is loaded, every import() (also from
//    Function("…") code) fails — a resolve hook rejects all specifiers;
//  - Node globals: process (and with it getBuiltinModule / binding / env),
//    fetch, WebSocket, BroadcastChannel, EventSource, Atomics,
//    SharedArrayBuffer and WebAssembly are deleted; console is a no-op;
//  - the intrinsics the engine itself uses (Object, Array, Math, JSON,
//    Promise, iterators, …) are frozen and their global names made read-only,
//    so a program can't monkey-patch the code that measures it.
// CPU and memory are bounded by the parent (timeout + resourceLimits).
import { parentPort, workerData } from "node:worker_threads";
import { registerHooks } from "node:module";
import { runVerification } from "../src/farmer/verify.js";

let locked = false;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (locked) throw new Error("import() is not available to farmer programs");
    return nextResolve(specifier, context);
  },
});

// Replace a data property on a frozen prototype by an accessor whose setter
// defines an own property on the instance, so ordinary code like
// `err.name = "X"` or `obj.toString = f` keeps working (the "override
// mistake" of frozen prototypes) while the prototype itself stays untouched.
function tame(proto, key) {
  const d = Object.getOwnPropertyDescriptor(proto, key);
  if (!d || !("value" in d) || !d.configurable) return;
  const value = d.value;
  Object.defineProperty(proto, key, {
    get() {
      return value;
    },
    set(v) {
      if (this === proto) throw new TypeError(`Cannot assign to read only property '${String(key)}'`);
      Object.defineProperty(this, key, { value: v, writable: true, enumerable: true, configurable: true });
    },
    enumerable: d.enumerable,
    configurable: false,
  });
}

export function lockdown(g = globalThis) {
  for (const name of ["process", "fetch", "WebSocket", "EventSource", "BroadcastChannel", "Atomics", "SharedArrayBuffer", "WebAssembly"]) {
    try {
      delete g[name];
    } catch {
      // not configurable: shadow it
    }
    if (name in g) Object.defineProperty(g, name, { value: undefined, writable: false, configurable: false });
  }
  const noop = () => {};
  const quiet = Object.freeze(Object.fromEntries(["log", "info", "warn", "error", "debug", "trace", "dir", "table", "time", "timeEnd", "group", "groupEnd", "clear", "assert", "count"].map((k) => [k, noop])));
  Object.defineProperty(g, "console", { value: quiet, writable: false, configurable: false });

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;
  const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;
  const TypedArray = Object.getPrototypeOf(Int8Array);
  const arrayIter = Object.getPrototypeOf([][Symbol.iterator]());
  const globals = [
    "Object", "Function", "Array", "Number", "String", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Reflect", "Proxy",
    "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "Date", "RegExp",
    "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError",
    "ArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Iterator",
    "globalThis", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
    "MessageChannel", "MessagePort", "structuredClone", "performance",
  ];
  const roots = [
    ...globals.filter((n) => n !== "globalThis").map((n) => g[n]),
    AsyncFunction, GeneratorFunction, AsyncGeneratorFunction, TypedArray,
    arrayIter, Object.getPrototypeOf(arrayIter),
    Object.getPrototypeOf(new Map().entries()), Object.getPrototypeOf(new Set().values()),
    Object.getPrototypeOf(""[Symbol.iterator]()), Object.getPrototypeOf(/a/[Symbol.matchAll]("")),
    Object.getPrototypeOf(GeneratorFunction.prototype.prototype), // %IteratorPrototype% via generators
    Object.getPrototypeOf(AsyncGeneratorFunction.prototype.prototype), // %AsyncIteratorPrototype%
  ].filter((x) => x !== undefined && x !== null && (typeof x === "object" || typeof x === "function"));
  const seen = new Set();
  const harden = (x) => {
    if (x === null || (typeof x !== "object" && typeof x !== "function") || seen.has(x)) return;
    seen.add(x);
    if (typeof x === "function" && x.prototype && typeof x.prototype === "object") harden(x.prototype);
    for (const k of Reflect.ownKeys(x)) {
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (d && "value" in d && d.value && typeof d.value === "object" && !ArrayBuffer.isView(d.value)) harden(d.value);
    }
    if (x !== g) {
      for (const k of ["constructor", "toString", "valueOf", "name", "message", "toJSON"]) tame(x, k);
      Object.freeze(x);
    }
  };
  for (const r of roots) harden(r);
  for (const n of globals) {
    const d = Object.getOwnPropertyDescriptor(g, n);
    if (d && d.configurable) Object.defineProperty(g, n, { value: g[n], writable: false, enumerable: d.enumerable, configurable: false });
  }
}

const post = parentPort.postMessage.bind(parentPort);
// An un-awaited rejected promise in a program is not fatal on the page (the
// browser only logs it), so it must not crash the replay either.
process.on("unhandledRejection", () => {});
lockdown();
locked = true;
runVerification(workerData).then(
  (result) => post({ ok: true, result: JSON.parse(JSON.stringify(result)) }),
  (err) => post({ ok: false, error: String(err?.message || err) }),
);
