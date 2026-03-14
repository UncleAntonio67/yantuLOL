from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.core.config import get_settings


def send_delivery_email(*, to_email: str, subject: str, body: str) -> None:
    settings = get_settings()
    if not (settings.smtp_host and settings.smtp_username and settings.smtp_password and settings.smtp_from):
        raise RuntimeError("SMTP is not configured")

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    if settings.smtp_use_tls:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)

