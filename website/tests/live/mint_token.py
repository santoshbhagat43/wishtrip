"""Prints a 30-minute staff access token. Run it INSIDE the backend container on the server, so
the secret never leaves it and no password is involved:

    ssh root@<server> 'cd /opt/wishtrip && docker compose --env-file .env.production \
      -f docker-compose.prod.yml exec -T -w /app -e PYTHONPATH=/app backend python -' < mint_token.py
"""

import asyncio

from sqlalchemy import select

from app.core.security import create_token
from app.db.session import SessionLocal
from app.modules.users.models import Role, User


async def main() -> None:
    async with SessionLocal() as s:
        user = await s.scalar(select(User).where(User.role == Role.ADMIN).limit(1))
        print(create_token(user.id, user.role, "access"))


asyncio.run(main())
