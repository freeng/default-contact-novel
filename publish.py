#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import json
import os
import posixpath
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DOCS_DIR = ROOT / "docs"
CHAPTERS_DIR = DOCS_DIR / "chapters"
MANIFEST_PATH = CHAPTERS_DIR / "manifest.json"
BOOK_TITLE = "默认联系人"
BOOK_STATUS = "全文完"
SOURCE_RE = re.compile(r"^默认联系人_第(\d+)章_(.+)\.txt$")
PRIVATE_MARKERS = ("私聊", "大纲", "extract_chat", "split_chat", "cover-source")


@dataclass(frozen=True)
class Chapter:
    number: int
    title: str
    source: Path

    @property
    def chapter_id(self) -> str:
        return f"chapter-{self.number:02d}"

    @property
    def output_name(self) -> str:
        return f"{self.chapter_id}.txt"


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        check=check,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def discover_chapters() -> list[Chapter]:
    chapters: list[Chapter] = []
    for path in ROOT.glob("默认联系人_第*章_*.txt"):
        match = SOURCE_RE.match(path.name)
        if not match:
            continue
        number = int(match.group(1))
        title = match.group(2).replace("_", "，")
        chapters.append(Chapter(number=number, title=title, source=path))

    if not chapters:
        raise SystemExit("No chapter source files found.")

    chapters.sort(key=lambda item: item.number)
    numbers = [item.number for item in chapters]
    expected = list(range(1, len(chapters) + 1))
    if numbers != expected:
        raise SystemExit(f"Chapter numbers are not continuous: {numbers}")

    return chapters


def sync_chapters() -> list[Chapter]:
    chapters = discover_chapters()
    CHAPTERS_DIR.mkdir(parents=True, exist_ok=True)

    wanted = {chapter.output_name for chapter in chapters}
    for old_file in CHAPTERS_DIR.glob("chapter-*.txt"):
        if old_file.name not in wanted:
            old_file.unlink()

    for chapter in chapters:
        shutil.copyfile(chapter.source, CHAPTERS_DIR / chapter.output_name)

    manifest = {
        "title": BOOK_TITLE,
        "status": BOOK_STATUS,
        "chapters": [
            {
                "id": chapter.chapter_id,
                "number": chapter.number,
                "title": chapter.title,
                "file": f"chapters/{chapter.output_name}",
            }
            for chapter in chapters
        ],
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    validate_public_docs()
    print(f"Synced {len(chapters)} chapters into {CHAPTERS_DIR.relative_to(ROOT)}")
    return chapters


def validate_public_docs() -> None:
    for path in DOCS_DIR.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT).as_posix()
        if any(marker in path.name for marker in PRIVATE_MARKERS):
            raise SystemExit(f"Refusing to publish private-looking file: {relative}")
        if path.stat().st_size > 5_000_000:
            raise SystemExit(f"Refusing to publish unexpectedly large file: {relative}")


def git_changed(paths: list[str]) -> bool:
    result = run(["git", "status", "--porcelain", "--", *paths], check=False)
    return bool(result.stdout.strip())


def commit_changes(message: str) -> bool:
    run(["git", "add", "docs/chapters"])
    if not git_changed(["docs/chapters"]):
        print("No chapter changes to commit.")
        return False
    run(["git", "commit", "-m", message])
    print("Committed chapter update.")
    return True


def push_changes() -> None:
    output = run(["git", "push"]).stdout.strip()
    if output:
        print(output)
    print("Pushed to GitHub.")


def require_paramiko():
    try:
        import paramiko  # type: ignore
    except ImportError as exc:
        raise SystemExit("paramiko is required for server deploy: pip install paramiko") from exc
    return paramiko


def remote_run(client, command: str, *, timeout: int = 60) -> str:
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if code != 0:
        raise RuntimeError(f"Remote command failed ({code}): {command}\n{out}\n{err}")
    return out + err


def ensure_remote_dir(sftp, path: str) -> None:
    stack: list[str] = []
    current = path
    while current and current != "/":
        stack.append(current)
        current = posixpath.dirname(current)
    for item in reversed(stack):
        try:
            sftp.stat(item)
        except FileNotFoundError:
            sftp.mkdir(item)


def deploy_server(args: argparse.Namespace) -> None:
    validate_public_docs()
    paramiko = require_paramiko()
    password = args.server_password or os.environ.get("NOVEL_DEPLOY_PASSWORD")
    if not password:
        password = getpass.getpass("Server password: ")

    remote_root = args.remote_path.rstrip("/")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=args.server_host,
        port=args.server_port,
        username=args.server_user,
        password=password,
        timeout=20,
        look_for_keys=False,
        allow_agent=False,
    )

    quoted_root = shlex.quote(remote_root)
    remote_run(client, f"mkdir -p {quoted_root}")
    remote_run(client, f"find {quoted_root} -mindepth 1 -maxdepth 8 -delete")

    uploaded = 0
    sftp = client.open_sftp()
    try:
        for path in DOCS_DIR.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(DOCS_DIR).as_posix()
            remote_path = posixpath.join(remote_root, rel)
            ensure_remote_dir(sftp, posixpath.dirname(remote_path))
            sftp.put(str(path), remote_path)
            uploaded += 1
    finally:
        sftp.close()

    remote_run(
        client,
        f"chown -R www-data:www-data {quoted_root} "
        f"&& find {quoted_root} -type d -exec chmod 755 {{}} \\; "
        f"&& find {quoted_root} -type f -exec chmod 644 {{}} \\;",
        timeout=120,
    )
    remote_run(client, "nginx -t && systemctl reload nginx", timeout=120)
    client.close()
    print(f"Uploaded {uploaded} files to {args.server_host}:{remote_root}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync and publish the novel reader.")
    parser.add_argument("--all", action="store_true", help="sync, commit, push, and deploy server")
    parser.add_argument("--commit", action="store_true", help="commit chapter changes")
    parser.add_argument("--push", action="store_true", help="push commits to GitHub")
    parser.add_argument("--server", action="store_true", help="deploy docs/ to the server")
    parser.add_argument("--message", default="Update published chapters", help="git commit message")
    parser.add_argument("--server-host", default="154.201.78.233")
    parser.add_argument("--server-port", type=int, default=22022)
    parser.add_argument("--server-user", default="root")
    parser.add_argument("--server-password", default=None)
    parser.add_argument("--remote-path", default="/var/www/default-contact-novel")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.all:
        args.commit = True
        args.push = True
        args.server = True

    sync_chapters()
    if args.commit:
        committed = commit_changes(args.message)
        if args.push and not committed:
            print("No new commit was created; pushing current branch anyway.")
    if args.push:
        push_changes()
    if args.server:
        deploy_server(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
