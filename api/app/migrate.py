"""Apply migrations/*.sql in name order, once each. Usage: python -m app.migrate"""

from pathlib import Path

import psycopg

from app.config import load

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


def main() -> None:
    with psycopg.connect(load().database_url) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        done = {row[0] for row in conn.execute("SELECT name FROM schema_migrations")}
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in done:
                continue
            with conn.transaction():
                conn.execute(path.read_text())
                conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            print(f"applied {path.name}")


if __name__ == "__main__":
    main()
