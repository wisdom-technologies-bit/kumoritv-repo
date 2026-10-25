"use client";

import { AnimatePresence, motion } from "framer-motion";
import React, { MouseEventHandler, useState } from "react";
import styles from "./component.module.css";
import GoogleSvg from "@/public/assets/google-fill.svg";
import AnonymousSvg from "@/public/assets/person-fill.svg";
import CloseSvg from "@/public/assets/x.svg";
import LoadingSvg from "@/public/assets/Eclipse-1s-200px.svg";
import ProfileFallbackImg from "@/public/profile_fallback.jpg";
import UserSettingsModal from "@/app/layout/header/components/User/UserSettingsModal";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { sanitizeNextPath } from "@/app/lib/supabase/auth";
import userSettingsActions from "@/app/api/cookie/userCookieSettingsActions";

type ModalTypes = { onClick?: MouseEventHandler<HTMLDivElement>; auth?: unknown; nextPath?: string };
const framerMotionDropIn = { hidden: { x: "-100vw", opacity: 0 }, visible: { x: "0", opacity: 1, transition: { duration: 0.2, damping: 25, type: "spring", stiffness: 500 } }, exit: { x: "100vw", opacity: 0 } };

function friendlyAuthError(error: { code?: string; message?: string }) {
  if (error.code?.includes("invalid") || error.code?.includes("credential") || error.code?.includes("user-not-found")) return "Check Your Email and Password, then try again.";
  return error.message || "Unable to sign in. Please try again.";
}

export default function UserModal({ onClick, nextPath }: ModalTypes) {
  const client = createBrowserSupabaseClient();
  const { user, profile } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [formType, setFormType] = useState<"login" | "signup">("login");
  const [loginError, setLoginError] = useState<{ code: string; message: string } | null>(null);
  const finishAuth = async () => {
    if (!client || !user) return;
    await Promise.all([
      userSettingsActions.setMediaTitleLanguageCookie({ lang: profile?.title_language || "english" }),
      userSettingsActions.setSubtitleLanguageCookie({ lang: profile?.subtitle_language || "English" }),
      userSettingsActions.setPlayWrongMediaCookie({ playWrongMedia: "false" }),
    ]);
    if (!profile?.username) setIsSettingsMenuOpen(true);
  };
  const signInGoogle = async () => {
    if (!client) return;
    setIsLoading(true);
    const next = sanitizeNextPath(nextPath || (typeof window !== "undefined" ? window.location.pathname : "/"));
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${site}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (error) setLoginError({ code: error.code || "google", message: friendlyAuthError(error) });
    setIsLoading(false);
  };
  const signAnonymously = async () => {
    if (!client) return;
    setIsLoading(true);
    const { data, error } = await client.auth.signInAnonymously();
    if (error) setLoginError({ code: error.code || "anonymous", message: friendlyAuthError(error) });
    else if (data.user) { await (client as any).from("profiles").update({ display_name: "Anonymous", avatar_url: ProfileFallbackImg.src }).eq("id", data.user.id); setIsSettingsMenuOpen(true); }
    setIsLoading(false);
  };
  async function handleLoginForm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!client) return; setIsLoading(true); const form = e.currentTarget;
    const { error } = await client.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value.trim() });
    if (error) setLoginError({ code: error.code || "login", message: friendlyAuthError(error) }); else { setLoginError(null); await finishAuth(); }
    setIsLoading(false);
  }
  async function handleSignUpForm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!client) return; setIsLoading(true); const form = e.currentTarget;
    const username = form.username.value.trim(); const password = form.password.value.trim();
    if (!/^[A-Za-z0-9_.-]{3,40}$/.test(username)) { setLoginError({ code: "username", message: "Username must be 3-40 characters using letters, numbers, underscore, dot, or dash." }); setIsLoading(false); return; }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) { setLoginError({ code: "password", message: "Password has to have at least 1 letter and 1 number. Min. 8 characters." }); setIsLoading(false); return; }
    if (password !== form.confirm_password.value.trim()) { setLoginError({ code: "password", message: "Passwords doesn't match." }); setIsLoading(false); return; }
    const { data: existing } = await client.from("public_profiles").select("id").ilike("username", username).limit(1);
    if (existing?.length) { setLoginError({ code: "username", message: "Username taken." }); setIsLoading(false); return; }
    const { data, error } = await client.auth.signUp({ email: form.email.value.trim(), password, options: { data: { username, avatar_url: ProfileFallbackImg.src }, emailRedirectTo: `${process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || window.location.origin + "/auth/callback"}` } });
    if (error) setLoginError({ code: error.code || "signup", message: friendlyAuthError(error) }); else if (!data.session) setLoginError({ code: "notice", message: "Check your email to finish creating your account." }); else { setLoginError(null); await finishAuth(); }
    setIsLoading(false);
  }
  if (user && isSettingsMenuOpen) return <UserSettingsModal auth={undefined as never} onClick={onClick} newUser />;
  return !user ? <motion.div id={styles.backdrop} onClick={onClick} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div data-disabled-scroll={true} onClick={(e) => e.stopPropagation()} id={styles.modal} variants={framerMotionDropIn} initial="hidden" animate="visible" exit="exit">
    <div id={styles.heading}><h5>Login with</h5><button aria-label="Close User Panel" onClick={onClick as unknown as MouseEventHandler<HTMLButtonElement>}><CloseSvg width={16} height={16} alt="Close icon" /></button></div>
    <LoginAlternativesButtons anonymously={signAnonymously} withGoogle={signInGoogle} />
    <div id={styles.span_container}><span></span><span>or</span><span></span></div>
    <motion.form onSubmit={formType === "signup" ? handleSignUpForm : handleLoginForm} onChange={() => setLoginError(null)} data-error-occurred={!!loginError}>
      <AnimatePresence>{formType === "signup" && <motion.label initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>Username<input type="text" name="username" minLength={3} maxLength={40} pattern="^[A-Za-z0-9_.-]{3,40}$" placeholder="Your Username" required /></motion.label>}</AnimatePresence>
      <label>Email<input type="email" name="email" placeholder="Your Email" required /></label>
      <label>Password<input type="password" name="password" minLength={8} pattern="^(?=.*\d)(?=.*[a-zA-Z]).{8,}$" autoComplete={formType === "signup" ? "new-password" : "current-password"} placeholder="Your Password" required /></label>
      <AnimatePresence>{formType === "signup" && <motion.label initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>Confirm Password<input type="password" name="confirm_password" minLength={8} placeholder="Your Password Again" required /></motion.label>}</AnimatePresence>
      <motion.button type="submit" whileTap={{ scale: 0.95 }} disabled={isLoading}>{isLoading ? <LoadingSvg width={16} height={16} alt="Loading" /> : formType === "signup" ? "SIGN UP" : "LOGIN"}</motion.button>
    </motion.form>
    <AnimatePresence>{loginError && <motion.p style={{ color: "var(--black-100)", padding: "16px", background: "var(--black-05)" }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}><span style={{ color: "var(--error)" }}>{loginError.code}:</span> {loginError.message}</motion.p>}</AnimatePresence>
    <motion.button id={styles.create_account_button} onClick={() => setFormType(formType === "signup" ? "login" : "signup")}>{formType === "signup" ? "Or Login in Your Account" : "Or Create Your Account"}</motion.button>
  </motion.div></motion.div> : null;
}
function LoginAlternativesButtons({ withGoogle, anonymously }: { withGoogle: () => void; anonymously: () => void }) { return <div id={styles.login_buttons_container}><div><button title="Google" id={styles.google_button} onClick={withGoogle}><GoogleSvg width={16} height={16} alt="Google icon" /></button><small>Google</small></div><div><button title="Anonymously" id={styles.anonymous_button} onClick={anonymously}><AnonymousSvg width={16} height={16} alt="Anonymous icon" /></button><small>Anonymously</small></div></div>; }
