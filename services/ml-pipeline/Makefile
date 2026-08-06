# GOLI-CLI Python ML/RL pipeline (services/ml-pipeline)
#
# This service is Python — it is NOT part of the npm workspaces
# (`apps/*`, `packages/*`). Invoke it through this Makefile instead of npm.

.PHONY: venv install test reward-test dataset train eval lint format clean

PYTHON := .venv/bin/python
PIP := .venv/bin/pip

venv:
	python -m venv .venv
	$(PIP) install --upgrade pip

install: venv
	$(PIP) install -r requirements.txt

test: install
	$(PYTHON) -m pytest tests/ -q

reward-test: install
	$(PYTHON) -m pytest tests/test_reward_function.py -q

dataset:
	$(PYTHON) build_dataset.py

train:
	$(PYTHON) train_grpo.py

eval:
	$(PYTHON) evaluate.py

lint:
	$(PYTHON) -m ruff check .

format:
	$(PYTHON) -m ruff format .

clean:
	rm -rf .venv datasets
