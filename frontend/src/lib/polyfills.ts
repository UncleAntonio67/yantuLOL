// Minimal polyfills for older WebViews (notably some WeChat builds).
// pdfjs-dist v5 uses `Map.prototype.getOrInsertComputed` / `WeakMap.prototype.getOrInsertComputed`,
// which are not yet broadly available on mobile browsers.

type GetOrInsertComputed<K, V> = (key: K, callbackfn: (key: K) => V) => V;

function polyfillMapGetOrInsertComputed() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mp: any = Map.prototype as any;
  if (typeof mp.getOrInsertComputed === "function") return;
  mp.getOrInsertComputed = function getOrInsertComputed<K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V) {
    if (this.has(key)) return this.get(key) as V;
    const v = callbackfn(key);
    this.set(key, v);
    return v;
  } satisfies GetOrInsertComputed<unknown, unknown>;
}

function polyfillWeakMapGetOrInsertComputed() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wmp: any = WeakMap.prototype as any;
  if (typeof wmp.getOrInsertComputed === "function") return;
  wmp.getOrInsertComputed = function getOrInsertComputed<K extends object, V>(
    this: WeakMap<K, V>,
    key: K,
    callbackfn: (key: K) => V
  ) {
    if (this.has(key)) return this.get(key) as V;
    const v = callbackfn(key);
    this.set(key, v);
    return v;
  } satisfies GetOrInsertComputed<object, unknown>;
}

export function installPolyfills() {
  try {
    polyfillMapGetOrInsertComputed();
  } catch {
    // ignore
  }
  try {
    polyfillWeakMapGetOrInsertComputed();
  } catch {
    // ignore
  }
}

installPolyfills();

