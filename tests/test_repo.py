"""Repository checks: the delivery files exist and say what the brief requires."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

REQUIRED = [
    "README.md",
    "docs/PROJECT_SPEC.md",
    "docs/LEARNING_NOTES.md",
    "docs/DATA_CARD.md",
    "docs/CHANGELOG.md",
    "docs/LEARNING_PROGRESS_TRACKER.md",
    ".github/workflows/ci.yml",
    ".github/workflows/pages.yml",
]
WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/pages.yml", ".github/workflows/daily.yml"]


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


@pytest.mark.parametrize("name", REQUIRED)
def test_required_file_exists(name):
    assert (ROOT / name).is_file()


@pytest.mark.parametrize("workflow", WORKFLOWS)
def test_actions_are_pinned(workflow):
    uses = re.findall(r"^\s*-?\s*uses:\s*(\S+)", read(workflow), re.MULTILINE)
    assert uses, "workflow uses no actions"
    for ref in uses:
        _, _, version = ref.partition("@")
        assert re.fullmatch(r"v\d+\.\d+\.\d+|[0-9a-f]{40}", version), f"{ref} is not pinned to an exact version"


def test_ci_runs_every_check_on_push_and_pull_request():
    text = read(".github/workflows/ci.yml")
    assert re.search(r"^on:\s*\n\s+push:\s*\n\s+pull_request:", text, re.MULTILINE)
    for needle in ["python -m pytest", "'3.10'", "pnpm typecheck", "pnpm test", "pnpm build",
                   "playwright install", "pnpm e2e", "pnpm install --frozen-lockfile"]:
        assert needle in text, needle
    # The site checks read model/model.json and data/predictions.json through the synced copies.
    assert text.index("pnpm sync-data") < text.index("pnpm typecheck")


def test_pages_deploys_only_after_ci_succeeds_on_main():
    text = read(".github/workflows/pages.yml")
    assert re.search(r"workflow_run:\s*\n\s*workflows:\s*\[\s*CI\s*\]", text)
    assert re.search(r"types:\s*\[\s*completed\s*\]", text)
    assert re.search(r"branches:\s*\[\s*main\s*\]|branches:\s*\n\s*-\s*main", text)
    assert "github.event.workflow_run.conclusion == 'success'" in text
    assert "github.event.workflow_run.event == 'push'" in text
    assert "ref: ${{ github.event.workflow_run.head_sha }}" in text
    assert not re.search(r"^\s*push:", text, re.MULTILINE), "pages must not deploy straight from a push"
    assert "deploy-pages" in text and "upload-pages-artifact" in text


def test_every_deploy_shares_one_pages_concurrency_group_that_never_cancels():
    """pages.yml and the deploy job of daily.yml both use group `pages`, so two deploys never overlap."""
    pages = read(".github/workflows/pages.yml")
    assert re.search(r"^concurrency:\s*\n\s+group: pages\s*\n\s+cancel-in-progress: false", pages, re.MULTILINE)
    daily = read(".github/workflows/daily.yml")
    deploy_job = daily.split("\n  deploy:\n", 1)[1]
    assert re.search(r"^    concurrency:\s*\n\s+group: pages\s*\n\s+cancel-in-progress: false", deploy_job, re.MULTILINE)
    # The daily run keeps its own workflow-level group so two forecast runs never overlap either.
    assert re.search(r"^concurrency:\s*\n\s+group: daily-forecast", daily, re.MULTILINE)


def test_tracker_and_changelog():
    tracker = read("docs/LEARNING_PROGRESS_TRACKER.md")
    assert "tehran-air-risk" in tracker
    assert "2026-11-03" in tracker
    assert re.search(r"1\.0\.0.*2026-11-0[34]", read("docs/CHANGELOG.md"))


def test_tracker_marks_only_implemented_concepts():
    """Every concept marked done names code that exists in the repository."""
    rows = [line for line in read("docs/LEARNING_PROGRESS_TRACKER.md").splitlines() if "[x]" in line and "|" in line]
    assert len(rows) >= 8
    for row in rows:
        paths = re.findall(r"`((?:training|pipeline|web/src)/[\w./-]+?\.(?:py|ts|tsx))`", row)
        assert paths, f"no code path in: {row[:60]}"
        for p in paths:
            assert (ROOT / p).is_file(), f"{p} named in the tracker does not exist"


def test_learning_notes_leave_the_authors_words_empty():
    notes = read("docs/LEARNING_NOTES.md")
    sections = re.split(r"^## ", notes, flags=re.MULTILINE)[1:]
    assert len(sections) >= 10
    for s in sections:
        assert "### In my own words" in s, s.splitlines()[0]
        after = s.split("### In my own words", 1)[1].strip()
        assert after == "", f"{s.splitlines()[0]}: the author's section must stay empty"


def test_readme_states_the_result_in_model_json():
    model = json.loads(read("model/model.json"))
    readme = read("README.md")
    held = model["cost"]["held_out"]
    overall = model["baselines"]["overall"]["held_out_cost"]
    monthly = model["baselines"]["monthly"]["held_out_cost"]
    assert model["beats_baselines"] is True
    for value in (held, overall, monthly):
        assert f"{value:.4f}" in readme
    card = read("docs/DATA_CARD.md")
    for value in (held, overall, monthly):
        assert f"{value:.4f}" in card


def test_readme_and_data_card_numbers_match_the_profile():
    profile = json.loads(read("web/public/data/profile.json"))
    cell_days = f"{profile['usable_cell_days']:,}"
    # Pooled positive rate over all labelled days, from the per-cell rates in the profile.
    positives = sum(c["positive_rate"] * c["labelled_days"] for c in profile["cells"])
    pooled = f"{positives / profile['usable_cell_days'] * 100:.1f}%"
    dropped = str(profile["rows"]["dst_dropped"])
    for name in ("README.md", "docs/DATA_CARD.md"):
        text = read(name)
        assert cell_days in text, f"{name}: {cell_days}"
        assert pooled in text, f"{name}: {pooled}"
    assert dropped in read("docs/DATA_CARD.md")
    assert "44 by 36 km" in read("README.md") and "44 by 36 km" in read("docs/DATA_CARD.md")
    assert "above 35.4" in read("README.md")
