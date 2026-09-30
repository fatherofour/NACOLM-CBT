import hmac

from fastapi import Depends, Header, HTTPException, status

from app.core.config import Settings, get_settings


def require_service_token(
    x_service_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """central-api holds the Anthropic key and the question bank, so it only
    serves its one trusted caller (instructor-api). Fails closed: with no
    token configured, every protected route is refused."""
    expected = settings.service_token
    if not expected or not x_service_token or not hmac.compare_digest(x_service_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authorised")
