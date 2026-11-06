"""Keep tests out of the real app database: point DATA_DIR at a temp dir before settings load."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="slayy-test-"))

import pytest


@pytest.fixture(autouse=True)
def _fresh_ip_limits():
    """Every test client shares one address ("testclient"): reset the per-IP sign-up and sign-in-email limits."""
    from backend.cache.store import get_store
    for key in ("register-ip:testclient", "magic-ip:testclient"):
        get_store().put("rate", key, {"ts": []})
    yield
