from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class FakeCursor:
    rowcount = 1

    def __init__(self, rows=()):
        self.rows = iter(rows)

    def fetchone(self):
        return next(self.rows, None)

    def fetchall(self):
        return list(self.rows)


class FakePostgresConnection:
    def __init__(self):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def execute(self, query, parameters=()):
        self.calls.append((query, parameters))
        if "RETURNING id" in query:
            return FakeCursor([{"id": 42}])
        return FakeCursor()

    def cursor(self):
        return FakeCursor()

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class RepositoryTests(unittest.TestCase):
    def test_sqlite_connection_closes_after_nested_transactions(self):
        connection = sqlite3.connect(":memory:", factory=server.SQLiteConnection)
        with connection:
            connection.execute("CREATE TABLE checks (value INTEGER)")
            with connection:
                connection.execute("INSERT INTO checks VALUES (1)")
        with self.assertRaises(sqlite3.ProgrammingError):
            connection.execute("SELECT 1")

    def test_sqlite_initialization_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(server, "USE_POSTGRES", False), patch.object(
                server, "APP_ENV", "development"
            ), patch.object(server, "DATABASE_URL", ""), patch.object(
                server, "DATA_DIR", Path(directory)
            ), patch.object(server, "DB_PATH", Path(directory) / "test.sqlite3"):
                server.initialize()
                server.initialize()
                with server.connect() as database:
                    self.assertEqual(
                        database.execute("SELECT COUNT(*) FROM branches").fetchone()[0],
                        len(server.BRANCH_NAMES),
                    )
                    self.assertEqual(
                        database.execute("SELECT COUNT(*) FROM products").fetchone()[0],
                        len(server.PRODUCTS),
                    )

    def test_postgres_translates_common_sqlite_queries(self):
        raw = FakePostgresConnection()
        database = server.PostgresConnection(raw)
        cursor = database.execute(
            "SELECT id FROM users WHERE username=? COLLATE NOCASE AND branch_id IS ?",
            ("ADMIN", None),
        )
        self.assertIn(
            "LOWER(username)=LOWER(%s) AND branch_id IS NOT DISTINCT FROM %s",
            raw.calls[-1][0],
        )
        self.assertEqual(raw.calls[-1][1], ("ADMIN", None))
        self.assertIsNone(cursor.lastrowid)

    def test_postgres_returns_generated_identity(self):
        raw = FakePostgresConnection()
        cursor = server.PostgresConnection(raw).execute(
            "INSERT INTO branches(code,name) VALUES(?,?)",
            ("KFT-999", "فرع اختبار"),
        )
        self.assertEqual(cursor.lastrowid, 42)
        self.assertIn("RETURNING id", raw.calls[-1][0])

    def test_production_rejects_sqlite_without_database_url(self):
        with patch.object(server, "USE_POSTGRES", False), patch.object(
            server, "DATABASE_URL", ""
        ), patch.object(server, "APP_ENV", "production"):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL"):
                server.connect()


if __name__ == "__main__":
    unittest.main()
