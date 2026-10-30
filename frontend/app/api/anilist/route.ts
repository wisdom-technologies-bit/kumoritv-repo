import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { anilistCookieMaxAge } from "@/app/lib/user/anilistLogin";

// HANDLES ACCESS TOKEN FOR ANILIST USERS
export async function POST(request: NextRequest) {
  try {
    const anilistTokenData: {
      accessToken: string;
      tokenType: string;
      expiresIn: string;
    } = await request.json();

    if (!anilistTokenData)
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
      name: "access_token",
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

export async function GET(request: NextRequest) {
  try {
    const anilistAccessTokenData = request.cookies.get("access_token")
      ? JSON.parse(request.cookies.get("access_token")!.value).accessToken
      : null;

    if (anilistAccessTokenData) {
      return NextResponse.json(
        {
          message: "Success",
          access_token: anilistAccessTokenData,
        },
        {
          status: 200,
        }
      );
    }

    return NextResponse.json(
      {
        message: "No Cookie Found",
      },
      {
        status: 404,
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

export async function DELETE() {
  try {
    cookies().delete("access_token");

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
