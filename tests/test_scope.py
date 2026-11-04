"""Scope check: names of evaluation methods that are out of scope for this project
must not appear in the site source, the training and pipeline code, the exported data,
or the docs.

The project covers Course 1 of the Machine Learning Specialization. Logistic cost on the
held-out year, set against two simple baselines, is the only measure of fit. Classification
metrics (Accuracy, Precision, Recall, F1, Confusion Matrix, ROC-AUC), decision-threshold
analysis, named error metrics (MSE, RMSE, MAE) and L1/L2 loss are not implemented, so their
names must not appear.

Names inside identifiers (``accuracy_score``, ``rocAuc``, ``computeMSE``) are caught too, in code only:
see ``find_excluded_code_names``.

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


# ---------------------------------------------------------------- names in code
# The regexes above work on words, and "_" is a word character, so `accuracy_score` or `rocAuc` slip
# through them. This check splits every identifier in the code into its words (snake_case and
# camelCase) and looks for the excluded names as whole words or word sequences. It runs on code only
# (training, pipeline, web/src), not on the docs, where the out-of-scope line may name the methods.
CODE_NAME_FOLDERS = ["training", "pipeline", "web/src"]
CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs"}

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
# One word of an identifier: a run of capitals before a Capitalised word (RMSE in RMSEValue), a
# Capitalised or lower-case word, or a run of capitals; each may end in digits (f1, L2). "toPrecision" is
# to + Precision, and "precipitation" is one word, so neither matches a name below.
_WORD = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+[0-9]*|[A-Z]+[0-9]*|[0-9]+")

EXCLUDED_WORDS = {"accuracy", "recall", "rmse", "mse", "mae", "roc", "auc"}
EXCLUDED_SEQUENCES = [
    ("precision", "score"), ("precision", "recall"), ("f1", "score"), ("confusion", "matrix"),
    ("threshold", "analysis"),
    ("l1", "loss"), ("l1", "norm"), ("l1", "error"), ("l2", "loss"), ("l2", "norm"), ("l2", "error"),
    ("mean", "squared", "error"), ("mean", "absolute", "error"),
]


def find_excluded_code_names(text: str) -> list[str]:
    """Identifiers in ``text`` that contain an excluded name as whole words (snake_case or camelCase)."""
    found = []
    for identifier in _IDENTIFIER.findall(text):
        words = [w.lower() for part in identifier.split("_") for w in _WORD.findall(part)]
        hit = any(w in EXCLUDED_WORDS for w in words) or any(
            words[i:i + len(seq)] == list(seq) for seq in EXCLUDED_SEQUENCES for i in range(len(words))
        )
        if hit:
            found.append(identifier)
    return found


@pytest.mark.parametrize("name", [
    "accuracy_score", "precision_score", "recall_score", "f1_score", "confusion_matrix", "roc_auc",
    "roc_auc_score", "mean_squared_error", "mean_absolute_error", "l1_loss", "l2_loss",
    "rocAuc", "computeMSE", "computeRMSE", "meanSquaredError", "confusionMatrix", "f1Score", "l2Loss",
    "AccuracyScore", "RMSEValue", "precision_recall_curve", "threshold_analysis",
])
def test_code_name_finder_catches_snake_and_camel_case(name):
    assert find_excluded_code_names(f"x = {name}(y)") == [name]


@pytest.mark.parametrize("name", [
    "precipitation", "precip_sum", "toPrecision", "x.toPrecision(3)", "log_loss", "logistic_loss", "logLoss",
    "squared_error_cost", "squaredOne", "compute_cost_reg", "pm2_5_mean", "season_sin", "mean_pm25",
    "lambda_", "f1_frame", "l2_penalty", "relative_change", "predict_proba", "sigmoid", "frame",
])
def test_code_name_finder_leaves_allowed_names_alone(name):
    assert find_excluded_code_names(f"x = {name}") == []


@pytest.mark.parametrize("folder", CODE_NAME_FOLDERS)
def test_no_excluded_names_in_code_identifiers(folder):
    assert (ROOT / folder).exists(), f"{folder} is missing"
    hits = []
    for p in _text_files(folder):
        if p.suffix.lower() not in CODE_SUFFIXES or _is_test_file_in_site(p):
            continue
        found = find_excluded_code_names(p.read_text(encoding="utf-8", errors="ignore"))
        if found:
            hits.append(f"{p.relative_to(ROOT).as_posix()}: {sorted(set(found))}")
    assert hits == []
