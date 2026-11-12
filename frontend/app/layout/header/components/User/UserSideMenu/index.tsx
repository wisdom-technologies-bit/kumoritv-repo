"use client";
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import PersonIcon from "@/public/assets/person-circle.svg";
import ChevronDownSvg from "@/public/assets/chevron-down.svg";
import ChevronUpSvg from "@/public/assets/chevron-up.svg";
import LogoutSvg from "@/public/assets/logout.svg";
import SettingsSvg from "@/public/assets/gear-fill.svg";
import StarListSvg from "@/public/assets/list-stars.svg";
import ClipSvg from "@/public/assets/scissors.svg";
import FavouriteSvg from "@/public/assets/heart.svg";
import LoadingSvg from "@/public/assets/Eclipse-1s-200px.svg";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import UserSettingsModal from "../UserSettingsModal";
import ShowUpLoginPanelAnimated from "@/app/components/UserLoginModal/animatedVariant";
import { useAppSelector, useAppDispatch } from "@/app/lib/redux/hooks";
import { removeUserInfo } from "@/app/lib/redux/features/manageUserData";
import { checkAccessTokenStillValid, removeCookies, handleAnilistUserLoginWithRedux, currentAnilistRedirect } from "@/app/lib/user/anilistUserLoginOptions";
import AnilistNotice from "@/app/components/AnilistNotice";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/app/lib/supabase/AuthProvider";
const FALLBACK = "https://i.pinimg.com/736x/fc/4e/f7/fc4ef7ec7265a1ebb69b4b8d23982d9d.jpg";
const framerMotionShowUp = { hidden: { y: "-40px", opacity: 0 }, visible: { y: "0", opacity: 1, transition: { duration: 0.2 } }, exit: { opacity: 0 } };
function UserSideMenu() {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false); const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"notifications" | null>(null);
  const { user, profile, loading, signOut } = useUser(); const anilistUser = useAppSelector((state) => state.UserInfo?.value); const isLoginModalOpen = useAppSelector((state) => state.ShowLoginModal?.value); const dispatch = useAppDispatch(); const pathname = usePathname(); const router = useRouter();
  // `?settings=notifications` (what the welcome page's button links to) opens the
  // settings modal at its Notifications section. A guest gets the login modal
  // first; the section opens as soon as a session appears. The param is then
  // removed with a replace, so Back does not reopen the modal.
  const notificationsRequested = React.useRef(false); const notificationsHandled = React.useRef(false); const loginPrompted = React.useRef(false);
  // The AniList redirect has to be consumed whatever the Supabase state is: a
  // visitor who already holds an anonymous (or email) session still needs their
  // AniList identity applied. The ref keeps it to one run per mount.
  const anilistRedirectHandled = React.useRef(false);
  useEffect(() => {
    if (anilistRedirectHandled.current) return;
    if (!currentAnilistRedirect()) return;
    anilistRedirectHandled.current = true;
    void handleAnilistUserLoginWithRedux();
  }, []);
  useEffect(() => { if (anilistUser) checkAccessTokenStillValid(); }, [anilistUser]);
  useEffect(() => {
    if (notificationsHandled.current) return;
    if (typeof window === "undefined") return;
    if (!notificationsRequested.current) {
      if (new URLSearchParams(window.location.search).get("settings") !== "notifications") return;
      notificationsRequested.current = true;
    }
    if (loading) return;
    if (!user) {
      if (loginPrompted.current) return;
      loginPrompted.current = true;
      dispatch(toggleShowLoginModalValue());
      return;
    }
    notificationsHandled.current = true;
    setSettingsSection("notifications");
    setIsUserSettingsOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("settings");
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [dispatch, loading, router, user]);
  async function logUserOut() { if (anilistUser) { dispatch(removeUserInfo(undefined)); return; } await removeCookies(); await signOut(); }
  const closeLogin = () => { if (!["/my-lists", "/favourites"].includes(pathname)) dispatch(toggleShowLoginModalValue()); };
  return <div id={styles.user_container}>
    <AnilistNotice />
    <ShowUpLoginPanelAnimated apperanceCondition={isLoginModalOpen} customOnClickAction={closeLogin} />
    {!user && !anilistUser ? <button onClick={() => dispatch(toggleShowLoginModalValue())} aria-label="Click to Show User Menu" className="header-icon-btn" id={styles.user_btn} data-useractive={false} data-loading={loading}>{loading ? <LoadingSvg width={16} height={16} title="Loading" /> : <><PersonIcon className={styles.scale} alt="User Icon" width={22} height={22} viewBox="0 0 16 16" /><span>Login</span></>}</button> : <>
      <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} aria-label="Click to Show User Menu" className={`header-icon-btn ${isUserMenuOpen ? styles.active : ""}`} id={styles.user_btn} data-useractive={true}><span id={styles.img_container}><Image src={profile?.avatar_url || user?.user_metadata?.avatar_url || FALLBACK} alt={profile?.display_name || profile?.username || "User"} fill sizes="36px" /></span><span>{isUserMenuOpen ? <ChevronUpSvg viewBox="0 0 16 16" style={{ width: 16, height: 16 }} /> : <ChevronDownSvg viewBox="0 0 16 16" style={{ width: 16, height: 16 }} />}</span></button>
      <AnimatePresence initial={false} mode="wait">{isUserMenuOpen && <motion.div variants={framerMotionShowUp} id={styles.user_menu_list} aria-expanded={isUserMenuOpen} initial="hidden" animate="visible" exit="exit"><ul role="menu"><li role="menuitem"><Link href="/favourites" onClick={() => setIsUserMenuOpen(false)}><FavouriteSvg width={16} height={16} alt="Favourites Icon" /> Favourites</Link></li><li role="menuitem"><Link href="/my-lists" onClick={() => setIsUserMenuOpen(false)}><StarListSvg width={16} height={16} alt="History Icon" /> My Lists</Link></li><li role="menuitem"><Link href="/clips" onClick={() => setIsUserMenuOpen(false)}><ClipSvg width={16} height={16} alt="Clips Icon" /> My Clips</Link></li><li role="menuitem"><button onClick={() => { setIsUserMenuOpen(false); setIsUserSettingsOpen(true); }}><SettingsSvg width={16} height={16} alt="Settings Icon" /> Settings</button></li><li role="menuitem"><button onClick={logUserOut}><LogoutSvg width={16} height={16} alt="Logout Icon" /> Log Out</button></li></ul></motion.div>}{isUserSettingsOpen && <UserSettingsModal auth={undefined as never} initialSection={settingsSection} onClick={() => { setIsUserSettingsOpen(false); setSettingsSection(null); }} />}</AnimatePresence>
    </>}</div>;
}
export default UserSideMenu;
