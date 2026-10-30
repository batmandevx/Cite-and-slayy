"""Keep tests out of the real app database: point DATA_DIR at a temp dir before settings load."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="slayy-test-"))
