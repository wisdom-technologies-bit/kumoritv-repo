"use client";
import { AnimatePresence } from "framer-motion";
import UserModal from ".";
export default function ShowUpLoginPanelAnimated({ apperanceCondition, customOnClickAction, nextPath }: { apperanceCondition: boolean; customOnClickAction?: () => void; nextPath?: string; auth?: unknown }) {
  return <AnimatePresence initial={false} mode="wait">{apperanceCondition && <UserModal onClick={customOnClickAction} nextPath={nextPath} />}</AnimatePresence>;
}
