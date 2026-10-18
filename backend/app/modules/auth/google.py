"""Google sign-in: exchange a one-time auth code for the signed-in user's verified claims.

The SSO app (sso.<domain>) runs the browser redirect to Google and holds a CSRF state cookie;
the backend only does the secret-bearing step. The ID token comes straight from Google's token
endpoint over TLS using our client secret, so we read its claims without re-verifying the
signature (Google's guidance for the server-side flow) and instead check audience and issuer.
"""

import httpx
import jwt
from fastapi import HTTPException, status

from app.core.config import settings

_GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


async def exchange_code(code: str, redirect_uri: str) -> dict:
    """Return Google's verified ID-token claims (email, name, ...) for the auth code."""
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google sign-in is not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                settings.google_token_url,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not reach Google") from exc

    if res.status_code != 200:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google rejected the sign-in")

    id_token = res.json().get("id_token")
    if not id_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google returned no identity token")

    try:
        claims = jwt.decode(
            id_token,
            options={"verify_signature": False, "verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed Google identity token") from exc

    if claims.get("aud") != settings.google_client_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google token audience mismatch")
    if claims.get("iss") not in _GOOGLE_ISSUERS:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unexpected Google token issuer")
    email = claims.get("email")
    if not email or not claims.get("email_verified"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google account has no verified email")

    return claims
