"""Fetch only CSV/license metadata from Microsoft's archive using HTTP ranges.

The full archive is about 46 GB. This reader refuses large reads and any server
that ignores Range, and never extracts video files. Developer-only: requests.
"""
import argparse
import io
from pathlib import Path
import zipfile

import requests

URL = 'https://download.microsoft.com/download/b/8/8/b88c0bae-e6c1-43e1-8726-98cf5af36ca4/ASL_Citizen.zip'


class RemoteArchive(io.RawIOBase):
    def __init__(self):
        self.session = requests.Session()
        response = self.session.head(URL, timeout=30)
        response.raise_for_status()
        self.size = int(response.headers['Content-Length'])
        self.position = 0
        self.transferred = 0

    def seekable(self):
        return True

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if not 0 <= self.position <= self.size:
            raise ValueError('Invalid archive seek')
        return self.position

    def tell(self):
        return self.position

    def read(self, size=-1):
        size = self.size - self.position if size < 0 else min(size, self.size - self.position)
        if not size:
            return b''
        if size > 16 * 1024 * 1024 or self.transferred + size > 64 * 1024 * 1024:
            raise ValueError('Refusing a large archive download')
        end = self.position + size - 1
        with self.session.get(URL, headers={'Range': f'bytes={self.position}-{end}'}, timeout=60, stream=True) as response:
            if response.status_code != 206:
                raise ValueError('Server did not honor HTTP Range; no full archive will be downloaded')
            expected = f'bytes {self.position}-{end}/{self.size}'
            if response.headers.get('Content-Range') != expected:
                raise ValueError('Unexpected HTTP range response')
            data = response.raw.read(size + 1)
        if len(data) != size:
            raise ValueError('Truncated or oversized range response')
        self.position += size
        self.transferred += size
        return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--extract', action='store_true')
    args = parser.parse_args()
    remote = RemoteArchive()
    with zipfile.ZipFile(remote) as archive:
        document_names = {'license', 'license.txt', 'license.md', 'readme', 'readme.txt', 'readme.md', 'terms.txt', 'terms.md'}
        files = [item for item in archive.infolist() if not item.is_dir() and (
            item.filename.lower().endswith('.csv') or Path(item.filename).name.lower() in document_names)]
        for item in files:
            print(item.filename, item.file_size)
            if args.extract:
                if item.file_size > 16 * 1024 * 1024:
                    raise ValueError('Unexpected metadata size')
                destination = args.output / Path(item.filename).name
                if destination.exists():
                    raise FileExistsError(destination)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(item))  # zipfile verifies CRC
    print(f'Downloaded {remote.transferred:,} bytes of metadata; no videos extracted.') 

