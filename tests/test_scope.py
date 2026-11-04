"""Scope check: names of evaluation methods that are out of scope for this project
must not appear in the site source, the training and pipeline code, the exported data,
or the docs.

The project covers Course 1 of the Machine Learning Specialization. Logistic cost on the
held-out year, set against two simple baselines, is the only measure of fit. Classification
metrics (Accuracy, Precision, Recall, F1, Confusion Matrix, ROC-AUC), decision-threshold
analysis, named error metrics (MSE, RMSE, MAE) and L1/L2 loss are not implemented, so their
names must not appear.

Allowed, on purpose:
- ``toPrecision`` (a JavaScript number formatter) in the site source.
- Test files in ``web/src`` (``*.test.ts``, ``*.test.tsx``): some of them hold the list of
  excluded names so they can assert that a page does not show them.
- In README.md, docs/LEARNING_PROGRESS_TRACKER.md and docs/PROJECT_SPEC.md only, the line
  that says the names are out of scope.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".md", ".html", ".txt", ".yml", ".yaml"}
SKIP_DIRS = {"node_modules", "dist", "__pycache__", ".venv", ".git", "test-results", "playwright-report"}

# Case-insensitive names that have no other meaning in this project.
NAMES_ANY_CASE = re.compile(
    r"\b(accuracy|recall|rmse|mse|mae|roc|confusion[ -]matrix|threshold[ -]analysis|"
    r"f1[ -]score|l[12][ -](?:loss|norm|error))\b",
    re.IGNORECASE,
)
# Names where only the capitalised spelling counts, so ordinary words are not caught
# ("precision" in prose, a variable called f1).
NAMES_CAPITALISED = re.compile(r"\b(Precision|F1|L1|AUC|ROC-AUC)\b")

# Where the exported data lives: the site's copies, the model file and the daily forecasts.
SCANNED_CODE = ["web/src", "training", "pipeline", "web/public/data", "model", "data/predictions.json"]
DOC_FILES = ["README.md", "docs/DATA_CARD.md", "docs/DATA_PROFILE.md", "docs/LEARNING_NOTES.md", "docs/CHANGELOG.md",
             "docs/LEARNING_PROGRESS_TRACKER.md", "docs/PROJECT_SPEC.md"]
# Files whose line saying "out of scope" may name the excluded methods.
OUT_OF_SCOPE_LISTS = {"README.md", "docs/LEARNING_PROGRESS_TRACKER.md", "docs/PROJECT_SPEC.md"}
OUT_OF_SCOPE_LINE = re.compile(r"out of scope", re.IGNORECASE)


def _is_test_file_in_site(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    return rel.startswith("web/src/") and re.search(r"\.test\.tsx?$", rel) is not None


def _text_files(target: str):
    base = ROOT / target
    if not base.exists():
        return
    candidates = [base] if base.is_file() else sorted(base.rglob("*"))
    for p in candidates:
        if any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts):
            continue
        if p.is_file() and p.suffix.lower() in TEXT_SUFFIXES:
            yield p


def find_excluded(text: str) -> list[str]:
    """Excluded names in ``text``, ignoring the string toPrecision."""
    text = text.replace("toPrecision", "")
    return [m.group(0) for rx in (NAMES_ANY_CASE, NAMES_CAPITALISED) for m in rx.finditer(text)]


def test_finder_catches_names_and_ignores_to_precision():
    assert find_excluded("value.toPrecision(3)") == []
    assert find_excluded("the Accuracy of it") == ["Accuracy"]
    assert find_excluded("rmse and MSE") == ["rmse", "MSE"]
    assert find_excluded("Precision, Recall, F1-score") != []
    assert find_excluded("a Confusion Matrix") == ["Confusion Matrix"]
    assert find_excluded("roc-auc curve") != []
    assert find_excluded("ROC AUC") != []
    assert find_excluded("an L2 penalty on the weights") == []
    assert find_excluded("L2 loss") == ["L2 loss"]
    assert find_excluded("L1 loss") != []
    assert find_excluded("threshold analysis") != []
    assert find_excluded("const f1 = frame()") == []


@pytest.mark.parametrize("target", SCANNED_CODE)
def test_no_excluded_names_in_code_and_data(target):
    assert (ROOT / target).exists(), f"{target} is missing"
    hits = []
    for p in _text_files(target):
        if _is_test_file_in_site(p):
            continue
        found = find_excluded(p.read_text(encoding="utf-8", errors="ignore"))
        if found:
            hits.append(f"{p.relative_to(ROOT).as_posix()}: {sorted(set(found))}")
    assert hits == []


@pytest.mark.parametrize("doc", DOC_FILES)
def test_no_excluded_names_in_docs(doc):
    path = ROOT / doc
    assert path.exists(), f"{doc} is missing"
    hits = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        found = find_excluded(line)
        if not found:
            continue
        if doc in OUT_OF_SCOPE_LISTS and OUT_OF_SCOPE_LINE.search(line):
            continue
        hits.append(f"{doc}:{number}: {sorted(set(found))}")
    assert hits == []


def test_site_pages_do_not_show_placeholder_text():
    """No bracketed placeholders such as [count] or [share] on the site."""
    hits = []
    for p in _text_files("web/src"):
        if _is_test_file_in_site(p) or p.suffix not in {".ts", ".tsx"}:
            continue
        for number, line in enumerate(p.read_text(encoding="utf-8").splitlines(), start=1):
            if re.search(r"\[(count|share|placeholder|todo|tbd)\]", line, re.IGNORECASE):
                hits.append(f"{p.relative_to(ROOT).as_posix()}:{number}")
    assert hits == []
