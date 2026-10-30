"use client";
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import PersonIcon from "@/public/assets/person-circle.svg";
import ChevronDownSvg from "@/public/assets/chevron-down.svg";
import ChevronUpSvg from "@/public/assets/chevron-up.svg";
import LogoutSvg from "@/public/assets/logout.svg";
import SettingsSvg from "@/public/assets/gear-fill.svg";
import StarListSvg from "@/public/assets/list-stars.svg";
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
import { usePathname } from "next/navigation";
import { useUser } from "@/app/lib/supabase/AuthProvider";
const FALLBACK = "https://i.pinimg.com/736x/fc/4e/f7/fc4ef7ec7265a1ebb69b4b8d23982d9d.jpg";
const framerMotionShowUp = { hidden: { y: "-40px", opacity: 0 }, visible: { y: "0", opacity: 1, transition: { duration: 0.2 } }, exit: { opacity: 0 } };
function UserSideMenu() {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false); const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const { user, profile, loading, signOut } = useUser(); const anilistUser = useAppSelector((state) => state.UserInfo?.value); const isLoginModalOpen = useAppSelector((state) => state.ShowLoginModal?.value); const dispatch = useAppDispatch(); const pathname = usePathname();
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
  async function logUserOut() { if (anilistUser) { dispatch(removeUserInfo(undefined)); return; } await removeCookies(); await signOut(); }
  const closeLogin = () => { if (!["/my-lists", "/favourites"].includes(pathname)) dispatch(toggleShowLoginModalValue()); };
  return <div id={styles.user_container}>
    <AnilistNotice />
    <ShowUpLoginPanelAnimated apperanceCondition={isLoginModalOpen} customOnClickAction={closeLogin} />
    {!user && !anilistUser ? <button onClick={() => dispatch(toggleShowLoginModalValue())} aria-label="Click to Show User Menu" className={`display_flex_row align_items_center ${styles.heading_btn}`} id={styles.user_btn} data-useractive={false} data-loading={loading}>{loading ? <LoadingSvg width={16} height={16} title="Loading" /> : <><PersonIcon className={styles.scale} alt="User Icon" width={22} height={22} /><span>Login</span></>}</button> : <>
      <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} aria-label="Click to Show User Menu" className={`display_flex_row align_items_center ${styles.heading_btn} ${isUserMenuOpen ? styles.active : ""}`} id={styles.user_btn} data-useractive={true}><span id={styles.img_container}><Image src={profile?.avatar_url || user?.user_metadata?.avatar_url || FALLBACK} alt={profile?.display_name || profile?.username || "User"} fill sizes="36px" /></span><span>{isUserMenuOpen ? <ChevronUpSvg /> : <ChevronDownSvg />}</span></button>
      <AnimatePresence initial={false} mode="wait">{isUserMenuOpen && <motion.div variants={framerMotionShowUp} id={styles.user_menu_list} aria-expanded={isUserMenuOpen} initial="hidden" animate="visible" exit="exit"><ul role="menu"><li role="menuitem"><Link href="/favourites" onClick={() => setIsUserMenuOpen(false)}><FavouriteSvg width={16} height={16} alt="Favourites Icon" /> Favourites</Link></li><li role="menuitem"><Link href="/my-lists" onClick={() => setIsUserMenuOpen(false)}><StarListSvg width={16} height={16} alt="History Icon" /> My Lists</Link></li><li role="menuitem"><button onClick={() => { setIsUserMenuOpen(false); setIsUserSettingsOpen(true); }}><SettingsSvg width={16} height={16} alt="Settings Icon" /> Settings</button></li><li role="menuitem"><button onClick={logUserOut}><LogoutSvg width={16} height={16} alt="Logout Icon" /> Log Out</button></li></ul></motion.div>}{isUserSettingsOpen && <UserSettingsModal auth={undefined as never} onClick={() => setIsUserSettingsOpen(false)} />}</AnimatePresence>
    </>}</div>;
}
export default UserSideMenu;
