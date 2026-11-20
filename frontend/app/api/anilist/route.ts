import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { anilistCookieMaxAge } from "@/app/lib/user/anilistLogin";
import { TOKEN_COOKIE_NAME, readAnilistToken } from "@/app/lib/anilist/tokenCookie";

// Kept for an older bundle that still posts the implicit token here; the login
// helper now lets /api/auth/anilist-session store the cookie in the same call that
// validates the token, so this is a compatibility path, not the main one.
export async function POST(request: NextRequest) {
  try {
    const anilistTokenData: {
      accessToken: string;
      tokenType: string;
      expiresIn: string;
    } = await request.json();

    if (!anilistTokenData?.accessToken)
      return NextResponse.json(
        {
          message: "No Token Received",
        },
        {
          status: 404,
        }
      );

    // `expiresIn` is a number of SECONDS. The old code fed it to `expires`
    // (milliseconds) so the cookie died after ~8h instead of the token's lifetime.
    cookies().set({
      name: TOKEN_COOKIE_NAME,
      value: JSON.stringify(anilistTokenData) || "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: anilistCookieMaxAge(anilistTokenData.expiresIn),
    });

    return NextResponse.json(
      {
        message: "Anilist Token Set!",
      },
      {
        status: 201,
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        message: err,
      },
      {
        status: 500,
      }
    );
  }
}

// Status only: the access token is never handed to browser JavaScript. This is
// what `checkAccessTokenStillValid` asks, and nothing else may read the cookie.
export async function GET(request: NextRequest) {
  try {
    const token = readAnilistToken(request.cookies.get(TOKEN_COOKIE_NAME)?.value);

    if (token) {
      return NextResponse.json({ message: "Success" }, { status: 200 });
    }

    return NextResponse.json({ message: "No Cookie Found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      {
        message: err,
      },
      {
        status: 500,
      }
    );
  }
}

export async function DELETE() {
  try {
    cookies().delete(TOKEN_COOKIE_NAME);

    return NextResponse.json(
      {
        message: "Success",
      },
      {
        status: 202,
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        message: err,
      },
      {
        status: 500,
      }
    );
  }
}
