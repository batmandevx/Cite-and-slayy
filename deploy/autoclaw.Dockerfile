# AutoResearchClaw worker: an isolated container with no app secrets and no access to the app's data volume.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 CLAW_WORK=/work

# LaTeX for compiling the paper; git for installing the pinned release.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git latexmk texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended \
      texlive-bibtex-extra texlive-science lmodern \
    && rm -rf /var/lib/apt/lists/*

# Experiment stack (CPU only) + AutoResearchClaw pinned to a reviewed commit.
RUN pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install numpy scipy scikit-learn pandas matplotlib seaborn
# Editable install from a pinned clone (its wheel build currently fails on a duplicated template file).
RUN git clone https://github.com/aiming-lab/AutoResearchClaw.git /opt/arc \
    && git -C /opt/arc checkout be4ba4755bf1b52220f25e13b2293b5956590070 \
    && pip install -e "/opt/arc[all]"

COPY autoclaw/worker.py /srv/worker.py
RUN useradd --create-home --uid 10001 claw && mkdir -p /work && chown claw:claw /work
USER claw
EXPOSE 8100
CMD ["python", "/srv/worker.py"]
