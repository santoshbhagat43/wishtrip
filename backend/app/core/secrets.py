"""Encrypt small secrets at rest (a creator's bank account number). Fernet, keyed from
BANK_ENCRYPTION_KEY, or from JWT_SECRET when that is not set."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet() -> Fernet:
    secret = settings.bank_encryption_key or settings.jwt_secret
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode() if token else ""
    except InvalidToken:
        return ""
