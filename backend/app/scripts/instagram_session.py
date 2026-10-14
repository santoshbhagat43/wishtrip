"""Make the Instagram session file reel imports use, from a browser's login cookies.

Logging in from the server often trips Instagram's "suspicious login" check; reusing a login
made in a normal browser doesn't. In Chrome, on instagram.com (signed in to the dedicated
account): DevTools → Application → Cookies → https://www.instagram.com, copy `sessionid` and
`csrftoken`. Then, on the server:

    docker compose --env-file .env.production -f docker-compose.prod.yml \
        run --rm media-worker python -m app.scripts.instagram_session

The values are typed into hidden prompts (never echoed or logged) and the session is saved to
INSTAGRAM_SESSION_FILE. Set INSTAGRAM_USERNAME to the username it prints.
"""

import sys
from getpass import getpass
from pathlib import Path
from urllib.parse import unquote

import instaloader

from app.core.config import settings


def main() -> int:
    target = Path(settings.instagram_session_file or "/data/instaloader/session")
    session_id = unquote(getpass("sessionid (hidden): ").strip())
    csrf = getpass("csrftoken (hidden): ").strip()
    if not session_id or not csrf:
        print("Both values are needed.", file=sys.stderr)
        return 1
    cookies = {"sessionid": session_id, "csrftoken": csrf}
    if ":" in session_id:  # the sessionid starts with the account's numeric id
        cookies["ds_user_id"] = session_id.split(":", 1)[0]

    loader = instaloader.Instaloader(quiet=True)
    loader.load_session("", cookies)
    username = loader.test_login()
    if not username:
        print(
            "Instagram didn't accept these cookies. Copy them again while signed in.",
            file=sys.stderr,
        )
        return 1
    loader.context.username = username
    target.parent.mkdir(parents=True, exist_ok=True)
    loader.save_session_to_file(str(target))
    target.chmod(0o600)
    print(f"Saved the session for @{username} to {target}.")
    print(f"Now set INSTAGRAM_USERNAME={username} in .env.production and run ./deploy/deploy.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
