# CIYP voice runtime — Pipecat service skeleton (PRD-001a; pipeline logic lands in PRD-004a).
# Tenant-agnostic by mandate: one image serves every tenant; per-session config comes from
# the engine at session start. NO Sport code in voice (ADR-006 — pure HTTP client of the API).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY pipecat_app ./pipecat_app

EXPOSE 8790
CMD ["python", "-m", "pipecat_app"]
