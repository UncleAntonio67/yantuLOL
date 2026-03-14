from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ttl-days", type=int, default=None)
    args = ap.parse_args()

    settings = get_settings()
    ttl_days = int(args.ttl_days if args.ttl_days is not None else settings.generated_pdf_ttl_days)
    root = Path(settings.generated_pdf_dir)
    if not root.exists():
        print(f"[cleanup] generated_pdf_dir does not exist: {root}")
        return 0

    now = datetime.now(timezone.utc)
    deleted = 0
    kept = 0
    for p in root.rglob("*.pdf"):
        try:
            mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)
        except Exception:
            continue
        age = (now - mtime).days
        if age >= ttl_days:
            if args.dry_run:
                print(f"[dry-run] delete {p} (age_days={age})")
            else:
                try:
                    p.unlink()
                    deleted += 1
                except Exception:
                    pass
        else:
            kept += 1

    # Cleanup empty directories (best-effort)
    if not args.dry_run:
        for d in sorted([x for x in root.rglob("*") if x.is_dir()], reverse=True):
            try:
                next(d.iterdir())
            except StopIteration:
                try:
                    d.rmdir()
                except Exception:
                    pass

    print(f"[cleanup] ttl_days={ttl_days} deleted={deleted} kept={kept}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
