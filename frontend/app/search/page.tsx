import React from "react";
import styles from "./page.module.css";
import NavigationSideBar from "./components/NavigationSideBar";
import ResultsContainer from "./components/ResultsContainer";
import { headers } from "next/headers";
import { checkDeviceIsMobile } from "../lib/checkMobileOrDesktop";
import { Metadata } from "next";
import { searchCatalog } from "@/app/lib/anilist/medias.server";
import { absoluteUrl } from "@/app/lib/seo/text";

const SEARCH_DESCRIPTION =
  "Filter anime by genre, year, season or status, or just discover something new to watch on KumoriTV.";

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: SearchPageTypes;
}): Promise<Metadata> {
  const filtered = Object.values(searchParams || {}).some((value) =>
    Array.isArray(value) ? value.some((item) => String(item ?? "").trim()) : String(value ?? "").trim() !== "",
  );

  return {
    title: "Search",
    description: SEARCH_DESCRIPTION,
    alternates: { canonical: filtered ? undefined : absoluteUrl("/search") },
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
  };
}

type SearchPageTypes = {
  type?: string;
  title?: string;
  genre?: string[];
  year?: number;
  status?: string;
  page?: string;
  sort?: string;
  season?: string;
};

async function SearchPage({ searchParams }: { searchParams: SearchPageTypes }) {
  const isMobile = checkDeviceIsMobile(headers());

  const sortedMedias = await searchCatalog(searchParams);

  return (
    <main id={styles.container}>
      <div id={styles.side_nav}>
        <NavigationSideBar isMobile={isMobile || false} />
      </div>

      <ResultsContainer
        mediasList={sortedMedias.results}
        totalLength={sortedMedias.allResultsLength}
      />
    </main>
  );
}

export default SearchPage;
