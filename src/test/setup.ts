import "@testing-library/jest-dom";

// Node-environment suites (crypto/security) have no window; browser shims only apply under jsdom.
if (typeof window !== "undefined") {

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
}
