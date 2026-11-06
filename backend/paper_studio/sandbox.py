"""Run model-written experiment code safely.

Layers (each one alone blocks the obvious attacks; together they are defence in depth):
1. Static AST allow-list: only numpy / scipy / sklearn / pandas / matplotlib.pyplot and a few pure stdlib modules may be
   imported; no eval/exec/open/__import__/getattr-style builtins, no dunder attribute access, no file I/O helpers.
2. A separate interpreter process (`python -I`), started as the unprivileged `nobody` user when we are root, with an empty
   environment (no secrets), in a fresh temporary directory.
3. A runtime audit hook installed before the user code runs: no sockets, no subprocesses / exec / fork, no ctypes,
   and file access only inside the work directory and the Python installation (read-only).
4. Resource limits: CPU seconds, address space, file size, open files; plus a wall-clock timeout.

The code reports results through three helpers: report(name, value), report_table(title, header, rows) and
save_figure(name, caption). Nothing else leaves the sandbox.
"""
from __future__ import annotations

import ast
import json
import os
import re
import resource
import subprocess
import sys
import sysconfig
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ALLOWED_IMPORTS = {
    "numpy", "scipy", "sklearn", "pandas", "matplotlib", "matplotlib.pyplot", "statsmodels", "patsy",
    "matplotlib.lines", "matplotlib.patches", "matplotlib.ticker", "matplotlib.colors", "matplotlib.gridspec",
    "math", "statistics", "random", "itertools", "functools", "collections", "dataclasses", "typing", "heapq", "bisect",
    # harmless pure-Python helpers models reach for (no files, processes or network)
    "warnings", "time", "re", "copy", "operator", "string", "enum", "numbers", "fractions", "decimal", "textwrap",
    "cycler", "scipy.stats", "scipy.optimize", "scipy.special", "scipy.linalg", "scipy.integrate", "scipy.signal",
    "scipy.spatial", "scipy.sparse", "scipy.interpolate", "scipy.cluster", "scipy.ndimage",
}
BANNED_NAMES = {
    "eval", "exec", "compile", "open", "__import__", "globals", "locals", "vars", "getattr", "setattr", "delattr",
    "input", "breakpoint", "memoryview", "help", "exit", "quit", "__builtins__", "__loader__", "__spec__",
}
BANNED_ATTRS = {
    # file and process escapes reachable from allowed libraries
    "system", "popen", "spawn", "fork", "exec", "load", "loads", "save", "savez", "savez_compressed", "savetxt", "loadtxt",
    "genfromtxt", "fromfile", "tofile", "memmap", "fromregex", "DataSource", "savefig", "imsave", "imread", "read_csv",
    "read_pickle", "to_pickle", "read_json", "to_csv", "read_excel", "to_excel", "read_parquet", "to_parquet", "read_sql",
    "fetch_openml", "fetch_20newsgroups", "fetch_california_housing", "fetch_covtype", "fetch_kddcup99", "fetch_lfw_people",
    "fetch_olivetti_faces", "fetch_rcv1", "fetch_species_distributions", "f_globals", "f_locals", "f_back", "gi_frame",
    "cr_frame", "tb_frame", "co_code", "ctypeslib",
}
MAX_CODE = 24_000
CPU_SECONDS = 60
WALL_SECONDS = 90
MEMORY_BYTES = 2_500 * 1024 * 1024
MAX_FIGS = 4


class SandboxError(Exception):
    pass


# x.savefig(...) / plt.show() calls (one level of nested parentheses), anywhere on a line
_SAVEFIG = re.compile(r"\b[A-Za-z_][\w.]*\.(?:savefig|show)\((?:[^()]|\([^()]*\))*\)")


def autofix(code: str) -> str:
    """Repair the slips models make most often, so a run isn't wasted on them: fenced code, plt.savefig/plt.show
    (figures go through save_figure), and an `if __name__ == "__main__":` guard (the harness runs the module body)."""
    code = code.strip()
    code = re.sub(r"^```(?:python|py)?\s*\n|\n```\s*$", "", code)
    code = _SAVEFIG.sub("None", code)          # figures are saved by save_figure(); the call becomes a no-op
    m = re.search(r"^if __name__\s*==\s*['\"]__main__['\"]\s*:\s*\n((?:[ \t]+.*\n?|\s*\n)+)", code, re.M)
    if m:
        import textwrap
        code = code[:m.start()] + textwrap.dedent(m.group(1)) + code[m.end():]
    return code


def validate(code: str) -> None:
    """Raise SandboxError if the code uses anything outside the allow-list."""
    if len(code) > MAX_CODE:
        raise SandboxError(f"code is longer than {MAX_CODE} characters")
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise SandboxError(f"syntax error on line {e.lineno}: {e.msg}") from e
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name not in ALLOWED_IMPORTS and a.name.split(".")[0] not in ALLOWED_IMPORTS - {"matplotlib"}:
                    raise SandboxError(f"import of '{a.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if node.level or (mod not in ALLOWED_IMPORTS and mod.split(".")[0] not in ALLOWED_IMPORTS - {"matplotlib"}):
                raise SandboxError(f"import from '{mod}' is not allowed")
            for a in node.names:
                if a.name == "*" or a.name in BANNED_ATTRS or a.name in BANNED_NAMES:
                    raise SandboxError(f"importing '{a.name}' is not allowed")
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            raise SandboxError(f"'{node.id}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr in BANNED_ATTRS:
                raise SandboxError(f"attribute '.{node.attr}' is not allowed")
        elif isinstance(node, (ast.Global, ast.Nonlocal, ast.AsyncFunctionDef, ast.Await)):
            raise SandboxError(f"'{type(node).__name__}' is not allowed")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and "__" in node.value and len(node.value) < 40:
            raise SandboxError("dunder strings are not allowed")


# The harness runs inside the sandbox process. It installs the audit hook *before* the experiment code executes.
_HARNESS = r'''
import sys, os, json, math
WORK = os.getcwd()
ALLOWED_READ = tuple(p for p in sys.argv[2:] if p)
RESULTS = {"metrics": {}, "tables": [], "figures": []}

def _deny(event, args):
    if event in ("socket.connect", "socket.bind", "socket.__new__", "socket.getaddrinfo", "subprocess.Popen", "os.system",
                 "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty", "ctypes.dlopen", "ctypes.cdata",
                 "os.kill", "os.chmod", "os.chown", "os.symlink", "os.link", "os.rename", "os.remove", "shutil.rmtree",
                 "pty.spawn", "sys.addaudithook") and not (event == "sys.addaudithook" and not _ready[0]):
        raise PermissionError(f"blocked: {event}")
    if event == "open":
        path, mode = args[0], (args[1] or "r")
        if isinstance(path, int):
            return
        p = os.path.realpath(os.fsdecode(path))
        writing = any(c in str(mode) for c in "wax+")
        if p.startswith(WORK + os.sep) or p == WORK:
            return
        if not writing and p.startswith(ALLOWED_READ):
            return
        if not writing and p in ("/dev/null", "/dev/urandom", "/proc/cpuinfo", "/proc/meminfo") :
            return
        raise PermissionError(f"blocked file access: {p}")

_ready = [False]
import numpy, scipy, sklearn, matplotlib
try:   # pre-import the data stack so its own file reads happen before the audit hook
    import pandas as _pd, statsmodels.api, statsmodels.formula.api
except Exception:
    _pd = None
matplotlib.use("Agg")
import matplotlib.pyplot as _plt
from cycler import cycler as _cycler
# Publication defaults: drawn near the printed size (one journal column ~3.5 in), so text stays readable after scaling;
# colour-vision-deficiency-safe palette (Okabe-Ito); light grid; no top/right spines. Experiment code may override.
_plt.rcParams.update({
    "figure.figsize": (4.6, 3.0), "figure.dpi": 100, "savefig.dpi": 220, "figure.constrained_layout.use": True,
    "font.family": "serif", "font.serif": ["DejaVu Serif"], "font.size": 9, "axes.titlesize": 9.5, "axes.titleweight": "bold",
    "axes.labelsize": 9, "xtick.labelsize": 8, "ytick.labelsize": 8, "legend.fontsize": 7.5, "legend.frameon": False,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.alpha": 0.3, "grid.linestyle": "--",
    "lines.linewidth": 1.6, "lines.markersize": 4.5, "errorbar.capsize": 3,
    "axes.prop_cycle": _cycler(color=["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#000000"]),
})
sys.addaudithook(_deny)
_ready[0] = True

DATA_DIR = os.path.join(WORK, "data")

def load_data(name):
    """The datasets the pipeline placed in this run (read-only copies): returns a pandas DataFrame."""
    fn = "".join(ch for ch in str(name) if ch.isalnum() or ch in "_-")[:60]
    path = os.path.join(DATA_DIR, fn + ".csv")
    if not os.path.exists(path):
        raise FileNotFoundError(f"no dataset named {name!r}; available: {sorted(f[:-4] for f in os.listdir(DATA_DIR)) if os.path.isdir(DATA_DIR) else []}")
    return _pd.read_csv(path, low_memory=False)

def report(name, value):
    v = float(value)
    if not math.isfinite(v):
        raise ValueError(f"metric {name!r} is not finite")
    RESULTS["metrics"][str(name)[:80]] = v

def report_table(title, header, rows):
    RESULTS["tables"].append({"title": str(title)[:160], "header": [str(h)[:40] for h in header][:8],
                              "rows": [[str(c)[:40] for c in r][:8] for r in rows][:20]})

def save_figure(name, caption):
    if len(RESULTS["figures"]) >= %(max_figs)d:
        raise ValueError("too many figures")
    fn = "".join(ch for ch in str(name) if ch.isalnum())[:24] or f"fig{len(RESULTS['figures'])}"
    _plt.gcf().savefig(os.path.join(WORK, fn + ".png"), dpi=220, bbox_inches="tight", facecolor="white")
    _plt.close("all")
    RESULTS["figures"].append({"name": fn, "caption": str(caption)[:240]})

code = open(sys.argv[1]).read()
env = {"__name__": "__main__", "report": report, "report_table": report_table, "save_figure": save_figure, "load_data": load_data}
exec(compile(code, "experiment.py", "exec"), env)
with open(os.path.join(WORK, "results.json"), "w") as fh:
    json.dump(RESULTS, fh)
''' % {"max_figs": MAX_FIGS}


@dataclass
class SandboxResult:
    metrics: dict[str, float] = field(default_factory=dict)
    tables: list[dict] = field(default_factory=list)
    figures: list[tuple[str, str, bytes]] = field(default_factory=list)   # (name, caption, png)
    stderr: str = ""
    stdout: str = ""


def _limits(drop_to_nobody: bool, cpu: int = CPU_SECONDS):
    def apply():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        try:
            resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
        except (ValueError, OSError):      # macOS dev machines don't support RLIMIT_AS; Linux servers do
            pass
        resource.setrlimit(resource.RLIMIT_FSIZE, (20 * 1024 * 1024, 20 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
        if drop_to_nobody:
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
    return apply


def run(code: str, data: dict[str, bytes] | None = None, cpu: int | None = None, wall: int | None = None) -> SandboxResult:
    """Validate and execute experiment code; returns what it reported. Raises SandboxError with a short reason.
    `data`: {name: csv bytes} made available to the code through load_data(name)."""
    validate(code)
    work = Path(tempfile.mkdtemp(prefix="slayy-exp-"))
    try:
        (work / "experiment.py").write_text(code)
        (work / "harness.py").write_text(_HARNESS)
        if data:
            (work / "data").mkdir()
            for name, raw in data.items():
                fn = "".join(ch for ch in name if ch.isalnum() or ch in "_-")[:60]
                (work / "data" / f"{fn}.csv").write_bytes(raw)
        root = os.geteuid() == 0
        if root:
            os.chown(work, 65534, 65534)
            for f in work.iterdir():
                os.chown(f, 65534, 65534)
        read_ok = sorted({sysconfig.get_paths()[k] for k in ("stdlib", "platstdlib", "purelib", "platlib")} | {sys.prefix, sys.base_prefix})
        env = {"PATH": "/usr/bin:/bin", "MPLBACKEND": "Agg", "MPLCONFIGDIR": str(work), "HOME": str(work),
               "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "PYTHONDONTWRITEBYTECODE": "1"}
        try:
            proc = subprocess.run([sys.executable, "-I", "-B", str(work / "harness.py"), str(work / "experiment.py"), *read_ok],
                                  cwd=work, env=env, capture_output=True, text=True, timeout=wall or WALL_SECONDS,
                                  preexec_fn=_limits(root, cpu or CPU_SECONDS))
        except subprocess.TimeoutExpired as e:
            raise SandboxError(f"timed out after {wall or WALL_SECONDS}s") from e
        if proc.returncode != 0:
            tail = (proc.stderr or "").strip().splitlines()[-3:]
            raise SandboxError("experiment failed: " + (" | ".join(tail)[:400] or f"exit code {proc.returncode}"))
        data = json.loads((work / "results.json").read_text())
        out = SandboxResult(metrics=data.get("metrics", {}), tables=data.get("tables", []), stderr=proc.stderr[-2000:],
                            stdout=(proc.stdout or "")[-6000:])
        for f in data.get("figures", [])[:MAX_FIGS]:
            p = work / f"{f['name']}.png"
            if p.exists() and p.stat().st_size < 6_000_000 and p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n":
                out.figures.append((f["name"], f["caption"], p.read_bytes()))
        return out
    finally:
        for f in sorted(work.rglob("*"), reverse=True):
            try:
                f.unlink() if f.is_file() else f.rmdir()
            except OSError:
                pass
        try:
            work.rmdir()
        except OSError:
            pass
