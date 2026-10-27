// Test double for framer-motion: animation props are dropped, elements stay.
import React from "react";

const passthrough = (tag: string) =>
  function MotionElement(props: Record<string, unknown>) {
    const {
      initial, animate, exit, variants, transition, whileTap, whileHover, whileInView,
      layout, layoutId, ...rest
    } = props;
    return React.createElement(tag, rest);
  };

export const motion = new Proxy(
  {},
  { get: (_target, tag) => passthrough(String(tag)) },
) as Record<string, (props: Record<string, unknown>) => React.ReactElement>;

export function AnimatePresence({ children }: { children?: React.ReactNode }) {
  return <>{children ?? null}</>;
}

export function MotionConfig({ children }: { children?: React.ReactNode }) {
  return <>{children ?? null}</>;
}

export default { motion, AnimatePresence, MotionConfig };
