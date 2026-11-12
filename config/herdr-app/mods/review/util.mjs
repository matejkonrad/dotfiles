// Small helpers with no UI or herdr dependencies.

/** Copies the methods of each class onto `target`'s prototype: one class split over files by topic. */
export function mixin(target, ...sources) {
  for (const source of sources) {
    for (const name of Object.getOwnPropertyNames(source.prototype)) {
      if (name !== "constructor") Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(source.prototype, name));
    }
  }
  return target;
}

// The runtime has no structuredClone; what is cloned is plain JSON.
export const clone = (value) => JSON.parse(JSON.stringify(value));
