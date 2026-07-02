"""CIYP voice runtime — Pipecat service skeleton (PRD-001a).

The pipeline (transport -> streaming STT -> CoachCoreProcessor -> TTS -> transport) is
ported from EL-OS in PRD-004a. Drift invariant: the LLM is NOT a Pipecat service — every
turn goes to the engine's internal coach-core route over HTTP. No Sport imports here, ever
(CI-enforced: prd-004a AC-7).
"""

SCAFFOLD_VERSION = "0.0.0"
