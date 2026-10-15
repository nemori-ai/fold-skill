PYTHON ?= python3

.PHONY: help setup check test prototype

help:
	@printf '%s\n' 'make setup  创建本地 Python 环境' 'make check  检查启动文件、文档链接与基础格式' 'make test  用内存内核运行一致性用例' 'make prototype  启动本地时光机原型'

setup:
	$(PYTHON) -m venv .venv
	@printf '%s\n' '环境已就绪。运行 make check 检查启动材料。'

check:
	.venv/bin/python -B scripts/check.py
	git diff --check

test:
	.venv/bin/python -B scripts/run_cases.py

prototype:
	$(PYTHON) prototype/serve.py
