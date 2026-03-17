#!/usr/bin/env python3
"""
Papercrate account migration tool — export, import, or direct migrate.

Usage:
    # Direct migration between two instances
    python migrate.py migrate \\
        --source-url https://source.example.com --source-token abc123 \\
        --target-url https://target.example.com --target-token def456

    # Export to a local directory
    python migrate.py export \\
        --url https://papercrate.draic.info --token abc123 \\
        --output ./backup

    # Import from a local directory
    python migrate.py import \\
        --url https://localhost --token def456 \\
        --input ./backup

Limitations / TODO:
    - Only the current version of each document is exported/migrated.
      The API supports listing all versions (GET /api/documents/{id}/versions)
      and downloading specific ones (POST /api/documents/{id}/versions/{vid}/download),
      but the upload API has no way to restore a document with multiple versions.
      A full backup should download all versions; import would restore the latest.
    - Deleted (trashed) documents are not exported. Pass status="all" to
      list_documents() and handle deleted_at to include them.
    - Capability sets and API tokens are not exported (they're instance-specific).
"""

import argparse
import getpass
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

import requests
import urllib3
from tqdm import tqdm

DEFAULT_WORKERS = 4

# Suppress noisy SSL warnings when --verify-ssl is not set (the default).
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MANIFEST_FILE = "manifest.json"
FILES_DIR = "files"

# Type alias for the function that fetches file bytes for a document.
FileReader = Callable[[dict], bytes | None]


class PapercrateClient:
    def __init__(self, base_url: str, token: str, verify_ssl: bool = True):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.verify = verify_ssl
        self._api_token = token
        # Separate session for file downloads — no Authorization header, so
        # presigned S3 URLs don't receive a spurious Bearer token.
        self._download_session = requests.Session()
        self._download_session.verify = verify_ssl
        self._authenticate()

    def _authenticate(self):
        """Exchange an API token for a JWT access token."""
        r = self.session.post(
            f"{self.base_url}/api/auth/exchange-api-token",
            json={"api_token": self._api_token},
            timeout=(10, 30),
        )
        r.raise_for_status()
        data = r.json()
        jwt = data.get("access_token") or data.get("token")
        if not jwt:
            raise ValueError(f"No access token in exchange response: {list(data.keys())}")
        self.session.headers["Authorization"] = f"Bearer {jwt}"
        print(f"  Authenticated to {self.base_url}")

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api{path}"

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", (10, 30))
        r = self.session.request(method, self._url(path), **kwargs)
        if r.status_code == 401:
            self._authenticate()
            r = self.session.request(method, self._url(path), **kwargs)
        r.raise_for_status()
        return r

    def _get(self, path: str, **kwargs) -> requests.Response:
        return self._request("GET", path, **kwargs)

    def _post(self, path: str, **kwargs) -> requests.Response:
        return self._request("POST", path, **kwargs)

    def _patch(self, path: str, **kwargs) -> requests.Response:
        return self._request("PATCH", path, **kwargs)

    # -- Read --

    def list_tags(self) -> list[dict]:
        return self._get("/tags").json()

    def list_correspondents(self) -> list[dict]:
        return self._get("/correspondents").json()

    def list_folders_tree(self) -> list[dict]:
        return self._get("/folders/tree").json()

    def list_documents(self, status: str = "active") -> list[dict]:
        return self._get("/documents", params={"status": status}).json()

    def get_download_link(self, doc_id: str) -> dict:
        return self._post(f"/documents/{doc_id}/download").json()

    def download_file(self, download_url: str) -> bytes:
        """Download a document file.

        The download_url may be a relative backend path (/api/download/...)
        or an absolute presigned S3 URL.  A dedicated session without the
        Authorization header is used so that presigned S3 URLs aren't
        rejected due to a spurious Bearer token.
        """
        if download_url.startswith("http"):
            url = download_url
        else:
            url = f"{self.base_url}{download_url}"
        # (connect timeout, read timeout) — generous read timeout for large files
        r = self._download_session.get(url, timeout=(10, 300))
        r.raise_for_status()
        return r.content

    # -- Write --

    def create_tag(self, label: str, color: str | None = None) -> dict:
        body = {"label": label}
        if color:
            body["color"] = color
        return self._post("/tags", json=body).json()

    def create_correspondent(self, name: str, metadata: dict | None = None) -> dict:
        body: dict = {"name": name}
        if metadata:
            body["metadata"] = metadata
        return self._post("/correspondents", json=body).json()

    def ensure_folder_path(self, segments: list[str], parent_id: str | None = None) -> dict:
        body = {"segments": segments, "parent_id": parent_id}
        return self._post("/folders/path", json=body).json()

    def check_document(self, checksum: str) -> dict:
        return self._get("/documents/check", params={"checksum": checksum}).json()

    def upload_document(
        self,
        file_bytes: bytes,
        filename: str,
        title: str | None = None,
        folder_id: str | None = None,
        tag_ids: list[str] | None = None,
        correspondent_ids: list[str] | None = None,
        issued_at: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        files = {"file": (filename, file_bytes)}
        data = {"skip_existing": "false"}
        if title:
            data["title"] = title
        if folder_id:
            data["folder_id"] = folder_id
        if tag_ids:
            data["tag_ids"] = json.dumps(tag_ids)
        if correspondent_ids:
            data["correspondents"] = json.dumps(
                [{"correspondent_id": cid} for cid in correspondent_ids]
            )
        if issued_at:
            data["issued_at"] = issued_at
        if metadata:
            data["metadata"] = json.dumps(metadata)
        r = self._post("/documents", files=files, data=data)
        return r.json()

    def update_document(self, doc_id: str, issued_at: str | None = None) -> dict:
        body: dict = {}
        if issued_at is not None:
            body["issued_at"] = issued_at
        return self._patch(f"/documents/{doc_id}", json=body).json()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def flatten_folder_tree(nodes: list[dict], parent_segments: list[str] | None = None) -> list[dict]:
    """Flatten the folder tree into a list of {id, segments} dicts."""
    result = []
    parent_segments = parent_segments or []
    for node in nodes:
        segments = parent_segments + [node["name"]]
        result.append({"id": node["id"], "name": node["name"], "segments": segments})
        if node.get("children"):
            result.extend(flatten_folder_tree(node["children"], segments))
    return result


def safe_filename(doc_id: str, original_name: str) -> str:
    """Build a filesystem-safe filename from doc id and original name."""
    ext = Path(original_name).suffix if original_name else ""
    return f"{doc_id}{ext}"


def strip_document_for_manifest(doc: dict) -> dict:
    """Return a slim copy of a document dict for the manifest.

    Removes ephemeral data (presigned download URLs, assets) that expires
    immediately and is regenerated on import anyway.
    """
    version = doc.get("current_version") or {}
    return {
        "id": doc["id"],
        "filename": doc.get("filename"),
        "original_name": doc.get("original_name"),
        "title": doc.get("title"),
        "mime_type": doc.get("mime_type"),
        "folder_id": doc.get("folder_id"),
        "issued_at": doc.get("issued_at"),
        "metadata": doc.get("metadata"),
        "tags": [{"id": t["id"], "label": t["label"], "color": t.get("color")}
                 for t in doc.get("tags", [])],
        "correspondents": [{"id": c["id"], "name": c["name"]}
                           for c in doc.get("correspondents", [])],
        "current_version": {
            "size_bytes": version.get("size_bytes"),
            "checksum": version.get("checksum"),
        } if version else None,
        "_local_file": doc.get("_local_file"),
    }


def fetch_account_data(client: PapercrateClient) -> dict:
    """Fetch all metadata from an instance."""
    print("\nFetching metadata...")
    tags = client.list_tags()
    correspondents = client.list_correspondents()
    folder_tree = client.list_folders_tree()
    folders = flatten_folder_tree(folder_tree)
    documents = client.list_documents(status="active")

    print(f"  {len(tags)} tags, {len(correspondents)} correspondents, "
          f"{len(folders)} folders, {len(documents)} documents")

    return {
        "tags": tags,
        "correspondents": correspondents,
        "folder_tree": folder_tree,
        "folders": folders,
        "documents": documents,
    }


# ---------------------------------------------------------------------------
# Shared import logic
# ---------------------------------------------------------------------------

def import_data(
    target: PapercrateClient,
    data: dict,
    read_file: FileReader,
    skip_existing: bool = True,
    workers: int = DEFAULT_WORKERS,
):
    """Import account data into the target instance.

    Args:
        target: The target PapercrateClient.
        data: Account data dict with tags, correspondents, folders, documents.
        read_file: Callable that takes a document dict and returns file bytes,
                   or None if the file could not be read.
        skip_existing: Skip documents that already exist on target.
    """
    src_tags = data["tags"]
    src_correspondents = data["correspondents"]
    src_folders = data["folders"]
    src_docs = data["documents"]

    total_steps = len(src_tags) + len(src_correspondents) + len(src_folders) + len(src_docs)
    pbar = tqdm(total=total_steps, desc="Importing", unit="item")

    # -- Tags --
    tag_map: dict[str, str] = {}
    existing_tags = target.list_tags()
    existing_tag_map = {t["label"]: t["id"] for t in existing_tags}
    for tag in src_tags:
        pbar.set_description(f"Tag: {tag['label'][:30]}")
        if tag["label"] in existing_tag_map:
            tag_map[tag["id"]] = existing_tag_map[tag["label"]]
        else:
            try:
                new_tag = target.create_tag(tag["label"], tag.get("color"))
                tag_map[tag["id"]] = new_tag["id"]
            except requests.HTTPError as e:
                tqdm.write(f"  ! tag: {tag['label']} — failed: {e}")
                raise
        pbar.update(1)

    # -- Correspondents --
    corr_map: dict[str, str] = {}
    existing_corrs = target.list_correspondents()
    existing_corr_map = {c["name"]: c["id"] for c in existing_corrs}
    for corr in src_correspondents:
        pbar.set_description(f"Correspondent: {corr['name'][:30]}")
        if corr["name"] in existing_corr_map:
            corr_map[corr["id"]] = existing_corr_map[corr["name"]]
        else:
            try:
                new_corr = target.create_correspondent(corr["name"], corr.get("metadata"))
                corr_map[corr["id"]] = new_corr["id"]
            except requests.HTTPError as e:
                tqdm.write(f"  ! correspondent: {corr['name']} — failed: {e}")
                raise
        pbar.update(1)

    # -- Folders --
    folder_map: dict[str, str] = {}
    for folder in src_folders:
        pbar.set_description(f"Folder: /{'/'.join(folder['segments'][:2])}")
        result = target.ensure_folder_path(folder["segments"])
        folder_map[folder["id"]] = result["folder"]["id"]
        pbar.update(1)

    # -- Documents (parallel) --
    imported = 0
    skipped = 0
    failed = 0

    def process_document(doc: dict) -> str:
        """Process a single document. Returns 'imported', 'skipped', or 'failed'."""
        title = doc.get("title", doc.get("filename", "unknown"))
        version = doc.get("current_version", {})
        checksum = version.get("checksum", "")

        # Check for duplicates
        if skip_existing and checksum:
            try:
                check = target.check_document(checksum)
                if check.get("exists"):
                    return "skipped"
            except requests.HTTPError:
                pass

        # Read file bytes
        file_bytes = read_file(doc)
        if file_bytes is None:
            return "failed"

        # Remap IDs
        mapped_tag_ids = [
            tag_map[t["id"]] for t in doc.get("tags", []) if t["id"] in tag_map
        ]
        mapped_corr_ids = [
            corr_map[c["id"]]
            for c in doc.get("correspondents", [])
            if c["id"] in corr_map
        ]
        mapped_folder_id = (
            folder_map.get(doc["folder_id"]) if doc.get("folder_id") else None
        )

        # Upload
        try:
            result = target.upload_document(
                file_bytes=file_bytes,
                filename=doc.get("filename", doc.get("original_name", "document.pdf")),
                title=doc.get("title"),
                folder_id=mapped_folder_id,
                tag_ids=mapped_tag_ids,
                correspondent_ids=mapped_corr_ids,
                issued_at=doc.get("issued_at"),
                metadata=doc.get("metadata") if doc.get("metadata") else None,
            )
            new_doc = result.get("document", result)
            new_id = new_doc.get("id", "?")

            # Pin issued_at — the worker may overwrite it with an OCR-detected
            # date, so we explicitly set it again after upload.
            src_issued_at = doc.get("issued_at")
            if src_issued_at and new_id != "?":
                try:
                    target.update_document(new_id, issued_at=src_issued_at)
                except Exception:
                    pass

            return "imported"
        except Exception as e:
            tqdm.write(f"  ! {title}: upload failed: {e}")
            return "failed"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process_document, doc): doc for doc in src_docs}
        for future in as_completed(futures):
            doc = futures[future]
            title = doc.get("title", doc.get("filename", "unknown"))
            pbar.set_description(f"Doc: {title[:35]}")
            result = future.result()
            if result == "imported":
                imported += 1
            elif result == "skipped":
                skipped += 1
            else:
                failed += 1
            pbar.update(1)

    pbar.set_description("Done")
    pbar.close()

    return imported, skipped, failed


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_account(client: PapercrateClient, output_dir: str, workers: int = DEFAULT_WORKERS):
    """Export a full account to a local directory.

    Designed to be re-run for incremental backups:
    - Always fetches fresh metadata from the API.
    - Skips file downloads when the file already exists on disk with the
      correct size (based on the version's size_bytes).
    - Overwrites the manifest on every run so metadata stays current.
    """
    out = Path(output_dir)
    files_dir = out / FILES_DIR
    files_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Papercrate Account Export")
    print(f"Output: {out.resolve()}")
    print("=" * 60)

    data = fetch_account_data(client)
    documents = data["documents"]

    # Pre-assign local filenames
    for doc in documents:
        doc_id = doc["id"]
        filename = doc.get("filename", doc.get("original_name", "document.pdf"))
        doc["_local_file"] = safe_filename(doc_id, filename)

    # Write manifest first — always overwritten with fresh metadata so that
    # tag/folder/correspondent changes are captured even if no new files
    # need downloading.  Documents are stripped to essentials only.
    manifest = {
        "version": 1,
        "tags": data["tags"],
        "correspondents": data["correspondents"],
        "folder_tree": data["folder_tree"],
        "folders": data["folders"],
        "documents": [strip_document_for_manifest(doc) for doc in documents],
    }
    manifest_path = out / MANIFEST_FILE
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"\n  Manifest saved: {manifest_path}")

    # Download files (parallel, incremental)
    downloaded = 0
    skipped = 0
    failed = 0

    def download_one(doc: dict) -> str:
        title = doc.get("title", doc.get("filename", "unknown"))
        local_path = files_dir / doc["_local_file"]

        # Skip if file exists and size matches the current version
        expected_size = (doc.get("current_version") or {}).get("size_bytes")
        if local_path.exists():
            if expected_size is None or local_path.stat().st_size == expected_size:
                return "skipped"
            # Size mismatch — re-download (document was updated)

        try:
            link = client.get_download_link(doc["id"])
            file_bytes = client.download_file(link["url"])
            local_path.write_bytes(file_bytes)
            return "downloaded"
        except Exception as e:
            tqdm.write(f"  ! {title}: download failed: {e}")
            return "failed"

    pbar = tqdm(total=len(documents), desc="Downloading", unit="doc")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(download_one, doc): doc for doc in documents}
        for future in as_completed(futures):
            doc = futures[future]
            title = doc.get("title", doc.get("filename", "unknown"))
            pbar.set_description(f"Download: {title[:35]}")
            result = future.result()
            if result == "downloaded":
                downloaded += 1
            elif result == "skipped":
                skipped += 1
            else:
                failed += 1
            pbar.update(1)
    pbar.close()

    print("\n" + "=" * 60)
    print("Export complete!")
    print(f"  New/updated: {downloaded}")
    print(f"  Unchanged:   {skipped}")
    print(f"  Failed:      {failed}")
    print(f"  Manifest:    {manifest_path}")
    if failed:
        print(f"\n  Re-run the same command to retry failed downloads.")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def import_account(client: PapercrateClient, input_dir: str, skip_existing: bool = True, workers: int = DEFAULT_WORKERS):
    """Import a full account from a local export directory."""
    inp = Path(input_dir)
    files_dir = inp / FILES_DIR
    manifest_path = inp / MANIFEST_FILE

    if not manifest_path.exists():
        print(f"Error: {manifest_path} not found")
        sys.exit(1)

    print("=" * 60)
    print("Papercrate Account Import")
    print(f"Source: {inp.resolve()}")
    print("=" * 60)

    manifest = json.loads(manifest_path.read_text())

    def read_from_disk(doc: dict) -> bytes | None:
        local_name = doc.get("_local_file")
        title = doc.get("title", "?")
        if not local_name:
            tqdm.write(f"  ! {title}: no local file in manifest")
            return None
        local_path = files_dir / local_name
        if not local_path.exists():
            tqdm.write(f"  ! {title}: file not found: {local_path}")
            return None
        return local_path.read_bytes()

    imported, skipped, failed = import_data(
        client, manifest, read_from_disk, skip_existing=skip_existing, workers=workers
    )

    print("\n" + "=" * 60)
    print("Import complete!")
    print(f"  Imported: {imported}")
    print(f"  Skipped:  {skipped}")
    print(f"  Failed:   {failed}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Migrate (direct, source -> target)
# ---------------------------------------------------------------------------

def migrate_direct(
    source: PapercrateClient,
    target: PapercrateClient,
    skip_existing: bool = True,
    dry_run: bool = False,
    workers: int = DEFAULT_WORKERS,
):
    print("=" * 60)
    print("Papercrate Account Migration")
    print("=" * 60)

    data = fetch_account_data(source)

    if dry_run:
        print("\n[DRY RUN] Would migrate the above. Exiting.")
        return

    def download_from_source(doc: dict) -> bytes | None:
        title = doc.get("title", "?")
        try:
            link = source.get_download_link(doc["id"])
            return source.download_file(link["url"])
        except Exception as e:
            tqdm.write(f"  ! {title}: download failed: {e}")
            return None

    imported, skipped, failed = import_data(
        target, data, download_from_source, skip_existing=skip_existing, workers=workers
    )

    print("\n" + "=" * 60)
    print("Migration complete!")
    print(f"  Imported: {imported}")
    print(f"  Skipped:  {skipped}")
    print(f"  Failed:   {failed}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Papercrate account migration tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
commands:
  export    Export an account to a local directory
  import    Import an account from a local directory
  migrate   Direct migration between two instances
        """,
    )
    parser.add_argument("--verify-ssl", action="store_true", default=False,
                        help="Verify SSL certificates (default: false)")

    sub = parser.add_subparsers(dest="command", required=True)

    # -- export --
    p_export = sub.add_parser("export", help="Export account to local directory")
    p_export.add_argument("--url", required=True, help="Instance URL")
    p_export.add_argument("--token", default=None, help="API token (prompted if omitted)")
    p_export.add_argument("--output", "-o", required=True, help="Output directory")
    p_export.add_argument("--workers", "-w", type=int, default=DEFAULT_WORKERS,
                          help=f"Parallel download threads (default: {DEFAULT_WORKERS})")

    # -- import --
    p_import = sub.add_parser("import", help="Import account from local directory")
    p_import.add_argument("--url", required=True, help="Instance URL")
    p_import.add_argument("--token", default=None, help="API token (prompted if omitted)")
    p_import.add_argument("--input", "-i", required=True, help="Input directory")
    p_import.add_argument("--skip-existing", action="store_true", default=True)
    p_import.add_argument("--no-skip-existing", dest="skip_existing", action="store_false")
    p_import.add_argument("--workers", "-w", type=int, default=DEFAULT_WORKERS,
                          help=f"Parallel upload threads (default: {DEFAULT_WORKERS})")

    # -- migrate --
    p_migrate = sub.add_parser("migrate", help="Direct migration between instances")
    p_migrate.add_argument("--source-url", required=True, help="Source instance URL")
    p_migrate.add_argument("--source-token", default=None, help="Source API token (prompted if omitted)")
    p_migrate.add_argument("--target-url", required=True, help="Target instance URL")
    p_migrate.add_argument("--target-token", default=None, help="Target API token (prompted if omitted)")
    p_migrate.add_argument("--skip-existing", action="store_true", default=True)
    p_migrate.add_argument("--no-skip-existing", dest="skip_existing", action="store_false")
    p_migrate.add_argument("--dry-run", action="store_true")
    p_migrate.add_argument("--workers", "-w", type=int, default=DEFAULT_WORKERS,
                          help=f"Parallel threads (default: {DEFAULT_WORKERS})")

    args = parser.parse_args()

    if args.command == "export":
        token = args.token or getpass.getpass(f"API token for {args.url}: ")
        client = PapercrateClient(args.url, token, verify_ssl=args.verify_ssl)
        export_account(client, args.output, workers=args.workers)

    elif args.command == "import":
        token = args.token or getpass.getpass(f"API token for {args.url}: ")
        client = PapercrateClient(args.url, token, verify_ssl=args.verify_ssl)
        import_account(client, args.input, skip_existing=args.skip_existing, workers=args.workers)

    elif args.command == "migrate":
        source_token = args.source_token or getpass.getpass(f"Source API token for {args.source_url}: ")
        target_token = args.target_token or getpass.getpass(f"Target API token for {args.target_url}: ")
        source = PapercrateClient(args.source_url, source_token, verify_ssl=args.verify_ssl)
        target = PapercrateClient(args.target_url, target_token, verify_ssl=args.verify_ssl)
        migrate_direct(source, target, skip_existing=args.skip_existing, dry_run=args.dry_run, workers=args.workers)


if __name__ == "__main__":
    main()
