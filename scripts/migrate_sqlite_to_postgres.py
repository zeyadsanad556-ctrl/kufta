from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server


def migrate(source_path: Path) -> None:
    if not server.USE_POSTGRES:
        raise RuntimeError("DATABASE_URL must point to the destination PostgreSQL database.")
    if not source_path.is_file():
        raise FileNotFoundError(f"SQLite source database does not exist: {source_path}")

    source = sqlite3.connect(f"file:{source_path.resolve().as_posix()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        foreign_key_errors = source.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise RuntimeError(f"SQLite has {len(foreign_key_errors)} foreign-key violations.")

        with server.connect() as destination:
            server.create_schema(destination)
            existing = {
                table: destination.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                for table in server.TABLES
            }
            populated = {table: count for table, count in existing.items() if count}
            if populated:
                details = ", ".join(f"{table}={count}" for table, count in populated.items())
                raise RuntimeError(
                    "The PostgreSQL database must be empty before migration. "
                    f"Existing rows: {details}. Migration made no data changes."
                )

            source_tables = {
                row["name"]
                for row in source.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
            import_tables = [table for table in server.TABLES if table != "sessions"]
            missing = set(import_tables) - source_tables
            if missing:
                raise RuntimeError(f"SQLite database is missing tables: {', '.join(sorted(missing))}")

            totals = {}
            for table in import_tables:
                columns = [
                    row["name"]
                    for row in source.execute(f'PRAGMA table_info("{table}")')
                ]
                if not columns:
                    raise RuntimeError(f"Could not read the SQLite schema for {table}.")
                column_sql = ", ".join(f'"{column}"' for column in columns)
                placeholders = ", ".join("%s" for _ in columns)
                rows = source.execute(f'SELECT {column_sql} FROM "{table}"')
                count = 0
                while batch := rows.fetchmany(250):
                    destination.executemany(
                        f'INSERT INTO "{table}" ({column_sql}) VALUES ({placeholders})',
                        [tuple(row) for row in batch],
                    )
                    count += len(batch)
                totals[table] = count

            for table in server.IDENTITY_TABLES:
                destination.execute(
                    f"""
                    SELECT setval(
                        pg_get_serial_sequence('{table}', 'id'),
                        COALESCE(MAX(id), 1),
                        MAX(id) IS NOT NULL
                    )
                    FROM "{table}"
                    """
                )

            server.seed_database(destination)
    finally:
        source.close()

    for table, count in totals.items():
        print(f"{table}: imported {count} rows")
    print("Migration completed. Existing login sessions were intentionally not copied.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy the existing Kufta SQLite database into an empty PostgreSQL database."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=server.DB_PATH,
        help="Path to the source SQLite database (default: data/kufta.sqlite3).",
    )
    parser.add_argument(
        "--confirm-empty-target",
        action="store_true",
        help="Confirm that the destination database may only be used for this one-time import.",
    )
    args = parser.parse_args()
    if not args.confirm_empty_target:
        parser.error("Pass --confirm-empty-target only after creating a new, empty PostgreSQL database.")
    migrate(args.source)


if __name__ == "__main__":
    main()
