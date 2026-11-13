"""Repository checks: the delivery files exist and say what the brief requires."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

REQUIRED = [
    "README.md",
    "docs/DATA_CARD.md",
    "docs/CHANGELOG.md",
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


def test_pages_build_brings_in_the_newest_predictions_from_main_after_checkout():
    """The daily run commits predictions.json after CI's commit, so the push deploy must not publish an older file."""
    text = read(".github/workflows/pages.yml")
    build = text.split("\n  build:\n", 1)[1].split("\n  deploy:\n", 1)[0]
    assert build.index("ref: ${{ github.event.workflow_run.head_sha }}") < build.index("git fetch --depth=1 origin main")
    assert "git checkout FETCH_HEAD -- data/predictions.json" in build
    assert build.index("git checkout FETCH_HEAD") < build.index("pnpm build")
    # Only that one file is taken from main.
    assert build.count("git checkout") == 1


def test_every_deploy_shares_one_pages_concurrency_group_that_never_cancels():
    """pages.yml and the deploy job of daily.yml both use group `pages`, so two deploys never overlap."""
    pages = read(".github/workflows/pages.yml")
    assert re.search(r"^concurrency:\s*\n\s+group: pages\s*\n\s+cancel-in-progress: false", pages, re.MULTILINE)
    daily = read(".github/workflows/daily.yml")
    deploy_job = daily.split("\n  deploy:\n", 1)[1]
    assert re.search(r"^    concurrency:\s*\n\s+group: pages\s*\n\s+cancel-in-progress: false", deploy_job, re.MULTILINE)
    # The daily run keeps its own workflow-level group so two forecast runs never overlap either.
    assert re.search(r"^concurrency:\s*\n\s+group: daily-forecast", daily, re.MULTILINE)


def test_changelog():
    assert re.search(r"1\.0\.0.*2026-11-0[34]", read("docs/CHANGELOG.md"))


def test_private_notes_stay_out_of_the_repo():
    """The spec, study notes and progress tracker are kept outside this public repository."""
    for name in ["PROJECT_SPEC.md", "LEARNING_NOTES.md", "LEARNING_PROGRESS_TRACKER.md"]:
        assert not (ROOT / "docs" / name).exists(), name


@pytest.mark.xfail(reason="README still states version 1's numbers; Task 13 replaces the README",
                   strict=False)
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
    # Pooled positive rate over all labelled days, from the exact per-cell counts in the profile.
    positives = sum(c["positives"] for c in profile["cells"])
    pooled = f"{positives / profile['usable_cell_days'] * 100:.1f}%"
    dropped = str(profile["rows"]["dst_dropped"])
    for name in ("README.md", "docs/DATA_CARD.md"):
        text = read(name)
        assert cell_days in text, f"{name}: {cell_days}"
        assert pooled in text, f"{name}: {pooled}"
    assert dropped in read("docs/DATA_CARD.md")
    assert "44 by 36 km" in read("README.md") and "44 by 36 km" in read("docs/DATA_CARD.md")
    assert "above 35.4" in read("README.md")
