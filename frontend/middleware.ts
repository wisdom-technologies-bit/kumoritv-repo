import axios from 'axios'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// handles the user-selected language for media titles.
export async function middleware(request: NextRequest) {

    // Related to Anilist Login Access
    if (request.nextUrl.hash) {

        const anilistAccessHashOnURL = request.nextUrl.hash

        const accessTokenHash = anilistAccessHashOnURL.slice(anilistAccessHashOnURL.search(/\baccess_token=\b/), anilistAccessHashOnURL.search(/\b&token_type\b/)).slice(13)
        const tokenType = anilistAccessHashOnURL.slice(anilistAccessHashOnURL.search(/\btoken_type=\b/), anilistAccessHashOnURL.search(/\b&expires_in\b/)).slice(11)
        const expiresIn = anilistAccessHashOnURL.slice(anilistAccessHashOnURL.search(/\bexpires_in=\b/)).slice(11)

        axios.post(`${process.env.NEXT_PUBLIC_WEBSITE_ORIGIN_URL}/api/anilist`, {
            accessToken: accessTokenHash,
            tokenType: tokenType,
            expiresIn: expiresIn
        })

    }

    const tokenOnCookie = request.cookies.get("access_token")

    const accessToken = tokenOnCookie ? JSON.parse(tokenOnCookie.value!).accessToken : undefined

    if (request.nextUrl.pathname.startsWith("/watch")) {

    }

    if (accessToken) {
        return NextResponse.next({ headers: { authorization: `Bearer ${accessToken}` } })
    }

    return NextResponse.next()

}
