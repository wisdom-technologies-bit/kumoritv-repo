// Test double for framer-motion: animation props are dropped, elements stay.
import React from "react";

// `motion.x` accepts a ref in the real library, so the double must forward it:
// components here put refs on motion elements (dialogs, panels).
const passthrough = (tag: string) =>
  React.forwardRef<HTMLElement, Record<string, unknown>>(function MotionElement(props, ref) {
    const {
      initial, animate, exit, variants, transition, whileTap, whileHover, whileInView,
      layout, layoutId, ...rest
    } = props;
    return React.createElement(tag, { ...rest, ref });
  });

// One component per tag: returning a fresh function on every property access
// would change the element type on each render and remount the whole subtree,
// which no real framer-motion build ever does.
const motionComponents = new Map<string, React.ComponentType<Record<string, unknown>>>();

export const motion = new Proxy(
  {},
  {
    get: (_target, tag) => {
      const name = String(tag);

      if (!motionComponents.has(name)) motionComponents.set(name, passthrough(name));

      return motionComponents.get(name);
    },
  },
) as Record<string, (props: Record<string, unknown>) => React.ReactElement>;

export function AnimatePresence({ children }: { children?: React.ReactNode }) {
  return <>{children ?? null}</>;
}

export function MotionConfig({ children }: { children?: React.ReactNode }) {
  return <>{children ?? null}</>;
}

export default { motion, AnimatePresence, MotionConfig };
