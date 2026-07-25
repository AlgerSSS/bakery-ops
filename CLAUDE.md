# CLAUDE.md

协作规则、分支约定与项目专属纪律统一写在 **[AGENTS.md](AGENTS.md)**，本文件只是指针。

**开工第一件事：读 [HANDOFF.md](HANDOFF.md)**（当前状态、在途工作、已知的坑）。
**收工最后一件事：更新 HANDOFF.md**，并让工作区保持干净。

要点速查：工作分支用 `claude/<主题>` 前缀，不要直接在 `main` 上写；
`./deploy.sh` 从本地工作树 rsync 到 Contabo、不经过 git，工作区不干净不要跑；
数据库只有生产库且被 4 个代码库共用，DDL/DML 只写迁移文件、交给人执行。
