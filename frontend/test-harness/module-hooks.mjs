// Module hooks used by the component tests: assets (css/svg/jpg) resolve to inert
// stubs, and a few browser-only modules are swapped for test doubles.
const assetKinds = [
  [/\.css$/, "css"],
  [/\.svg$/, "svg"],
  [/\.(jpg|jpeg|png|webp)$/, "image"],
];

const mocks = {
  "next/image": "next-image",
  "framer-motion": "framer-motion",
  "@/app/lib/supabase/browser": "supabase-browser",
  "@/app/lib/supabase/AuthProvider": "auth-provider",
};

export async function resolve(specifier, context, nextResolve) {
  const mock = mocks[specifier];
  if (mock) return { url: `stub:${mock}`, shortCircuit: true };
  for (const [pattern, kind] of assetKinds) {
    if (pattern.test(specifier)) return { url: `stub:${kind}:${specifier}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

const sources = {
  css: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });",
  svg: "import React from 'react'; const Icon = (props) => React.createElement('svg', { 'data-icon': 'true' }); export default Icon;",
  image: "export default { src: '/stub-image.jpg', height: 100, width: 100 };",
};

const mockSources = {
  "next-image": `import React from 'react';
export default function Image(props) {
  const { src, alt, fill, sizes, priority, quality, placeholder, blurDataURL, loader, unoptimized, ...rest } = props;
  const value = typeof src === 'object' && src !== null ? src.src : src;
  return React.createElement('img', { ...rest, src: value, alt: alt ?? '' });
}`,
  "framer-motion": `import React from 'react';
export const motion = new Proxy({}, {
  get: (_target, tag) => (props) => {
    const { initial, animate, exit, variants, transition, whileTap, whileHover, whileInView, layout, layoutId, ...rest } = props;
    return React.createElement(String(tag), rest);
  },
});
export function AnimatePresence({ children }) { return children ?? null; }
export function MotionConfig({ children }) { return children ?? null; }
export default { motion, AnimatePresence, MotionConfig };`,
  "supabase-browser": `export function createBrowserSupabaseClient() {
  return globalThis.__commentsTestClient ?? null;
}`,
  "auth-provider": `export function useUser() {
  return globalThis.__commentsTestAuth ?? { user: null, profile: null, isAnonymous: false, loading: false, signOut: async () => {} };
}`,
};

export async function load(url, context, nextLoad) {
  if (url.startsWith("stub:")) {
    const [, rest] = url.split("stub:");
    for (const [name, source] of Object.entries(mockSources)) {
      if (rest === name) return { format: "module", shortCircuit: true, source };
    }
    const kind = rest.split(":")[0];
    if (sources[kind]) return { format: "module", shortCircuit: true, source: sources[kind] };
  }
  return nextLoad(url, context);
}
